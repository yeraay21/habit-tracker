// Modelo: cómo se representa cada tarea/hábito como evento de Google Calendar,
// y cálculos sobre los eventos (qué hay hoy, qué toca ahora, progreso...).
//
// Eventos de la app (calendario "Tracker") -> extendedProperties.private:
//   trk='1'                marca de la app
//   kind='task'|'habit'|'review'
//   uid                    id estable (para copias de seguridad)
//   rem                    minutos de aviso antes ('' = sin aviso)
//   hábitos: freq='daily'|'days'|'weekly', days='MO,WE', perWeek='3', target='2', unit='CVs'
//   estado (tarea o cada ocurrencia de un hábito): done='1'|'0', doneAt, count, touched='1'
import { CONFIG } from '../config.js';
import { ymd, parseYmd, addDays, startOfDay, startOfWeek, fmtLocal, BYDAY } from './dates.js';

export const TZ = CONFIG.TIMEZONE;

export const priv = (ev) => ev?.extendedProperties?.private || {};
export const isTracker = (ev) => priv(ev).trk === '1';
export const isPlan = (ev) => /^\s*\[plan\]/i.test(ev?.summary || '');
export function kindOf(ev) {
  if (!isTracker(ev)) return isPlan(ev) ? 'plan' : 'event';
  return priv(ev).kind || 'task';
}

/** Título "limpio" (sin ✓ ni contador) que se reescribe al marcar. */
export const cleanTitle = (ev) => (ev.summary || '').replace(/^✓\s*/, '').replace(/\s\(\d+\/\d+\)$/, '').trim() || '(sin título)';
/** Título para mostrar (además quita el prefijo [Plan]). */
export const displayTitle = (ev) => cleanTitle(ev).replace(/^\[plan\]\s*/i, '') || '(sin título)';

export const isAllDay = (ev) => !!ev.start?.date;
export const startOf = (ev) => (ev.start?.date ? parseYmd(ev.start.date) : new Date(ev.start.dateTime));
export function endOf(ev) {
  if (ev.end?.date) return parseYmd(ev.end.date);
  if (ev.end?.dateTime) return new Date(ev.end.dateTime);
  return startOf(ev);
}
export function onDay(ev, day) {
  const d0 = startOfDay(day);
  const d1 = addDays(d0, 1);
  const s = startOf(ev);
  const e = endOf(ev);
  return s < d1 && (e > d0 || (+s === +e && s >= d0));
}

export const target = (ev) => Math.max(1, Number(priv(ev).target) || 1);
export const count = (ev) => Number(priv(ev).count) || 0;

export const uid = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/-/g, '').slice(0, 20);

/** Fusión al estilo PATCH de Google: objetos se fusionan, arrays se sustituyen, null borra. */
export function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete target[k];
    else if (isObj(v) && isObj(target[k])) mergePatch(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}
/** Igual pero conservando los null (para acumular varios cambios en uno solo antes de enviarlo). */
export function mergeBody(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(target[k])) mergeBody(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}
export function stripNulls(o) {
  if (Array.isArray(o)) return o.map(stripNulls);
  if (!isObj(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== null) out[k] = stripNulls(v);
  return out;
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Quita los campos internos de la app (_key, _cal, ...) */
export function stripLocal(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

export const remindersOf = (p) => (p.rem !== '' && p.rem != null ? [{ method: 'popup', minutes: Number(p.rem) }] : []);

function summaryFor(title, p) {
  const t = Number(p.target) || 1;
  return `${p.done === '1' ? '✓ ' : ''}${title}${t > 1 ? ` (${Number(p.count) || 0}/${t})` : ''}`;
}

function timeRange(date, time, minutes) {
  const s = new Date(`${date}T${time}:00`);
  const e = new Date(s.getTime() + minutes * 60000);
  return {
    start: { dateTime: fmtLocal(s), timeZone: TZ, date: null },
    end: { dateTime: fmtLocal(e), timeZone: TZ, date: null },
  };
}
function dayRange(date) {
  return {
    start: { date, dateTime: null, timeZone: null },
    end: { date: ymd(addDays(parseYmd(date), 1)), dateTime: null, timeZone: null },
  };
}

// ---------- construir eventos ----------

/** f = { title, date, time?, duration, remind (min o null) } */
export function taskBody(f, prev = {}) {
  const timed = !!f.time;
  const p = {
    done: '0',
    ...prev,
    trk: '1',
    kind: 'task',
    uid: prev.uid || uid(),
    rem: timed && f.remind != null ? String(f.remind) : '',
  };
  return {
    summary: summaryFor(f.title.trim(), p),
    description: 'Tarea creada con Tracker.',
    ...(timed ? timeRange(f.date, f.time, f.duration || 30) : dayRange(f.date)),
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: p.done === '1' ? [] : remindersOf(p) },
    extendedProperties: { private: p },
  };
}

/** f = { title, freq: 'daily'|'days'|'weekly', days: ['MO',...], perWeek, time?, duration, target, unit, remind, startDate } */
export function habitBody(f, prev = {}) {
  let start = parseYmd(f.startDate);
  if (f.freq === 'days') {
    for (let i = 0; i < 7 && !f.days.includes(BYDAY[start.getDay()]); i++) start = addDays(start, 1);
  }
  const timed = !!f.time && f.freq !== 'weekly';
  const p = {
    ...prev,
    trk: '1',
    kind: 'habit',
    uid: prev.uid || uid(),
    freq: f.freq,
    days: f.freq === 'days' ? f.days.join(',') : '',
    perWeek: f.freq === 'weekly' ? String(f.perWeek || 1) : '',
    target: String(Math.max(1, f.target || 1)),
    unit: (f.unit || '').trim(),
    rem: timed && f.remind != null ? String(f.remind) : '',
  };
  delete p.done; delete p.count; delete p.doneAt; delete p.touched;
  const rrule = f.freq === 'days' ? `RRULE:FREQ=WEEKLY;BYDAY=${f.days.join(',')}` : 'RRULE:FREQ=DAILY';
  return {
    summary: summaryFor(f.title.trim(), p),
    description: 'Hábito de Tracker. Márcalo desde la app.',
    ...(timed ? timeRange(ymd(start), f.time, f.duration || 30) : dayRange(ymd(start))),
    recurrence: [rrule],
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: remindersOf(p) },
    extendedProperties: { private: p },
  };
}

/** Evento diario de "revisión nocturna" cuyo título la app mantiene al día. */
export function reviewBody(time) {
  const today = ymd(new Date());
  return {
    summary: '🌙 Revisión del día',
    description: 'Tracker actualiza este evento con lo que te queda pendiente.',
    ...timeRange(today, time, 15),
    recurrence: ['RRULE:FREQ=DAILY'],
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { trk: '1', kind: 'review', uid: uid() } },
  };
}
export const reviewTimeBody = (master, time) => timeRange(ymd(startOf(master)), time, 15);

// ---------- cambios de estado ----------

export function donePatch(ev, done) {
  const p = { ...priv(ev), done: done ? '1' : '0', doneAt: done ? new Date().toISOString() : '', touched: '1' };
  if (Number(p.target) > 1) p.count = String(done ? Math.max(count(ev), Number(p.target)) : 0);
  const body = { summary: summaryFor(cleanTitle(ev), p), extendedProperties: { private: p } };
  if (!isAllDay(ev)) body.reminders = { useDefault: false, overrides: done ? [] : remindersOf(p) };
  return body;
}

export function countPatch(ev, delta) {
  const n = Math.min(99, Math.max(0, count(ev) + delta));
  const done = n >= target(ev);
  const p = { ...priv(ev), count: String(n), done: done ? '1' : '0', doneAt: done ? (priv(ev).doneAt || new Date().toISOString()) : '', touched: '1' };
  const body = { summary: summaryFor(cleanTitle(ev), p), extendedProperties: { private: p } };
  if (!isAllDay(ev)) body.reminders = { useDefault: false, overrides: done ? [] : remindersOf(p) };
  return body;
}

/** Mover una tarea a otro día manteniendo la hora. */
export function moveTaskPatch(ev, date) {
  if (isAllDay(ev)) return dayRange(date);
  const s = startOf(ev);
  const minutes = Math.round((endOf(ev) - s) / 60000);
  const t = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
  return timeRange(date, t, minutes);
}

/** Dejar de repetir un hábito a partir de hoy (conserva el historial). */
export function archivePatch(master) {
  const rule = (master.recurrence || []).find((r) => r.startsWith('RRULE:')) || 'RRULE:FREQ=DAILY';
  const y = addDays(startOfDay(new Date()), -1);
  const tag = ymd(y).replace(/-/g, '');
  const until = isAllDay(master) ? tag : `${tag}T235959Z`;
  const base = rule.replace(/;UNTIL=[^;]+/, '');
  return { recurrence: [`${base};UNTIL=${until}`] };
}

// ---------- recurrencia (para hábitos creados sin conexión y para el modo demo) ----------

export function parseRule(recurrence) {
  const r = (recurrence || []).find((x) => x.startsWith('RRULE:'));
  if (!r) return null;
  const o = {};
  r.slice(6).split(';').forEach((kv) => { const [k, v] = kv.split('='); o[k] = v; });
  return o;
}
export function untilOf(rule) {
  const u = rule?.UNTIL;
  return u ? new Date(+u.slice(0, 4), +u.slice(4, 6) - 1, +u.slice(6, 8), 23, 59, 59) : null;
}

/** Genera las ocurrencias de un hábito entre from y to. local=true marca ids provisionales. */
export function expandHabit(master, from, to, { local = true } = {}) {
  const rule = parseRule(master.recurrence);
  if (!rule || !['DAILY', 'WEEKLY'].includes(rule.FREQ)) return [];
  const s = startOf(master);
  const dur = endOf(master) - s;
  const allDay = isAllDay(master);
  const until = untilOf(rule);
  const byday = rule.BYDAY ? rule.BYDAY.split(',') : [BYDAY[s.getDay()]];
  const base = structuredClone(stripLocal(master));
  delete base.recurrence;
  const out = [];
  for (let d = startOfDay(from > s ? from : s); d < to; d = addDays(d, 1)) {
    if (until && d > until) break;
    if (rule.FREQ === 'WEEKLY' && !byday.includes(BYDAY[d.getDay()])) continue;
    let start; let end;
    if (allDay) {
      start = { date: ymd(d) };
      end = { date: ymd(addDays(d, 1)) };
    } else {
      const st = new Date(d);
      st.setHours(s.getHours(), s.getMinutes(), 0, 0);
      start = { dateTime: fmtLocal(st), timeZone: master.start.timeZone || TZ };
      end = { dateTime: fmtLocal(new Date(st.getTime() + dur)), timeZone: master.start.timeZone || TZ };
    }
    const tag = ymd(d).replace(/-/g, '');
    const inst = { ...structuredClone(base), id: `${master.id}_${local ? 'L' : ''}${tag}`, recurringEventId: master.id, originalStartTime: start, start, end };
    if (local) inst._local = true;
    if (master._cal) { inst._cal = master._cal; inst._key = `${master._cal}|${inst.id}`; }
    out.push(inst);
  }
  return out;
}

// ---------- vistas ----------

/**
 * Elementos de un día, listos para pintar.
 * localDone: { key: ts } con los eventos de otros calendarios marcados en este móvil.
 */
export function itemsForDay(events, day, localDone = {}) {
  const list = [];
  for (const ev of Object.values(events)) {
    if (ev.status === 'cancelled' || !onDay(ev, day)) continue;
    const kind = kindOf(ev);
    if (kind === 'review') continue;
    const tracker = isTracker(ev);
    const it = {
      ev,
      key: ev._key,
      kind,
      tracker,
      done: tracker ? priv(ev).done === '1' : !!localDone[ev._key],
      allDay: isAllDay(ev),
      start: startOf(ev),
      end: endOf(ev),
      title: displayTitle(ev),
      pending: !!ev._pending,
    };
    if (kind === 'habit') {
      const p = priv(ev);
      it.target = target(ev);
      it.count = count(ev);
      it.unit = p.unit || '';
      it.freq = p.freq;
      if (p.freq === 'weekly') {
        it.perWeek = Number(p.perWeek) || 1;
        it.weekDone = weekDoneCount(events, ev);
        it.quotaMet = !it.done && it.weekDone >= it.perWeek;
      }
    }
    list.push(it);
  }
  list.sort((a, b) => (a.allDay - b.allDay) || (a.start - b.start) || a.title.localeCompare(b.title, 'es'));
  return list;
}

function weekDoneCount(events, ev) {
  const ws = startOfWeek(startOf(ev));
  const we = addDays(ws, 7);
  let n = 0;
  for (const e of Object.values(events)) {
    if (e.recurringEventId !== ev.recurringEventId || priv(e).done !== '1') continue;
    const s = startOf(e);
    if (s >= ws && s < we) n++;
  }
  return n;
}

/** Tareas de días anteriores (dentro de lo descargado) sin hacer. */
export function overdueTasks(events, today) {
  const d0 = startOfDay(today);
  return Object.values(events)
    .filter((ev) => ev.status !== 'cancelled' && kindOf(ev) === 'task' && priv(ev).done !== '1' && endOf(ev) <= d0)
    .map((ev) => ({ ev, key: ev._key, kind: 'task', tracker: true, done: false, allDay: isAllDay(ev), start: startOf(ev), end: endOf(ev), title: displayTitle(ev), late: true, pending: !!ev._pending }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Lo siguiente que toca:
 * 1) lo que está en curso, 2) lo que empieza en <15 min, 3) lo de la app que se te pasó hoy,
 * 4) lo próximo con hora, 5) tareas/hábitos sin hora.
 */
export function pickNext(items, now = new Date()) {
  const pend = items.filter((i) => !i.done && !i.quotaMet);
  const timed = pend.filter((i) => !i.allDay).sort((a, b) => a.start - b.start);
  const current = timed.find((i) => i.start <= now && i.end > now);
  if (current) return { item: current, mode: 'now' };
  const upcoming = timed.filter((i) => i.start > now);
  if (upcoming[0] && upcoming[0].start - now < 15 * 60000) return { item: upcoming[0], mode: 'next' };
  const late = timed.find((i) => i.tracker && i.end <= now);
  if (late) return { item: late, mode: 'late' };
  if (upcoming[0]) return { item: upcoming[0], mode: 'next' };
  const untimed = pend.filter((i) => i.allDay && i.tracker).sort((a, b) => (a.kind === 'task' ? 0 : 1) - (b.kind === 'task' ? 0 : 1));
  if (untimed[0]) return { item: untimed[0], mode: 'todo' };
  return null;
}

/** Texto del evento de revisión nocturna. */
export function reviewText(items, overdue, url) {
  const pending = [...overdue, ...items.filter((i) => i.tracker && !i.done && !i.quotaMet)];
  const label = (i) => (i.kind === 'habit' && i.target > 1 ? `${i.title} (${i.count}/${i.target})` : i.title);
  if (!pending.length) {
    return { summary: '🌙 Todo hecho hoy ✓', description: `Nada pendiente. Buen trabajo.\n\nAbrir Tracker: ${url}` };
  }
  const names = pending.map(label);
  let summary = `🌙 Quedan ${pending.length}: ${names.join(', ')}`;
  if (summary.length > 110) summary = `${summary.slice(0, 107)}…`;
  return { summary, description: `Pendiente:\n${names.map((n) => `• ${n}`).join('\n')}\n\nAbrir Tracker: ${url}` };
}
