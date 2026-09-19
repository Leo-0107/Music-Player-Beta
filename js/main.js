(() => {
  const bootstrap = window.__MUSIC_PLAYER_BOOTSTRAP__ || (window.__MUSIC_PLAYER_BOOTSTRAP__ = {
    started: false,
    ready: false,
    promise: null,
    script: null,
  });

  if (bootstrap.started) {
    document.documentElement.dataset.musicPlayerReady = bootstrap.ready ? "true" : "loading";
    return;
  }

  bootstrap.started = true;

  bootstrap.promise = new Promise((resolve, reject) => {
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

    const existingLegacy = document.querySelector('script[data-music-player-runtime="legacy"]');

    if (existingLegacy) {
      existingLegacy.addEventListener("load", finalize, { once: true });
      existingLegacy.addEventListener("error", () => fail(new Error("Legacy runtime failed to load.")), { once: true });
      if (existingLegacy.dataset.loaded === "true") {
        finalize();
      }
      return;
    }

    const legacyRuntime = document.createElement("script");
    legacyRuntime.src = "./script.js";
    legacyRuntime.async = false;
    legacyRuntime.dataset.musicPlayerRuntime = "legacy";
    legacyRuntime.dataset.loaded = "false";

    legacyRuntime.onload = () => {
      legacyRuntime.dataset.loaded = "true";
      finalize();
    };

    legacyRuntime.onerror = () => {
      fail(new Error("Legacy runtime failed to load."));
    };

    bootstrap.script = legacyRuntime;
    document.head.appendChild(legacyRuntime);
  });

  window.musicPlayerBootstrapReady = bootstrap.promise;
  document.documentElement.dataset.musicPlayerReady = bootstrap.ready ? "true" : "loading";
})();
