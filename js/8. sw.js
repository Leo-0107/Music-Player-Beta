const CACHE_NAME = "music-player-app-v7.4.17";
const APP_SHELL = [
  "./sw.js",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/1. ctrl.js",
  "./js/2. audio.js",
  "./js/3. audio-output.js",
  "./js/4. state.js",
  "./js/5. storage.js",
  "./js/6. library.js",
  "./js/7. ui.js",
  "./js/8. sw.js",
  "./js/9. youtube.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function matchCachedRequest(request) {
  const url = new URL(request.url);
  const isVersionedAppAsset =
    url.origin === self.location.origin &&
    /\.(?:css|js)$/.test(url.pathname);

  return caches.open(CACHE_NAME).then(cache =>
    cache.match(request).then(exactMatch => {
      if (exactMatch || !isVersionedAppAsset) return exactMatch;
      // APP_SHELL stores local assets without the HTML version query string.
      return cache.match(request, { ignoreSearch: true });
    })
  );
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => matchCachedRequest(request))
  );
});
