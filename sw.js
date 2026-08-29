/* Calii Armado CH — service worker (§3.6)
   Network-first for the app shell: online always gets the freshest deploy, offline falls back to cache.
   BUMP CACHE_NAME on every deploy that changes index.html. */
const CACHE_NAME = 'calii-armado-v2-1';
const SHELL = [
  './',
  './index.html',
  './imagedb.json',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) { if (k !== CACHE_NAME) await caches.delete(k); }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co')) return; // never intercept live data
  e.respondWith((async () => {
    try {
      const net = await fetch(e.request);
      if (net && net.ok && (url.origin === self.location.origin || url.hostname.includes('cloudflare'))) {
        const copy = net.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      }
      return net;
    } catch (_) {
      return (await caches.match(e.request)) || (await caches.match('./index.html'));
    }
  })());
});
