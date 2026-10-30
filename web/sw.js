/* Umbra IA — service worker (app shell hors-ligne) */
const VERSION = 'umbra-v2.0.4';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/manrope.local.css',
  '/fonts/serif.local.css',
  '/fonts/xn7gYHE41ni1AdIRggexSg.woff2',
  '/fonts/xn7gYHE41ni1AdIRggmxSuXd.woff2',
  '/fonts/jizBRFtNs2ka5fXjeivQ4LroWlx-6zsTjmbI.woff2',
  '/fonts/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjg.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // jamais de cache pour l'API

  // Réseau d'abord pour le document, cache en secours
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Cache d'abord pour les ressources statiques
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
