// Service worker — offline cache
const CACHE = "marathon-pwa-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./plan.js",
  "./store.js",
  "./sync.js",
  "./manifest.webmanifest",
  "./seed.json",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // network update in background
        fetch(e.request).then(resp => {
          if (resp && resp.ok) caches.open(CACHE).then(c => c.put(e.request, resp));
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then(resp => {
        if (resp && resp.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
