/* Umbra IA — service worker (app shell hors-ligne)
 *
 * Règle d'or : le code de l'application ne doit JAMAIS être servi périmé.
 * Une version précédente de ce fichier mettait app.js en « cache d'abord » :
 * après une mise à jour, l'interface affichait les nouveaux boutons (le HTML
 * arrivait du réseau) mais exécutait l'ancien JavaScript — boutons inertes.
 * Les fichiers de l'application passent donc en « réseau d'abord ».
 */
const VERSION = 'umbra-v2.1.1';

/* Fichiers à garder hors-ligne : polices et icônes, qui ne changent pas. */
const SHELL = [
  '/',
  '/index.html',
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

/* Le code de l'app : toujours demandé au réseau quand il est joignable. */
const TOUJOURS_FRAIS = new Set(['/', '/index.html', '/app.js', '/styles.css', '/manifest.webmanifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // addAll échoue en bloc si un seul fichier manque : on ajoute un par un.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Réseau d'abord, cache en secours (avec copie rafraîchie si le réseau répond). */
async function reseauDAbord(request, cle) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const copie = res.clone();
      caches.open(VERSION).then((c) => c.put(cle || request, copie)).catch(() => {});
    }
    return res;
  } catch {
    const hit = await caches.match(cle || request, { ignoreSearch: true });
    return hit || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/screenshots/')) return; // jamais de cache

  // Navigation : réseau d'abord, page en cache en secours (hors-ligne).
  if (request.mode === 'navigate') {
    event.respondWith(reseauDAbord(request, '/index.html'));
    return;
  }

  // Code et styles de l'app : jamais périmés.
  if (TOUJOURS_FRAIS.has(url.pathname)) {
    event.respondWith(reseauDAbord(request, url.pathname));
    return;
  }

  // Polices, icônes, images : le cache d'abord (elles ne changent pas).
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request)
          .then((res) => {
            if (res.ok) {
              const copie = res.clone();
              caches.open(VERSION).then((c) => c.put(request, copie)).catch(() => {});
            }
            return res;
          })
          .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || Response.error())),
    ),
  );
});

/* Permet à l'interface de forcer l'adoption immédiate d'une nouvelle version. */
self.addEventListener('message', (event) => {
  if (event.data === 'prendre-la-main') self.skipWaiting();
});
