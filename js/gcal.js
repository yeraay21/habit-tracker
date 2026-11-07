// Cliente mínimo de Google Calendar API v3 (REST con fetch).
// REGLA: las funciones de escritura no reciben calendario; escriben SIEMPRE en "Tracker".
// Además el permiso calendar.app.created impide a Google aceptar escrituras en otros calendarios.
import { getAccessToken } from './auth.js';
import * as store from './store.js';

const BASE = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
let transport = null; // en modo demo se sustituye por un servidor falso (mock.js)

export function useMock(fn) {
  transport = fn;
}

export class ApiError extends Error {
  constructor(status, message, reason = '') {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export async function request(method, path, { query, body } = {}) {
  if (transport) return transport(method, path, { query: query || {}, body });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken({ force: attempt > 0 });
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue; // token caducado: renovar y reintentar
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error;
      throw new ApiError(res.status, err?.message || res.statusText, err?.errors?.[0]?.reason || '');
    }
    return data;
  }
}

async function listAll(path, query) {
  const items = [];
  let pageToken;
  do {
    const r = await request('GET', path, { query: { ...query, pageToken } });
    items.push(...(r?.items || []));
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return items;
}

function trackerId() {
  const id = store.getSettings().trackerCalId;
  if (!id) throw new Error('Calendario Tracker aún no creado');
  return id;
}

// ---------- lectura (cualquier calendario) ----------
export const listCalendars = () => listAll('/users/me/calendarList', { minAccessRole: 'reader' });
export const listEvents = (calId, query) => listAll(`/calendars/${enc(calId)}/events`, { maxResults: 2500, ...query });

// ---------- escritura (solo Tracker) ----------
export const createTrackerCalendar = (body) => request('POST', '/calendars', { body });
export const insertEvent = (body) => request('POST', `/calendars/${enc(trackerId())}/events`, { body });
export const patchEvent = (id, body) => request('PATCH', `/calendars/${enc(trackerId())}/events/${enc(id)}`, { body });
export const listInstances = (id, query) => listAll(`/calendars/${enc(trackerId())}/events/${enc(id)}/instances`, query);
export const listTracker = (query) => listEvents(trackerId(), query);

export async function deleteEvent(id) {
  try {
    await request('DELETE', `/calendars/${enc(trackerId())}/events/${enc(id)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return; // ya no existía
    throw e;
  }
}
