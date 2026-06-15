const CACHE_NAME = "mindspace-shell-v1.1.0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=1.1.0",
  "./favicon.ico?v=1.1.0",
  "./assets/icon-192.png?v=1.1.0",
  "./assets/icon-512.png?v=1.1.0",
  "./assets/icon-1024.png?v=1.1.0",
  "./css/style.css?v=1.1.0",
  "./js/version.js?v=1.1.0",
  "./js/config.js?v=1.1.0",
  "./js/supabase-service.js?v=1.1.0",
  "./js/quotes.js?v=1.1.0",
  "./js/storage.js?v=1.1.0",
  "./js/breathing.js?v=1.1.0",
  "./js/focus.js?v=1.1.0",
  "./js/app.js?v=1.1.0",
  "./js/pwa.js?v=1.1.0"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  if (!isSameOrigin) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});
