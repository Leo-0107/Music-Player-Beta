// ctrl.js
(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js?v=7.4.53-r61', { updateViaCache: 'none' }).catch(err => { console.error('Service Worker registration failed:', err); window.__musicPlayerReportError?.('SW', 'registration', err); });
  }

  const base = new URL('.', document.currentScript?.src || 'js/1.%20ctrl.js');
  const files = [
    '5. storage.js?v=7.4.53-r61',
    '4. state.js?v=7.4.53-r61',
    '2. audio.js?v=7.4.53-r61',
    '3. audio-output.js?v=7.4.53-r61',
    '6. library.js?v=7.4.53-r61',
    '7. ui.js?v=7.4.53-r61',
    '9. youtube.js?v=7.4.53-r61'
  ];

  const LOAD_TIMEOUT_MS = 20000;
  const LOAD_RETRY_COUNT = 1;
  const startupFileProgress = new Map(files.map(file => [file, 0]));
  let startupDisplayedProgress = 0;
  let startupTargetProgress = 0;
  let startupScriptsLoaded = false;

  // 実際の取得進捗を直接表示し、背景タブでのタイマー間引きに依存しない。
  function updateStartupProgress(percent, message, immediate = false) {
    startupTargetProgress = Math.max(0, Math.min(100, Math.round(percent)));
    startupDisplayedProgress = startupTargetProgress;
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (messageText && message) messageText.textContent = message;
    if (fill) fill.style.width = startupDisplayedProgress + "%";
    if (percentText) percentText.textContent = startupDisplayedProgress + "%";
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
    updateScriptFetchProgress();
    const url = new URL(file, base).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    return fetch(url, { cache: 'no-cache', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
        return readScriptResponse(response, file);
      })
      .catch(async error => {
        clearTimeout(timer);
        if (attempt < LOAD_RETRY_COUNT) {
          console.warn(`Music Player JS retry: ${file} (${attempt + 1}/${LOAD_RETRY_COUNT})`, error);
          await new Promise(resolve => setTimeout(resolve, 500));
          return loadScriptPart(file, attempt + 1);
        }
        const cached = await caches.match(url, { ignoreSearch: true });
        if (!cached) throw error;
        console.warn(`Music Player JS cache fallback: ${file}`);
        const text = await cached.text();
        startupFileProgress.set(file, 1);
        updateScriptFetchProgress();
        return text;
      })
      .finally(() => clearTimeout(timer));
  }

  async function loadScriptPartsWithLimitedConcurrency() {
    const parts = new Array(files.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        parts[index] = await loadScriptPart(files[index]);
      }
    };
    // 同時取得数を3本に抑え、低メモリ端末での一時バッファ負荷を軽減する。
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()));
    return parts;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !startupScriptsLoaded) updateScriptFetchProgress();
  });
  window.addEventListener("pageshow", () => {
    if (!startupScriptsLoaded) updateScriptFetchProgress();
  });

  loadScriptPartsWithLimitedConcurrency()
    .then(parts => {
      startupScriptsLoaded = true;
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