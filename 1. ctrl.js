// ctrl.js
(() => {
  const base = new URL('.', document.currentScript?.src || 'js/1.%20ctrl.js');
  const files = [
    '4. storage.js',
    '3. state.js',
    '2. audio.js',
    '5. library.js',
    '6. ui.js'
  ];

  let index = 0;
  const loadNext = () => {
    if (index >= files.length) return;
    const script = document.createElement('script');
    script.src = new URL(files[index++], base).href;
    script.onload = loadNext;
    script.onerror = () => console.error(`Failed to load ${script.src}`);
    document.head.appendChild(script);
  };

  loadNext();
})();
