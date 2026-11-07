// Sincronización con Google Calendar + modo sin conexión.
//
//   server  = última copia descargada de Google (se guarda en localStorage)
//   outbox  = cola de cambios locales pendientes de enviar (crear / modificar / borrar)
//   vista   = server + outbox aplicada encima  -> es lo que se pinta
//
// Al tocar algo, el cambio va a la cola y se ve al instante; la cola se envía en orden
// en cuanto hay conexión. Si gana un conflicto, gana el último cambio.
import * as store from './store.js';
import * as gcal from './gcal.js';
import * as auth from './auth.js';
import { CONFIG } from '../config.js';
import {
  mergePatch, mergeBody, stripNulls, expandHabit, priv, startOf, endOf, onDay,
  itemsForDay, overdueTasks, reviewBody, reviewText, TZ,
} from './model.js';
import { addDays, startOfDay, ymd, parseYmd } from './dates.js';

const TRK = 'tracker'; // alias interno del calendario Tracker en las claves de la caché
const MARK = 'tracker-pwa';

let server = store.get('server') || { cals: [], events: {}, masters: {}, ranges: [], lastSync: 0 };
let outbox = store.get('outbox') || [];
outbox.forEach((o) => { o.inflight = false; });
let view = null;
let status = { state: 'idle', msg: '' };
let batching = false;
const subs = new Set();

export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function emit() {
  view = null;
  subs.forEach((fn) => fn());
  scheduleReview();
}
function persist() {
  store.set('server', server);
  store.set('outbox', outbox);
}
function setStatus(state, msg = '') {
  status = { state, msg };
  emit();
}

export const getStatus = () => ({ ...status, pending: outbox.length, lastSync: server.lastSync });
export const getCalendars = () => server.cals;
export const calendarOf = (alias) => server.cals.find((c) => (c.tracker ? TRK : c.id) === alias);

export function getView() {
  if (!view) view = computeView();
  return view;
}

function mainWindow() {
  const t = startOfDay(new Date());
  return [addDays(t, -CONFIG.SYNC_PAST_DAYS), addDays(t, CONFIG.SYNC_FUTURE_DAYS + 1)];
}

const keyOf = (id) => `${TRK}|${id}`;
function decorate(ev, alias) {
  ev._cal = alias;
  ev._key = `${alias}|${ev.id}`;
  return ev;
}

// ---------- vista = servidor + cola ----------

function computeView() {
  const v = { events: structuredClone(server.events), masters: structuredClone(server.masters) };
  for (const op of outbox) applyOp(v, op);
  return v;
}

function findTarget(v, op) {
  let ev = v.events[keyOf(op.id)];
  if (!ev && op.masterId && op.occ) {
    ev = Object.values(v.events).find((e) => e.recurringEventId === op.masterId && ymd(startOf(e)) === op.occ);
  }
  return ev;
}

function applyOp(v, op) {
  if (op.type === 'create') {
    const ev = decorate({ ...stripNulls(structuredClone(op.body)), id: op.tempId, status: 'confirmed' }, TRK);
    ev._pending = true;
    if (ev.recurrence) {
      v.masters[ev.id] = ev;
      const [f, t] = mainWindow();
      for (const inst of expandHabit(ev, f, t)) { inst._pending = true; v.events[inst._key] = inst; }
    } else {
      v.events[ev._key] = ev;
    }
  } else if (op.type === 'patch') {
    const m = v.masters[op.id];
    if (m) {
      mergePatch(m, op.body);
      m._pending = true;
      if (op.body.recurrence) trimInstances(v, m);
      return;
    }
    const ev = findTarget(v, op);
    if (ev) { mergePatch(ev, op.body); ev._pending = true; }
  } else if (op.type === 'delete') {
    if (v.masters[op.id]) {
      delete v.masters[op.id];
      for (const [k, e] of Object.entries(v.events)) if (e.recurringEventId === op.id) delete v.events[k];
    }
    delete v.events[keyOf(op.id)];
  }
}

function trimInstances(v, master) {
  const r = (master.recurrence || []).join(';').match(/UNTIL=(\d{8})/);
  if (!r) return;
  const until = addDays(parseYmd(`${r[1].slice(0, 4)}-${r[1].slice(4, 6)}-${r[1].slice(6, 8)}`), 1);
  for (const [k, e] of Object.entries(v.events)) if (e.recurringEventId === master.id && startOf(e) >= until) delete v.events[k];
}

// ---------- cambios locales (los usa la interfaz) ----------

function commit() {
  if (batching) return;
  persist();
  emit();
  scheduleFlush();
}

/** Agrupa muchos cambios (p. ej. al importar) en una sola actualización. */
export function batch(fn) {
  batching = true;
  try { fn(); } finally { batching = false; commit(); }
}

function push(op) {
  op.ts = Date.now();
  const free = (o) => !o.inflight;
  if (op.type === 'patch') {
    // Si el elemento aún no se ha creado en Google, el cambio se mete en la propia creación.
    const c = outbox.find((o) => free(o) && o.type === 'create' && o.tempId === op.id);
    if (c) { mergeBody(c.body, op.body); return commit(); }
    // Varios toques seguidos sobre lo mismo -> un solo envío.
    const same = (o) => o.type === 'patch' && free(o) && (o.id === op.id || (op.masterId && o.masterId === op.masterId && o.occ === op.occ));
    const prev = [...outbox].reverse().find(same);
    if (prev) { mergeBody(prev.body, op.body); return commit(); }
  }
  if (op.type === 'delete') {
    const c = outbox.find((o) => free(o) && o.type === 'create' && o.tempId === op.id);
    if (c) {
      // Nunca llegó a Google: basta con olvidarlo.
      outbox = outbox.filter((o) => o.inflight || (o !== c && o.id !== op.id && o.masterId !== op.id));
      return commit();
    }
    outbox = outbox.filter((o) => o.inflight || !(o.type === 'patch' && o.id === op.id));
  }
  outbox.push(op);
  commit();
}

const tempId = () => `tmp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Crea un evento en Tracker. Devuelve su id provisional. */
export function create(body) {
  const id = tempId();
  push({ type: 'create', tempId: id, body: structuredClone(body) });
  return id;
}

/** Modifica un evento (o una ocurrencia de un hábito) de Tracker. */
export function patch(ev, body) {
  const op = { type: 'patch', id: ev.id, body: structuredClone(body) };
  if (ev.recurringEventId) {
    op.masterId = ev.recurringEventId;
    op.occ = ymd(startOf(ev));
    if (ev._local) op.resolve = true; // id provisional: hay que buscar la ocurrencia real en Google
  }
  push(op);
}

/** Modifica la ocurrencia de un día concreto de un hábito (usado al importar). */
export function patchOccurrence(masterId, occ, body) {
  push({ type: 'patch', id: `${masterId}_occ${occ.replace(/-/g, '')}`, masterId, occ, resolve: true, body: structuredClone(body) });
}

export function remove(id) {
  push({ type: 'delete', id });
}

// ---------- marcas locales para eventos de otros calendarios ----------

export const localDone = () => store.get('localDone', {});
export function toggleLocalDone(key) {
  const m = localDone();
  if (m[key]) delete m[key];
  else m[key] = Date.now();
  store.set('localDone', m);
  emit();
}
export function mergeLocalDone(extra) {
  store.set('localDone', { ...localDone(), ...extra });
  emit();
}

// ---------- envío de la cola ----------

let flushTimer = null;
let needsPull = false;
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => sync({ pull: false }), 700);
}

async function flushOutbox() {
  while (outbox.length) {
    const op = outbox[0];
    op.inflight = true;
    try {
      await sendOp(op);
      outbox.shift();
    } catch (e) {
      op.inflight = false;
      if (isPermanent(e)) {
        console.warn('Cambio descartado', op, e);
        outbox.shift();
        status.msg = `Un cambio no se pudo guardar: ${e.message}`;
        continue;
      }
      persist();
      throw e;
    }
    persist();
    emit();
  }
}

function isPermanent(e) {
  if (!(e instanceof gcal.ApiError)) return false;
  if ([400, 404, 410].includes(e.status)) return true;
  return e.status === 403 && !/rate|limit|quota/i.test(e.reason);
}

async function sendOp(op) {
  if (op.type === 'create') {
    const res = decorate(await gcal.insertEvent(stripNulls(op.body)), TRK);
    if (res.recurrence) {
      server.masters[res.id] = res;
      const [f, t] = mainWindow();
      for (const inst of expandHabit(res, f, t)) server.events[inst._key] = inst; // provisional hasta el próximo pull
      needsPull = true;
    } else {
      server.events[res._key] = res;
    }
    remap(op.tempId, res.id);
  } else if (op.type === 'patch') {
    let id = op.id;
    if (op.resolve) {
      id = await resolveInstance(op.masterId, op.occ);
      if (!id) return;
    }
    const res = decorate(await gcal.patchEvent(id, op.body), TRK);
    if (res.recurrence && !res.recurringEventId) {
      server.masters[res.id] = res;
      needsPull = true;
    } else {
      if (op.resolve) delete server.events[keyOf(op.id)];
      server.events[res._key] = res;
    }
  } else if (op.type === 'delete') {
    await gcal.deleteEvent(op.id);
    delete server.masters[op.id];
    delete server.events[keyOf(op.id)];
    for (const [k, e] of Object.entries(server.events)) if (e.recurringEventId === op.id) delete server.events[k];
  }
}

function remap(from, to) {
  for (const o of outbox) {
    if (o.id === from) o.id = to;
    if (o.masterId === from) o.masterId = to;
  }
  if (store.getSettings().reviewEventId === from) store.updateSettings({ reviewEventId: to });
}

async function resolveInstance(masterId, occ) {
  const d = parseYmd(occ);
  const items = await gcal.listInstances(masterId, { timeMin: d.toISOString(), timeMax: addDays(d, 1).toISOString() });
  return (items.find((i) => ymd(startOf(i)) === occ) || items[0])?.id;
}

// ---------- descarga ----------

async function ensureTracker(cals) {
  const s = store.getSettings();
  let cal = cals.find((c) => c.id === s.trackerCalId);
  if (!cal) cal = cals.find((c) => (c.description || '').includes(MARK) && c.accessRole === 'owner');
  if (!cal) {
    const created = await gcal.createTrackerCalendar({
      summary: CONFIG.TRACKER_CALENDAR_NAME,
      timeZone: TZ,
      description: `Calendario de la app Tracker (${MARK}). Aquí viven tus tareas y hábitos.`,
    });
    cal = { ...created, accessRole: 'owner', backgroundColor: created.backgroundColor || '#c8f03c', selected: true };
    cals.push(cal);
  }
  if (cal.id !== s.trackerCalId) store.updateSettings({ trackerCalId: cal.id });
  return cal.id;
}

async function pull(from, to, { main = false } = {}) {
  const cals = await gcal.listCalendars();
  const trackerId = await ensureTracker(cals);
  server.cals = cals.map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    color: c.backgroundColor || '#888',
    selected: c.selected !== false,
    primary: !!c.primary,
    tracker: c.id === trackerId,
  }));
  const s = store.getSettings();
  const visible = server.cals.filter((c) => c.tracker || (s.visibleCals?.[c.id] ?? c.selected));
  const aliases = new Set(visible.map((c) => (c.tracker ? TRK : c.id)));
  const q = { timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true };
  const results = await Promise.all(visible.map((c) => gcal.listEvents(c.id, q).then((items) => [c, items])));
  const masters = main ? await gcal.listEvents(trackerId, { singleEvents: false, timeMin: from.toISOString(), privateExtendedProperty: 'trk=1' }) : null;

  for (const [k, ev] of Object.entries(server.events)) {
    const overlaps = startOf(ev) < to && endOf(ev) > from;
    if (!aliases.has(ev._cal) || overlaps) delete server.events[k];
  }
  for (const [c, items] of results) {
    for (const ev of items) if (ev.status !== 'cancelled') { const e = decorate(ev, c.tracker ? TRK : c.id); server.events[e._key] = e; }
  }
  if (masters) {
    server.masters = {};
    for (const m of masters) if (m.recurrence && !m.recurringEventId && m.status !== 'cancelled') server.masters[m.id] = decorate(m, TRK);
  }
  // No guardar más de ~2 meses de pasado.
  const limit = addDays(startOfDay(new Date()), -60);
  for (const [k, ev] of Object.entries(server.events)) if (endOf(ev) < limit) delete server.events[k];
  server.ranges = [...(main ? [] : server.ranges), [ymd(from), ymd(to)]].slice(-12);
  if (main) server.lastSync = Date.now();
  persist();
}

/** ¿Tenemos descargado este rango? */
export function covered(from, to) {
  const [mf, mt] = mainWindow();
  if (from >= mf && to <= mt && server.lastSync) return true;
  return server.ranges.some(([a, b]) => parseYmd(a) <= from && parseYmd(b) >= to);
}

const fetching = new Set();
const failedAt = {};
/** Descarga un rango extra (p. ej. otro mes en el calendario) si hay conexión. */
export async function ensureRange(from, to) {
  if (covered(from, to) || auth.status() !== 'signedIn' || !navigator.onLine) return;
  const k = `${ymd(from)}_${ymd(to)}`;
  if (fetching.has(k) || Date.now() - (failedAt[k] || 0) < 60_000) return;
  fetching.add(k);
  try {
    await pull(from, to);
    emit();
  } catch (e) {
    failedAt[k] = Date.now();
    handleError(e);
  } finally {
    fetching.delete(k);
  }
}

// ---------- revisión nocturna ----------

function ensureReview() {
  const s = store.getSettings();
  const v = getView();
  if (s.reviewEventId && v.masters[s.reviewEventId]) return;
  const found = Object.values(v.masters).find((m) => priv(m).kind === 'review');
  if (found) { store.updateSettings({ reviewEventId: found.id }); return; }
  if (s.reviewEventId && outbox.some((o) => o.tempId === s.reviewEventId)) return;
  const id = create(reviewBody(s.reviewTime || CONFIG.DEFAULT_REVIEW_TIME));
  store.updateSettings({ reviewEventId: id });
}

let reviewTimer = null;
function scheduleReview() {
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(updateReview, 2500);
}

/** Mantiene el título del evento de revisión de hoy con lo que queda pendiente. */
function updateReview() {
  const id = store.getSettings().reviewEventId;
  if (!id || auth.status() !== 'signedIn') return;
  const v = getView();
  const today = new Date();
  const inst = Object.values(v.events).find((e) => e.recurringEventId === id && onDay(e, today));
  if (!inst) return;
  const { summary, description } = reviewText(itemsForDay(v.events, today, localDone()), overdueTasks(v.events, today), auth.appUrl());
  if (inst.summary === summary && inst.description === description) return;
  patch(inst, { summary, description });
}

// ---------- ciclo de sincronización ----------

let running = null;
let wantPull = false;

export function sync({ pull: doPull = true } = {}) {
  if (running) {
    if (doPull) wantPull = true;
    return running;
  }
  running = run(doPull).finally(() => {
    running = null;
    if (wantPull) { wantPull = false; sync(); }
  });
  return running;
}

async function run(doPull) {
  if (auth.status() !== 'signedIn') { setStatus('auth'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  setStatus('syncing');
  try {
    if (!store.getSettings().trackerCalId) await ensureTracker(await gcal.listCalendars());
    needsPull = false;
    await flushOutbox();
    if (doPull || needsPull) {
      const [f, t] = mainWindow();
      await pull(f, t, { main: true });
      ensureReview();
      await flushOutbox();
    }
    setStatus('ok', status.msg);
  } catch (e) {
    handleError(e);
  }
  persist();
}

function handleError(e) {
  console.warn('Sync:', e);
  if (e instanceof auth.AuthError) setStatus('auth', e.message);
  else if (e instanceof TypeError) setStatus('offline');
  else setStatus('error', e.message);
}

export function clearMessage() {
  status.msg = '';
}

/** Arranca la sincronización automática. */
export function start() {
  sync();
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - server.lastSync > 60_000) sync();
    else if (outbox.length) sync({ pull: false });
  });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, CONFIG.AUTO_SYNC_MINUTES * 60_000);
}

/** Olvida la caché (al cerrar sesión). La cola pendiente se conserva. */
export function resetCache() {
  server = { cals: [], events: {}, masters: {}, ranges: [], lastSync: 0 };
  persist();
  emit();
}
