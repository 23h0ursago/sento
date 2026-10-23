// Offline support: always try the network first so updates show up right away,
// and fall back to the cached copy when offline.
// Bump CACHE when you deploy so old files are cleared.
const CACHE = 'sento-v11';
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

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Zen Maru Gothic: keep a copy so the app looks the same offline
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
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
