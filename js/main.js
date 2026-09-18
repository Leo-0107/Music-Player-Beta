// Compatibility bootstrap for the refactor branch.
// Keep the original runtime as the source of truth while preventing duplicate
// audio graph and event registrations during the migration.

const bootstrap = window.__MUSIC_PLAYER_BOOTSTRAP__ || (window.__MUSIC_PLAYER_BOOTSTRAP__ = {
  started: false,
  ready: false,
  promise: null,
  script: null,
});

if (!bootstrap.started) {
  bootstrap.started = true;

  bootstrap.promise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-music-player-runtime="legacy"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        bootstrap.ready = true;
        resolve();
      }, { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Legacy runtime failed to load.')), { once: true });
      return;
    }

    const legacyRuntime = document.createElement('script');
    legacyRuntime.src = './script.js';
    legacyRuntime.async = false;
    legacyRuntime.dataset.musicPlayerRuntime = 'legacy';

    legacyRuntime.onload = () => {
      bootstrap.ready = true;
      resolve();
    };

    legacyRuntime.onerror = () => {
      reject(new Error('Legacy runtime failed to load.'));
    };

    bootstrap.script = legacyRuntime;
    document.head.appendChild(legacyRuntime);
  });
}

window.musicPlayerBootstrapReady = bootstrap.promise;

document.documentElement.dataset.musicPlayerReady = bootstrap.ready ? 'true' : 'loading';
