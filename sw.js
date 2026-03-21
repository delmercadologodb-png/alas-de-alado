// ─────────────────────────────────────────────────────────
//  SERVICE WORKER — Alas de Alado
//  SOLUCIÓN CACHÉ: Cambia CACHE_VERSION cada vez que subas
//  cambios a GitHub. Ej: v9 → v10 → v11 …
// ─────────────────────────────────────────────────────────
const CACHE_VERSION = 'v11';                          // ← INCREMENTA ESTO CADA DEPLOY
const CACHE = 'alas-de-alado-' + CACHE_VERSION;
const BASE  = '/alas-de-alado';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png'
];

// ── INSTALL: precachear assets ────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: eliminar cachés anteriores ──────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── FETCH ────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 1. Nunca interceptar llamadas a la API de Google
  if (url.includes('script.google.com')) return;

  // 2. Nunca cachear fuentes de Google
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 3. HTML → network-first (siempre intenta la red primero)
  const isHtml =
    url.endsWith('.html') ||
    url === (self.location.origin + BASE + '/') ||
    url === (self.location.origin + BASE);

  if (isHtml) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 4. Assets estáticos → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── MENSAJE: forzar actualización desde la app ───────────
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
