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
  const STARTUP_WATCHDOG_MS = 30000;

  let startupWatchdog = setTimeout(() => {
    console.error("Music Player startup watchdog: forcing app reveal");
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (fill) fill.style.width = "100%";
    if (percentText) percentText.textContent = "100%";
    if (messageText) messageText.textContent = "ホーム画面を表示します...";
    document.body.classList.remove("app-loading");
    document.getElementById("appLoadingScreen")?.remove();
  }, STARTUP_WATCHDOG_MS);

  window.__musicPlayerStartupFinished = () => {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
  };

  function updateStartupProgress(percent, message) {
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    const value = Math.max(0, Math.min(99, Math.round(percent)));
    if (fill) fill.style.width = value + "%";
    if (percentText) percentText.textContent = value + "%";
    if (messageText && message) messageText.textContent = message;
  }

  function finishStartupRecovery(message) {
    if (startupWatchdog) {
      clearTimeout(startupWatchdog);
      startupWatchdog = null;
    }
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (fill) fill.style.width = "100%";
    if (percentText) percentText.textContent = "100%";
    if (messageText) messageText.textContent = message || "ホーム画面を表示します...";
    document.body.classList.remove("app-loading");
    document.getElementById("appLoadingScreen")?.remove();
  }

  window.addEventListener("error", event => {
    if (document.body.classList.contains("app-loading")) {
      console.error("Music Player startup error:", event.error || event.message);
    }
  });
  window.addEventListener("unhandledrejection", event => {
    if (document.body.classList.contains("app-loading")) {
      console.error("Music Player startup rejection:", event.reason);
    }
  });

  updateStartupProgress(3, "アプリを起動しています...");

  function loadScriptPart(file, attempt = 0) {
    const url = new URL(file, base).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    return fetch(url, { cache: 'no-cache', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${file}: ${response.status}`);
        return response.text();
      })
      .then(text => {
        updateStartupProgress(8, file + " を読み込んでいます...");
        return text;
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
      updateStartupProgress(45, "アプリ本体を準備しています...");
      const original = `(() => {\n${parts.join('\n')}})();`;
      const blob = new Blob([original], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const script = document.createElement('script');
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
      };

      script.onload = () => {
        cleanup();
        // ui.js側の通常ロード完了処理に任せる。30秒を超えた場合だけwatchdogが復旧する。
      };
      script.onerror = () => {
        cleanup();
        console.error('Music Player JS execution failed');
        finishStartupRecovery("ホーム画面を表示します...");
      };
      script.src = url;
      document.head.appendChild(script);
    })
    .catch(err => {
      console.error('Music Player JS load error:', err);
      finishStartupRecovery("ホーム画面を表示します...");
    });
})();
