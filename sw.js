// Service worker: la app funciona sin conexión.
// Estrategia "stale-while-revalidate": sirve al instante lo que hay en caché y, en segundo
// plano, descarga la versión nueva (se verá en la siguiente apertura).
// Sube VERSION cuando añadas o renombres archivos de la lista ASSETS.
const VERSION = 'v1';
const CACHE = `tracker-${VERSION}`;
const FONTS = 'tracker-fonts';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './config.js',
  './css/styles.css',
  './js/app.js',
  './js/auth.js',
  './js/backup.js',
  './js/dates.js',
  './js/gcal.js',
  './js/mock.js',
  './js/model.js',
  './js/store.js',
  './js/sync.js',
  './js/ui/actions.js',
  './js/ui/calendar.js',
  './js/ui/dom.js',
  './js/ui/editor.js',
  './js/ui/items.js',
  './js/ui/settings.js',
  './js/ui/today.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('tracker-') && k !== CACHE && k !== FONTS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(e, req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req));
  }
  // Todo lo demás (APIs de Google) va directo a la red: los datos offline los guarda la app.
});

async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(CACHE);
  // Las navegaciones (incluida la vuelta del login con ?code=...) siempre sirven index.html.
  const key = req.mode === 'navigate' ? './index.html' : req;
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  // En local (desarrollo) primero la red, para ver los cambios al recargar.
  if (self.location.hostname === 'localhost') return (await network) || cached || new Response('Sin conexión', { status: 503 });
  if (cached) {
    e.waitUntil(network);
    return cached;
  }
  return (await network) || new Response('Sin conexión', { status: 503 });
}

async function cacheFirst(req) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}
