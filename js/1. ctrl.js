(() => {
  const existing = document.querySelector('script[data-music-player-legacy="true"]');
  if (existing) return;

  const legacyScript = document.createElement('script');
  legacyScript.src = './script.js';
  legacyScript.async = false;
  legacyScript.dataset.musicPlayerLegacy = 'true';
  document.head.appendChild(legacyScript);

  const modulePaths = [
    './2. audio.js',
    './3. state.js',
    './4. storage.js',
    './5. library.js',
    './6. ui.js'
  ];

  const appendCompatModule = (path) => {
    const moduleScript = document.createElement('script');
    moduleScript.type = 'module';
    moduleScript.src = path;
    moduleScript.dataset.musicPlayerCompat = 'true';
    document.head.appendChild(moduleScript);
  };

  legacyScript.addEventListener('load', () => {
    modulePaths.forEach(appendCompatModule);
  }, { once: true });
})();
