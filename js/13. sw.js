const CACHE_NAME = "music-player-app-v7.5.53-r53";
const CACHE_PREFIX = "music-player-app-v";
const JSZIP_URL = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
const APP_SHELL = [
  "./sw.js",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/1. ctrl.js",
  "./js/7. audio.js",
  "./js/11. audio-output.js",
  "./js/9. buffered-playback-engine.js",
  "./js/10. pcm-processing-worker.js",
  "./js/2. state.js",
  "./js/3. storage.js",
  "./js/4. library.js",
  "./js/6. ui.js",
  "./js/13. sw.js",
  "./js/5. youtube.js",
  "./js/8. pitch-worklet.js",
  "./js/12. speaker-delay-worklet.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(APP_SHELL);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        try {
          const response = await fetch(JSZIP_URL, { mode: "cors", signal: controller.signal });
          if (response.ok) await cache.put(JSZIP_URL, response);
        } catch {
          // CDNが使えない場合でも、アプリ本体のService Workerインストールは継続する。
        } finally {
          clearTimeout(timer);
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key.startsWith(CACHE_PREFIX))
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

function cacheNetworkResponseForEvent(event, networkPromise, cacheKey, shouldCache) {
  const cacheUpdate = networkPromise
    .then(response => {
      if (!shouldCache(response)) return;
      return caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, response.clone()));
    })
    .catch(() => {
      // Cache failure must not change the network response.
    });
  event.waitUntil(cacheUpdate);
  return networkPromise;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method === "GET" &&
      requestUrl.origin === self.location.origin &&
      requestUrl.searchParams.has("mp-network-check")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== "GET") return;

  if (requestUrl.href === JSZIP_URL) {
    const networkPromise = fetch(request);
    cacheNetworkResponseForEvent(event, networkPromise, request, response => response.ok);
    event.respondWith(
      networkPromise.catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request)))
    );
    return;
  }
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const networkPromise = fetch(new Request(request, { cache: "no-store" }));
    cacheNetworkResponseForEvent(event, networkPromise, "./index.html", response => response.ok);
    event.respondWith(
      networkPromise.catch(() => caches.open(CACHE_NAME).then(cache => cache.match("./index.html")))
    );
    return;
  }

  const networkPromise = fetch(request);
  cacheNetworkResponseForEvent(
    event,
    networkPromise,
    request,
    response => response.ok || response.type === "opaque"
  );
  event.respondWith(networkPromise.catch(() => matchCachedRequest(request)));
});
