/* TSG Biom service worker - caches the app shell only.
   The vendored runtimes (vendor/) and the biometric model (models/)
   are intentionally NOT cached here; they load from this origin over
   the network on every load so the bytes the app verifies are always
   the bytes currently served (the model is additionally SHA-256
   verified against the hash pinned in app code).

   v71 (Order 1 — the old-design flash): the shell strategy is
   NETWORK-FIRST. v69 and earlier used stale-while-revalidate,
   which paints the PREVIOUS version's shell for the whole first
   session after an update and only shows the new design on the
   next load — the Chairman watched exactly that on 2026-11-26.
   Now, whenever the network answers, the shell that paints is
   the shell the server currently serves; the cache is only the
   offline fallback, and it is only ever read from THIS version's
   cache, so two versions can never mix in one paint. Shell
   fetches bypass the HTTP cache (cache:'no-cache') so a stale
   intermediary copy cannot recreate the old paint one layer
   down, and a non-OK network answer falls back to the cache
   instead of painting a host error page. */
const CACHE = 'tsg-biom-shell-v71';
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

function shellKey(url) {
  /* The cache key for a shell URL, search stripped: the bKash
     return lands on the app URL carrying ?paymentID=...&status=...
     and must never be stored (or looked up) under its query URL. */
  return url.origin + url.pathname;
}
function isShellUrl(url) {
  const path = url.pathname;
  return SHELL.some(function (entry) {
    const p = new URL(entry, self.location.href).pathname;
    return p === path || (entry === './' && (path === '/' || path.endsWith('/')));
  });
}

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
  // v68: the detector binary parts live under /vendor/.../parts/,
  // so they inherit this rule — the bytes the app assembles and
  // hash-verifies are always the bytes currently served, never a
  // stale cached copy.
  if (url.pathname.indexOf('/models/') !== -1 || url.pathname.indexOf('/vendor/') !== -1) return;

  const isNav = event.request.mode === 'navigate';
  if (isNav || isShellUrl(url)) {
    /* v71: network-first for the document and every shell file. */
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then((res) => {
        if (res && res.ok) {
          if (isShellUrl(url) || isNav) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(shellKey(url), copy)).catch(() => {});
          }
          return res;
        }
        return shellFallback(event.request, isNav);
      }).catch(() => shellFallback(event.request, isNav))
    );
    return;
  }

  /* Anything else same-origin (outside the shell list): the
     previous stale-while-revalidate behaviour, but scoped to
     this version's cache only. */
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request)).then((hit) => {
      const network = fetch(event.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});

function shellFallback(request, isNav) {
  return caches.open(CACHE).then((cache) =>
    cache.match(shellKey(new URL(request.url)), { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      if (isNav) return cache.match(shellKey(new URL('./index.html', self.location.href)), { ignoreSearch: true });
      return hit;
    })
  );
}
