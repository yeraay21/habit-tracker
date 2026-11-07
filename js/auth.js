// Inicio de sesión con Google (OAuth 2.0, flujo "authorization code") sin backend.
//
// - Login: Google Identity Services (popup) o, como alternativa, redirección clásica.
// - El código se canjea en el propio navegador por un access token (1 h) y un refresh token.
//   Para eso Google exige el client secret: el usuario lo pega una vez en Ajustes y se guarda
//   solo en este dispositivo (nunca en el repositorio).
// - Antes de cada llamada a la API se renueva el access token en silencio con el refresh token.
import * as store from './store.js';
import { CONFIG } from '../config.js';

export const SCOPES = [
  // Crear el calendario "Tracker" y escribir SOLO en calendarios creados por esta app.
  'https://www.googleapis.com/auth/calendar.app.created',
  // Leer eventos y la lista de calendarios (sin poder modificarlos).
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const REQUIRED = [SCOPES[0], SCOPES[1]];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

let auth = store.get('auth', null); // { refreshToken, accessToken, expiresAt, scope }
let refreshing = null;
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);

function save(next) {
  auth = next;
  if (next) store.set('auth', next);
  else store.del('auth');
  listeners.forEach((fn) => fn(status()));
}

export function creds() {
  const s = store.getSettings();
  return { clientId: (s.clientId || CONFIG.CLIENT_ID || '').trim(), clientSecret: (s.clientSecret || '').trim() };
}

export function isConfigured() {
  const c = creds();
  return !!(c.clientId && c.clientSecret);
}

/** 'signedIn' | 'signedOut' | 'unconfigured' */
export function status() {
  if (store.DEMO) return 'signedIn';
  if (!isConfigured()) return 'unconfigured';
  return auth?.refreshToken ? 'signedIn' : 'signedOut';
}

/** URL exacta de la app, que hay que registrar como "URI de redirección" en Google Cloud. */
export function appUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

/** Devuelve un access token válido, renovándolo si hace falta. */
export async function getAccessToken({ force = false } = {}) {
  if (!auth?.refreshToken) throw new AuthError('signedOut', 'No has iniciado sesión');
  if (!force && auth.accessToken && auth.expiresAt - Date.now() > 60_000) return auth.accessToken;
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function refresh() {
  const { clientId, clientSecret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === 'invalid_grant') {
      // Token revocado o caducado: hay que volver a iniciar sesión (una vez).
      save(null);
      store.set('authExpired', true);
      throw new AuthError('expired', 'La sesión de Google ha caducado. Vuelve a iniciar sesión.');
    }
    throw new AuthError('config', `Google rechazó la renovación (${data.error || res.status}). Revisa el Client ID y el secret.`);
  }
  save({ ...auth, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

async function exchange(code, redirectUri) {
  const { clientId, clientSecret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError('exchange', `No se pudo completar el login (${data.error_description || data.error || res.status}).`);
  const granted = (data.scope || '').split(' ');
  const missing = REQUIRED.filter((s) => !granted.includes(s));
  if (missing.length) {
    throw new AuthError('scopes', 'Faltan permisos de Calendar. Vuelve a iniciar sesión y marca todas las casillas.');
  }
  if (!data.refresh_token) throw new AuthError('no_refresh', 'Google no devolvió refresh token.');
  store.del('authExpired');
  save({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  });
}

// ---------- Login con Google Identity Services (popup) ----------

let gisPromise = null;
/** Carga la librería de Google por adelantado para que el popup se abra dentro del toque. */
export function preloadGis() {
  if (store.DEMO || window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error('No se pudo cargar Google Identity Services')); };
      document.head.append(s);
    });
  }
  return gisPromise;
}

/**
 * Inicia sesión. Llamar directamente desde un toque del usuario.
 * Devuelve una promesa en modo popup; en modo redirección la página se va a Google.
 */
export function signIn() {
  const { clientId } = creds();
  if (!isConfigured()) return Promise.reject(new AuthError('unconfigured', 'Falta el Client ID o el secret (Ajustes).'));
  const mode = store.getSettings().authMode || 'popup';
  if (mode === 'redirect' || !window.google?.accounts?.oauth2) {
    signInRedirect();
    return new Promise(() => {});
  }
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      ux_mode: 'popup',
      select_account: true, // con varias cuentas en el móvil, que siempre pregunte cuál usar
      callback: async (resp) => {
        if (resp.error) return reject(new AuthError('popup', resp.error_description || resp.error));
        try {
          await exchange(resp.code, 'postmessage');
          resolve();
        } catch (e) {
          // Si Google no da refresh token en popup, la redirección con prompt=consent lo garantiza.
          if (e.code === 'no_refresh') signInRedirect();
          reject(e);
        }
      },
      error_callback: (err) => reject(new AuthError('popup', err?.type === 'popup_closed' ? 'Ventana cerrada' : 'No se pudo abrir la ventana de Google. Prueba el modo "redirección" en Ajustes.')),
    });
    client.requestCode();
  });
}

function signInRedirect() {
  const { clientId } = creds();
  const state = crypto.randomUUID();
  store.set('oauthState', state);
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: appUrl(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  location.assign(`${AUTH_URL}?${p}`);
}

/** Al arrancar: si volvemos de Google con ?code=..., lo canjeamos. Devuelve true si hubo login. */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return false;
  const clean = appUrl() + (store.DEMO ? '?demo=1' : '') + location.hash;
  history.replaceState(null, '', clean);
  if (q.get('error')) throw new AuthError('denied', `Google: ${q.get('error')}`);
  if (q.get('state') !== store.get('oauthState')) throw new AuthError('state', 'Respuesta de login no válida (state). Inténtalo de nuevo.');
  store.del('oauthState');
  await exchange(q.get('code'), appUrl());
  return true;
}

export async function signOut() {
  const token = auth?.refreshToken;
  save(null);
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
    } catch { /* sin conexión: el token se queda sin usar */ }
  }
}
