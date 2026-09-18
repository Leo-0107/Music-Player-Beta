(() => {
  const install = () => {
    const runtime = window.__MUSIC_PLAYER_RUNTIME__ || {};
    if (!runtime.loaded) {
      runtime.loaded = true;
      window.__MUSIC_PLAYER_RUNTIME__ = runtime;
    }
    return runtime;
  };

  const bootstrap = window.__MUSIC_PLAYER_BOOTSTRAP__ || (window.__MUSIC_PLAYER_BOOTSTRAP__ = {
    started: false,
    ready: false,
    promise: null,
    script: null,
    loader: null,
  });

  if (bootstrap.started) {
    document.documentElement.dataset.musicPlayerReady = bootstrap.ready ? "true" : "loading";
    return;
  }

  bootstrap.started = true;
  install();

  bootstrap.promise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-music-player-runtime="legacy"]');

    const finalize = () => {
      bootstrap.ready = true;
      document.documentElement.dataset.musicPlayerReady = "true";
      resolve();
    };

    const fail = (reason) => {
      bootstrap.ready = false;
      document.documentElement.dataset.musicPlayerReady = "error";
      reject(reason || new Error("Legacy runtime failed to load."));
    };

    const loadLegacy = () => {
      const legacyRuntime = document.createElement("script");
      legacyRuntime.src = "./script.js";
      legacyRuntime.async = false;
      legacyRuntime.dataset.musicPlayerRuntime = "legacy";
      legacyRuntime.onload = finalize;
      legacyRuntime.onerror = () => fail(new Error("Legacy runtime failed to load."));
      bootstrap.script = legacyRuntime;
      document.head.appendChild(legacyRuntime);
    };

    if (existing) {
      existing.addEventListener("load", finalize, { once: true });
      existing.addEventListener("error", () => fail(new Error("Legacy runtime failed to load.")), { once: true });
      if (existing.dataset.musicPlayerRuntime === "legacy") {
        if (existing.dataset.loaded === "true") finalize();
      }
      return;
    }

    loadLegacy();
  });

  window.musicPlayerBootstrapReady = bootstrap.promise;
  document.documentElement.dataset.musicPlayerReady = bootstrap.ready ? "true" : "loading";
})();
