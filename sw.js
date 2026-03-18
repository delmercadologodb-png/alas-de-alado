const CACHE = 'alas-de-alado-v7'; // Incrementa la versión para activar el nuevo cache
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
  
  // No cachear llamadas a la API - Siempre ir a la red
  if (url.includes('script.google.com')) {
    e.respondWith(
      fetch(e.request)
        .then(response => response)
        .catch(() => {
          // Si no hay red, devolver un error amigable
          return new Response(JSON.stringify({ 
            ok: false, 
            error: 'offline',
            message: 'Sin conexión a internet'
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // No cachear fuentes de Google (ya están en el navegador)
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    e.respondWith(fetch(e.request));
    return;
  }
  
  // Para archivos HTML: estrategia network-first con fallback a cache
  if (url.endsWith('.html') || url === BASE + '/' || url === BASE) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Actualizar cache con la nueva versión
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  
  // Para assets estáticos (imágenes, manifest, etc): cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
