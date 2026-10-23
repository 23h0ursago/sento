// Offline support: always try the network first so updates show up right away,
// and fall back to the cached copy when offline.
// Bump CACHE when you deploy so old files are cleared.
const CACHE = 'sento-v8';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(request, { cache: 'no-cache' });
      if (res.ok) cache.put(request, res.clone());
      return res;
    } catch {
      return (await cache.match(request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
