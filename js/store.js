// Almacenamiento local (localStorage + JSON). Todo lo que la app recuerda en el móvil pasa por aquí.
// En modo demo (?demo=1) se usa otro prefijo para no mezclar datos de prueba con los reales.
export const DEMO = new URLSearchParams(location.search).has('demo');
const PREFIX = DEMO ? 'trkdemo.' : 'trk.';

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('No se pudo guardar', key, e);
  }
}

export function del(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* nada */ }
}

/** Borra todos los datos de este modo (demo o real). */
export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* nada */ }
}

// Ajustes: { clientId, clientSecret, authMode, trackerCalId, reviewEventId, reviewTime, visibleCals }
export function getSettings() {
  return get('settings', {});
}

export function updateSettings(patch) {
  const s = { ...getSettings(), ...patch };
  set('settings', s);
  return s;
}
