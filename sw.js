const CACHE_NAME = "mindspace-shell-v20260606-android";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=20260606-android",
  "./favicon.ico?v=20260606-android",
  "./assets/icon.svg?v=20260606-android",
  "./assets/icon-192.png?v=20260606-android",
  "./assets/icon-512.png?v=20260606-android",
  "./assets/icon-1024.png?v=20260606-android",
  "./assets/icon.png",
  "./css/style.css?v=20260606-android",
  "./js/config.js",
  "./js/supabase-service.js",
  "./js/quotes.js",
  "./js/storage.js",
  "./js/breathing.js",
  "./js/focus.js",
  "./js/app.js",
  "./js/pwa.js"
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
