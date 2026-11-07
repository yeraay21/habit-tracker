// Configuración general. El Client ID es público (no es un secreto): puedes ponerlo aquí
// o en Ajustes dentro de la app. El client secret NUNCA va aquí: se pega en Ajustes y
// se queda solo en el móvil.
export const CONFIG = {
  CLIENT_ID: '', // p. ej. '1234567890-abcdef.apps.googleusercontent.com'
  TRACKER_CALENDAR_NAME: 'Tracker',
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
  SYNC_PAST_DAYS: 7,      // días hacia atrás que se descargan y guardan offline
  SYNC_FUTURE_DAYS: 35,   // días hacia delante
  DEFAULT_REVIEW_TIME: '22:00',
  AUTO_SYNC_MINUTES: 5,
};
