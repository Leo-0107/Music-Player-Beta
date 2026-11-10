// ctrl.js
(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=7.4.39-r48', { updateViaCache: 'none' }).catch(err => { console.error('Service Worker registration failed:', err); window.__musicPlayerReportError?.('SW', 'registration', err); });
  }

  const base = new URL('.', document.currentScript?.src || 'js/1.%20ctrl.js');
  const files = [
    '5. storage.js?v=7.4.39-r48',
    '4. state.js?v=7.4.39-r48',
    '2. audio.js?v=7.4.39-r48',
    '3. audio-output.js?v=7.4.39-r48',
    '6. library.js?v=7.4.39-r48',
    '7. ui.js?v=7.4.39-r48',
    '9. youtube.js?v=7.4.39-r48'
  ];

  const LOAD_TIMEOUT_MS = 5000;
  const LOAD_RETRY_COUNT = 1;
  const startupFileProgress = new Map(files.map(file => [file, 0]));
  let startupDisplayedProgress = 0;
  let startupTargetProgress = 0;
  let startupProgressTimer = null;

  function updateStartupProgress(percent, message, immediate = false) {
    startupTargetProgress = Math.max(startupTargetProgress, Math.min(100, Math.round(percent)));
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (messageText && message) messageText.textContent = message;
    if (immediate) {
      if (startupProgressTimer !== null) clearTimeout(startupProgressTimer);
      startupProgressTimer = null;
      startupDisplayedProgress = startupTargetProgress;
      if (fill) fill.style.width = startupDisplayedProgress + "%";
      if (percentText) percentText.textContent = startupDisplayedProgress + "%";
      return;
    }
    const step = () => {
      if (startupDisplayedProgress < startupTargetProgress) {
        startupDisplayedProgress = Math.min(startupTargetProgress, startupDisplayedProgress + 1);
        if (fill) fill.style.width = startupDisplayedProgress + "%";
        if (percentText) percentText.textContent = startupDisplayedProgress + "%";
      }
      if (startupDisplayedProgress < startupTargetProgress) {
        startupProgressTimer = setTimeout(() => { startupProgressTimer = null; step(); }, 4);
      } else startupProgressTimer = null;
    };
    if (fill) fill.style.width = startupDisplayedProgress + "%";
    if (percentText) percentText.textContent = startupDisplayedProgress + "%";
    if (startupProgressTimer === null) step();
  }

  function updateScriptFetchProgress() {
    const total = Array.from(startupFileProgress.values()).reduce((sum, value) => sum + value, 0);
    updateStartupProgress(Math.floor((total / files.length) * 20), "JavaScriptを読み込んでいます...");
  }

  window.__musicPlayerUpdateStartupProgress = updateStartupProgress;
  updateStartupProgress(0, "JavaScriptを読み込んでいます...");

  async function readScriptResponse(response, file) {
    const contentLength = Number(response.headers.get("content-length"));
    if (!response.body?.getReader || !Number.isFinite(contentLength) || contentLength <= 0) {
      const text = await response.text();
      startupFileProgress.set(file, 1);
      updateScriptFetchProgress();
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      received += result.value.byteLength;
      startupFileProgress.set(file, Math.min(0.999, received / contentLength));
      updateScriptFetchProgress();
    }
    startupFileProgress.set(file, 1);
    updateScriptFetchProgress();
    return new Blob(chunks).text();
  }

  function loadScriptPart(file, attempt = 0) {
    startupFileProgress.set(file, 0);
    const url = new URL(file, base).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    return fetch(url, { cache: 'no-cache', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
        return readScriptResponse(response, file);
      })
      .catch(error => {
        if (attempt < LOAD_RETRY_COUNT) {
          console.warn(`Music Player JS retry: ${file} (${attempt + 1}/${LOAD_RETRY_COUNT})`, error);
          return new Promise(resolve => setTimeout(resolve, 300))
            .then(() => loadScriptPart(file, attempt + 1));
        }

        // 通信が一時的に止まった場合は、Service Workerのキャッシュを最後の復旧手段として使う。
        return caches.match(url, { ignoreSearch: true }).then(cached => {
          if (!cached) throw error;
          console.warn(`Music Player JS cache fallback: ${file}`);
          return cached.text().then(text => {
            startupFileProgress.set(file, 1);
            updateScriptFetchProgress();
            return text;
          });
        });
      })
      .finally(() => clearTimeout(timer));
  }

  Promise.all(files.map(file => loadScriptPart(file)))
    .then(parts => {
      updateStartupProgress(20, "操作画面を準備しています...");
      const original = `(() => {
${parts.join('\n')}})();`;
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
        window.__musicPlayerReportError?.('BOOT', 'combined-script-execution', new Error('結合JavaScriptの実行に失敗しました'));
        document.body.classList.remove('app-loading');
        document.getElementById('appLoadingScreen')?.remove();
      };
      script.src = url;
      document.head.appendChild(script);
    })
    .catch(err => {
      console.error('Music Player JS load error:', err);
      window.__musicPlayerReportError?.('BOOT', 'script-load', err);
      document.body.classList.remove('app-loading');
      document.getElementById('appLoadingScreen')?.remove();
    });
})();