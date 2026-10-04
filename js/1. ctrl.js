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

  const LOAD_TIMEOUT_MS = 10000;
  const LOAD_RETRY_COUNT = 2;

  function loadScriptPart(file, attempt = 0) {
    const url = new URL(file, base).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    return fetch(url, { cache: 'no-cache', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
        return response.text();
      })
      .catch(error => {
        if (attempt < LOAD_RETRY_COUNT) {
          console.warn(`Music Player JS retry: ${file} (${attempt + 1}/${LOAD_RETRY_COUNT})`, error);
          return new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
            .then(() => loadScriptPart(file, attempt + 1));
        }
        throw error;
      })
      .finally(() => clearTimeout(timer));
  }

  Promise.all(files.map(file => loadScriptPart(file)))
    .then(parts => {
      const original = `(() => {\\n${parts.join('\\n')}})();`;
      const blob = new Blob([original], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const script = document.createElement('script');
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
      };

      script.onload = cleanup;
      script.onerror = () => {
        cleanup();
        console.error('Music Player JS execution failed');
        document.body.classList.remove('app-loading');
        document.getElementById('appLoadingScreen')?.remove();
      };
      script.src = url;
      document.head.appendChild(script);
    })
    .catch(err => {
      console.error('Music Player JS load error:', err);
      document.body.classList.remove('app-loading');
      document.getElementById('appLoadingScreen')?.remove();
    });
})();
