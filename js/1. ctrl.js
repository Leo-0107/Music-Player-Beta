// ctrl.js
(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('Service Worker registration failed:', err));
  }
  const base = new URL('.', document.currentScript?.src || 'js/1.%20ctrl.js');
  const files = [
    '4. storage.js',
    '3. state.js',
    '2. audio.js',
    '5. library.js',
    '6. ui.js'
  ];

  Promise.all(files.map(file =>
    fetch(new URL(file, base).href).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${file}: ${r.status}`);
      return r.text();
    })
  ))
  .then(parts => {
    const original = `(() => {\n${parts.join('\n')}})();`;
    (0, eval)(original);
  })
  .catch(err => console.error('Music Player JS load error:', err));
})();
