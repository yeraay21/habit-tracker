// Utilidades de fechas. Trabajamos siempre en la hora local del móvil.
// Semana de lunes a domingo.

export const pad = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' (local) */
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM-DD' -> Date a las 00:00 locales */
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date -> 'HH:MM' */
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Date -> 'YYYY-MM-DDTHH:MM:00' (sin zona; se acompaña de timeZone al enviarlo a Google) */
export const fmtLocal = (d) => `${ymd(d)}T${hm(d)}:00`;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a, b) => ymd(a) === ymd(b);

/** Códigos RRULE indexados por Date.getDay() (0 = domingo) */
export const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** Lunes primero, para los selectores */
export const WEEK = [
  { code: 'MO', short: 'L' }, { code: 'TU', short: 'M' }, { code: 'WE', short: 'X' },
  { code: 'TH', short: 'J' }, { code: 'FR', short: 'V' }, { code: 'SA', short: 'S' }, { code: 'SU', short: 'D' },
];

const fWeekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long' });
const fDayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fMonth = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const weekdayName = (d) => fWeekday.format(d);
export const dayMonth = (d) => fDayMonth.format(d).replace('.', '');
export const longDate = (d) => cap(fLong.format(d));
export const monthTitle = (d) => cap(fMonth.format(d).replace(' de ', ' '));

/** "en 25 min", "en 2 h", "hace 5 min" */
export function relative(target, now = new Date()) {
  const min = Math.round((target - now) / 60000);
  const abs = Math.abs(min);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  const txt = abs < 60 ? `${abs} min` : abs < 60 * 24 ? `${hh} h${mm ? ` ${mm} min` : ''}` : `${Math.round(abs / 1440)} d`;
  if (abs < 1) return 'ahora';
  return min >= 0 ? `en ${txt}` : `hace ${txt}`;
}
