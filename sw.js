const CACHE = 'alas-de-alado-v8';
const BASE = '/alas-de-alado';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  // ⚠️ CRÍTICO: NO INTERCEPTAR LLAMADAS A LA API
  if (url.includes('script.google.com')) {
    return;
  }
  
  // No cachear fuentes de Google
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  
  // Para archivos HTML: estrategia network-first
  if (url.endsWith('.html') || url === BASE + '/' || url === BASE) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Para assets estáticos: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
