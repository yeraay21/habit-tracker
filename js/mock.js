// Modo demo (?demo=1): un Google Calendar falso guardado en localStorage.
// Sirve para probar la app sin credenciales. Imita lo justo de la API real, incluida la
// restricción de que solo se puede escribir en el calendario creado por la app.
import * as gcal from './gcal.js';
import * as store from './store.js';
import { expandHabit, mergePatch, startOf, endOf } from './model.js';
import { addDays, startOfDay, ymd } from './dates.js';

const KEY = 'mockdb';
const rid = () => Math.random().toString(36).slice(2, 10);
const clone = (x) => (x == null ? x : structuredClone(x));

function load() {
  return store.get(KEY) || seed();
}

function seed() {
  const t = startOfDay(new Date());
  const day = (n) => ymd(addDays(t, n));
  const at = (n, h, m = 0) => { const d = addDays(t, n); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const db = {
    cals: [
      { id: 'demo-personal', summary: 'Personal', backgroundColor: '#5b8def', primary: true, selected: true, accessRole: 'owner' },
      { id: 'demo-upf', summary: 'UPF', backgroundColor: '#f0a33a', selected: true, accessRole: 'reader' },
      { id: 'demo-festivos', summary: 'Festivos', backgroundColor: '#9b8cff', selected: false, accessRole: 'reader' },
    ],
    events: { 'demo-personal': {}, 'demo-upf': {}, 'demo-festivos': {} },
  };
  const add = (cal, ev) => {
    ev.id = rid();
    ev.status = 'confirmed';
    ev.htmlLink = 'https://calendar.google.com/calendar/';
    db.events[cal][ev.id] = ev;
  };
  for (let n = -3; n < 10; n++) add('demo-personal', { summary: '[Plan] TFG · YOLO-Pose', start: { dateTime: at(n, 10) }, end: { dateTime: at(n, 12) } });
  add('demo-personal', { summary: '[Plan] Gimnasio', start: { dateTime: at(0, 18) }, end: { dateTime: at(0, 19, 30) } });
  add('demo-personal', { summary: '[Plan] Inglés · speaking', start: { dateTime: at(0, 21) }, end: { dateTime: at(0, 21, 30) } });
  add('demo-personal', { summary: '[Plan] Gimnasio', start: { dateTime: at(1, 10) }, end: { dateTime: at(1, 11, 30) } });
  add('demo-upf', { summary: 'Visión por Computador', start: { dateTime: at(0, 15) }, end: { dateTime: at(0, 16, 30) } });
  add('demo-upf', { summary: 'Reunión con el tutor del TFG', start: { dateTime: at(2, 12) }, end: { dateTime: at(2, 13) } });
  add('demo-upf', { summary: 'Entrega parcial TFG', start: { date: day(3) }, end: { date: day(4) } });
  add('demo-festivos', { summary: 'Festivo local', start: { date: day(9) }, end: { date: day(10) } });
  store.set(KEY, db);
  return db;
}

function matchesProp(ev, q) {
  if (!q.privateExtendedProperty) return true;
  const [k, v] = q.privateExtendedProperty.split('=');
  return ev.extendedProperties?.private?.[k] === v;
}

function instancesOf(db, cal, master, from, to) {
  const ex = db.events[cal];
  return expandHabit(master, from, to, { local: false })
    .map((i) => (ex[i.id] ? clone(ex[i.id]) : i))
    .filter((i) => i.status !== 'cancelled');
}

function list(db, cal, q) {
  const from = q.timeMin ? new Date(q.timeMin) : new Date(0);
  const to = q.timeMax ? new Date(q.timeMax) : new Date(8.64e15);
  const out = [];
  for (const ev of Object.values(db.events[cal] || {})) {
    if (ev.status === 'cancelled') continue;
    if (String(q.singleEvents) === 'true') {
      if (ev.recurringEventId) continue; // las excepciones salen al expandir
      if (ev.recurrence) out.push(...instancesOf(db, cal, ev, from, to));
      else if (startOf(ev) < to && endOf(ev) > from) out.push(clone(ev));
    } else if (ev.recurrence || endOf(ev) > from) {
      out.push(clone(ev));
    }
  }
  return out.filter((e) => matchesProp(e, q)).sort((a, b) => startOf(a) - startOf(b));
}

function virtualInstance(db, cal, id) {
  const m = id.match(/^(.+)_(\d{8})$/);
  const master = m && db.events[cal][m[1]];
  if (!master?.recurrence) return null;
  const d = new Date(+m[2].slice(0, 4), +m[2].slice(4, 6) - 1, +m[2].slice(6, 8));
  return expandHabit(master, d, addDays(d, 1), { local: false }).find((i) => i.id === id) || null;
}

export function install() {
  gcal.useMock(async (method, path, { query, body }) => {
    await new Promise((r) => setTimeout(r, 120));
    if (store.get('mockOffline')) throw new TypeError('Failed to fetch (sin conexión simulada)');
    const db = load();
    const dec = decodeURIComponent;
    let m;
    let out = null;
    const writable = (cal) => {
      if (method !== 'GET' && !cal.startsWith('demo-tracker')) throw new gcal.ApiError(403, 'Solo se puede escribir en calendarios creados por la app', 'forbidden');
    };

    if (method === 'GET' && path === '/users/me/calendarList') {
      out = { items: clone(db.cals) };
    } else if (method === 'POST' && path === '/calendars') {
      const c = { id: `demo-tracker-${rid()}`, summary: body.summary, description: body.description, timeZone: body.timeZone, backgroundColor: '#c8f03c', selected: true, accessRole: 'owner' };
      db.cals.push(c);
      db.events[c.id] = {};
      out = c;
    } else if ((m = path.match(/^\/calendars\/([^/]+)\/events$/))) {
      const cal = dec(m[1]);
      writable(cal);
      if (method === 'GET') out = { items: list(db, cal, query) };
      else {
        const ev = { ...clone(body), id: rid() + rid(), status: 'confirmed', htmlLink: 'https://calendar.google.com/calendar/' };
        db.events[cal][ev.id] = ev;
        out = ev;
      }
    } else if ((m = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/))) {
      const cal = dec(m[1]);
      const master = db.events[cal]?.[dec(m[2])];
      if (!master) throw new gcal.ApiError(404, 'Not Found');
      out = { items: instancesOf(db, cal, master, new Date(query.timeMin), new Date(query.timeMax)) };
    } else if ((m = path.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const cal = dec(m[1]);
      const id = dec(m[2]);
      writable(cal);
      const ex = db.events[cal] || (db.events[cal] = {});
      if (method === 'PATCH') {
        let ev = ex[id] || virtualInstance(db, cal, id);
        if (!ev) throw new gcal.ApiError(404, 'Not Found');
        ex[id] = mergePatch(ev, clone(body));
        out = ev;
      } else if (method === 'DELETE') {
        if (!ex[id]) throw new gcal.ApiError(410, 'Gone');
        delete ex[id];
        for (const [k, e] of Object.entries(ex)) if (e.recurringEventId === id) delete ex[k];
      } else {
        out = ex[id] || virtualInstance(db, cal, id);
        if (!out) throw new gcal.ApiError(404, 'Not Found');
      }
    } else {
      throw new gcal.ApiError(400, `mock: ruta no soportada ${method} ${path}`);
    }
    store.set(KEY, db);
    return clone(out);
  });
}

export const setOffline = (on) => store.set('mockOffline', !!on);
export const isOffline = () => !!store.get('mockOffline');
