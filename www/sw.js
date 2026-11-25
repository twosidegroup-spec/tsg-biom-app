/* TSG Biom service worker - caches the app shell only.
   The vendored runtimes (vendor/) and the biometric model (models/)
   are intentionally NOT cached here; they load from this origin over
   the network on every load so the bytes the app verifies are always
   the bytes currently served (the model is additionally SHA-256
   verified against the hash pinned in app code). */
const CACHE = 'tsg-biom-shell-v67';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './biometrics.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return; // cross-origin: network only
  // v64 (Seat 2 M-3): same-origin model and vendor paths are also
  // network-only — never matched from, or written to, this cache.
  if (url.pathname.indexOf('/models/') !== -1 || url.pathname.indexOf('/vendor/') !== -1) return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const network = fetch(event.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
