// Copia de seguridad en JSON: exportar e importar las tareas, hábitos y su historial.
import * as sync from './sync.js';
import * as gcal from './gcal.js';
import * as auth from './auth.js';
import * as store from './store.js';
import { priv, startOf, kindOf, stripLocal } from './model.js';
import { ymd, addDays } from './dates.js';

const FIELDS = ['summary', 'description', 'start', 'end', 'recurrence', 'reminders', 'transparency', 'extendedProperties'];
const clean = (ev) => Object.fromEntries(FIELDS.filter((k) => ev[k] != null).map((k) => [k, structuredClone(ev[k])]));
const online = () => auth.status() === 'signedIn' && navigator.onLine && store.getSettings().trackerCalId;

/** Todo lo de Tracker: de Google si hay conexión; si no, de la caché local. */
async function collect() {
  if (online()) {
    try {
      const now = new Date();
      const all = await gcal.listTracker({ singleEvents: false, privateExtendedProperty: 'trk=1' });
      const occ = await gcal.listTracker({
        singleEvents: true, privateExtendedProperty: 'touched=1',
        timeMin: addDays(now, -730).toISOString(), timeMax: addDays(now, 400).toISOString(),
      });
      return {
        source: 'google',
        events: all.filter((e) => !e.recurringEventId && e.status !== 'cancelled'),
        occurrences: occ.filter((e) => e.recurringEventId),
      };
    } catch (e) {
      console.warn('Exportando desde la caché:', e);
    }
  }
  const v = sync.getView();
  return {
    source: 'cache',
    events: [...Object.values(v.masters), ...Object.values(v.events).filter((e) => e._cal === 'tracker' && !e.recurringEventId)].map(stripLocal),
    occurrences: Object.values(v.events).filter((e) => e._cal === 'tracker' && e.recurringEventId && priv(e).touched === '1').map(stripLocal),
  };
}

export async function exportBackup() {
  const { source, events, occurrences } = await collect();
  const s = store.getSettings();
  const data = {
    app: 'tracker-pwa',
    version: 1,
    exportedAt: new Date().toISOString(),
    source,
    settings: { reviewTime: s.reviewTime, visibleCals: s.visibleCals },
    events: events.filter((e) => kindOf(e) !== 'review').map(clean),
    occurrences: occurrences
      .filter((o) => priv(o).uid && kindOf(o) !== 'review')
      .map((o) => ({ masterUid: priv(o).uid, occ: ymd(startOf(o)), summary: o.summary, private: priv(o) })),
    localDone: sync.localDone(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tracker-backup-${ymd(new Date())}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { events: data.events.length, occurrences: data.occurrences.length, source };
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'tracker-pwa' || !Array.isArray(data.events)) throw new Error('El archivo no es una copia de Tracker');

  // Qué existe ya (por uid) para no duplicar.
  const known = new Map();
  const { events: existing } = await collect();
  for (const e of existing) if (priv(e).uid) known.set(priv(e).uid, e.id);
  for (const e of Object.values(sync.getView().masters)) if (priv(e).uid) known.set(priv(e).uid, e.id);

  let created = 0;
  let skipped = 0;
  let occ = 0;
  sync.batch(() => {
    for (const ev of data.events) {
      const u = priv(ev).uid;
      if (!u || known.has(u)) { skipped++; continue; }
      known.set(u, sync.create(ev));
      created++;
    }
    for (const o of data.occurrences || []) {
      const masterId = known.get(o.masterUid);
      if (!masterId || !o.occ) continue;
      sync.patchOccurrence(masterId, o.occ, { summary: o.summary, extendedProperties: { private: o.private } });
      occ++;
    }
  });
  if (data.localDone) sync.mergeLocalDone(data.localDone);
  if (data.settings?.reviewTime || data.settings?.visibleCals) {
    store.updateSettings({ ...(data.settings.reviewTime ? { reviewTime: data.settings.reviewTime } : {}), ...(data.settings.visibleCals ? { visibleCals: data.settings.visibleCals } : {}) });
  }
  return { created, skipped, occ };
}
