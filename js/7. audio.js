  const BUILD_REVISION = 39;
  const PITCH_WORKLET_PROTOCOL_VERSION = 1;

  const titleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const container = entry.target;
      container._isIntersecting = entry.isIntersecting;
      const textEl = container.querySelector(".scroll-text");
      if (textEl && textEl.classList.contains("scrolling")) {
        if (entry.isIntersecting && document.visibilityState === "visible") {
          textEl.style.animationPlayState = "running";
        } else {
          textEl.style.animationPlayState = "paused";
        }
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".scroll-container").forEach(c => titleObserver.observe(c));

  let waveSmoothData = null;
  let waveTimeData = null;
  let waveTimeTargetData = null;
  const WAVE_TIME_UPDATE_INTERVAL = 0.1;
  const WAVE_TIME_SMOOTHING = 0.24;
  let waveTimeDisplayElapsed = 0;
  let waveBandBaseline = null;
  let leftDisplayLevel = 0;
  let rightDisplayLevel = 0;
  let waveDecayActive = false;
  let disconnectedOutputDeviceIds = new Set();
  // OS既定出力IDは js/11. audio-output.js 側で一元管理する。
  let knownPhysicalOutputDeviceIds = new Set();
  let pendingOutputDeviceRefresh = false;
  let playbackIntent = loadStr(STORAGE.lastPlayback, "") === "playing";
  let backgroundAudioShouldContinue = false;
  let backgroundPlaybackRecovery = false;

  function setPlaybackIntent(playing) {
    playbackIntent = !!playing;
    if (!playbackIntent) backgroundAudioShouldContinue = false;
    try {
      localStorage.setItem(STORAGE.lastPlayback, playbackIntent ? "playing" : "paused");
    } catch (e) {}
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = playbackIntent ? "playing" : "paused";
      } catch (e) {}
    }
  }

  async function recoverBackgroundPlayback() {
    // YouTubeはIFrame Playerが再生を担当するため、Audio要素の自動復帰対象から除外する。
    if (state.currentSong?.mediaType === "youtube" || String(state.currentSong?.name || "").startsWith("yt:")) return false;
    if (backgroundPlaybackRecovery || !playbackIntent || !state.currentSong) return false;
    backgroundPlaybackRecovery = true;
    try {
      ensureGraph();

      // 画面切り替え・スリープ復帰時はAudioContextの状態も即座に戻す。
      if (audioCtx && (audioCtx.state === "suspended" || audioCtx.state === "interrupted")) {
        try { await audioCtx.resume(); } catch (e) {}
      }

      // 復帰時は本体の再生再開を最優先にする。
      if (audio.paused) {
        try {
          await audio.play();
        } catch (e) {
          return false;
        }
      }

      // 追加スピーカーの復帰は本体再生を待たせない。
      startOutputBridge?.().catch(() => {});

      if ("mediaSession" in navigator) {
        try { navigator.mediaSession.playbackState = "playing"; } catch (e) {}
      }
      return !audio.paused;
    } finally {
      backgroundPlaybackRecovery = false;
    }
  }

  audio.addEventListener("play", () => {
    backgroundAudioShouldContinue = false;
    setPlaybackIntent(true);
  });

  audio.addEventListener("pause", () => {
    // ユーザー操作ではなくバックグラウンド移行で一時停止された場合は、
    // タイマーを挟まず直ちに復帰を試みる。
    if ((playbackIntent || backgroundAudioShouldContinue) && document.visibilityState === "hidden" && !backgroundPlaybackRecovery) {
      if (backgroundAudioShouldContinue && !playbackIntent) setPlaybackIntent(true);
      recoverBackgroundPlayback().catch(() => {});
    }
  });

  audio.addEventListener("ended", () => {
    setPlaybackIntent(false);
  });




  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll(".scroll-container").forEach(container => {
      const textEl = container.querySelector(".scroll-text");
      if (textEl && textEl.classList.contains("scrolling")) {
        if (document.visibilityState === "visible" && container._isIntersecting) {
          textEl.style.animationPlayState = "running";
        } else {
          textEl.style.animationPlayState = "paused";
        }
      }
    });
    if (document.visibilityState === "hidden") {
      savePlaybackMemory?.(true);
      const currentIsYoutube = state.currentSong?.mediaType === "youtube" || String(state.currentSong?.name || "").startsWith("yt:");
      // hiddenへ移る直前に実際に鳴っていた通常曲を記録し、OS側のpauseにも備える。
      backgroundAudioShouldContinue = !currentIsYoutube && !audio.paused;
      if (backgroundAudioShouldContinue && !playbackIntent) setPlaybackIntent(true);
      if (playbackIntent || backgroundAudioShouldContinue) {
        recoverBackgroundPlayback().catch(() => {});
      }
    } else if (document.visibilityState === "visible" && pendingOutputDeviceRefresh) {
      pendingOutputDeviceRefresh = false;
      setTimeout(() => {
        navigator.mediaDevices?.dispatchEvent?.(new Event("devicechange"));
      }, 0);
    } else if (playbackIntent || backgroundAudioShouldContinue) {
      if (backgroundAudioShouldContinue && !playbackIntent) setPlaybackIntent(true);
      recoverBackgroundPlayback().catch(() => {});
    }

    if (document.visibilityState === "visible" && (playbackIntent || backgroundAudioShouldContinue)) {
      recoverBackgroundPlayback().catch(() => {});
    }

    if (document.visibilityState === "visible" && !audio.paused) {
      lastFrameTime = performance.now();
      startWaveAnimation();
    }
  });

  window.addEventListener("pageshow", () => {
    if (backgroundAudioShouldContinue && !playbackIntent) setPlaybackIntent(true);
    if (playbackIntent || backgroundAudioShouldContinue) {
      recoverBackgroundPlayback().catch(() => {});
    }
  });

  function updateTitleTextAndScroll(element, text) {
    if (!element) return;
    const container = element.closest(".scroll-container");
    const isTopSongTitle = element.id === "nowTitle";
    element.classList.remove("scrolling");
    element.style.animationPlayState = "paused";
    element.textContent = text;

    let baseFontSize = 0;
    if (isTopSongTitle) {
      if (!element.dataset.fitBaseFontSize) {
        element.dataset.fitBaseFontSize = String(parseFloat(getComputedStyle(element).fontSize) || 18.4);
      }
      baseFontSize = Number(element.dataset.fitBaseFontSize) || 18.4;
      element.style.fontSize = `${baseFontSize}px`;
    }

    requestAnimationFrame(() => {
      if (!container) return;

      if (isTopSongTitle) {
        const availableWidth = container.clientWidth;
        if (availableWidth <= 0) return;

        // まず標準サイズを試し、収まらない場合だけ読みやすさを保てる範囲で縮小する。
        const minFontSize = Math.max(12, baseFontSize * 0.7);
        const fits = size => {
          element.style.fontSize = `${size}px`;
          return element.scrollWidth <= availableWidth + 1;
        };

        let overflow = 0;
        if (!fits(baseFontSize)) {
          if (fits(minFontSize)) {
            let low = minFontSize;
            let high = baseFontSize;
            for (let i = 0; i < 10; i++) {
              const middle = (low + high) / 2;
              if (fits(middle)) low = middle;
              else high = middle;
            }
            fits(low);
          } else {
            element.style.fontSize = `${minFontSize}px`;
            overflow = element.scrollWidth - availableWidth;
          }
        }

        if (overflow <= 6) return;
        element.style.setProperty("--scroll-dist", `-${overflow + 12}px`);
      } else {
        const overflow = element.scrollWidth - container.clientWidth;
        if (overflow > 6) {
          element.style.setProperty("--scroll-dist", `-${overflow + 12}px`);
        } else {
          return;
        }
      }

      element.classList.add("scrolling");
      if (container._isIntersecting && document.visibilityState === "visible") {
        element.style.animationPlayState = "running";
      }
    });
  }

  // 上部曲名の表示領域が変わったときも、同じ曲名を再計測してサイズを合わせる。
  if (el.nowTitle) {
    const nowTitleContainer = el.nowTitle.closest(".scroll-container");
    let nowTitleResizeFrame = 0;
    const refitNowTitle = () => {
      if (nowTitleResizeFrame) cancelAnimationFrame(nowTitleResizeFrame);
      nowTitleResizeFrame = requestAnimationFrame(() => {
        nowTitleResizeFrame = 0;
        updateTitleTextAndScroll(el.nowTitle, el.nowTitle.textContent || "");
      });
    };
    if (nowTitleContainer && typeof ResizeObserver !== "undefined") {
      const nowTitleResizeObserver = new ResizeObserver(refitNowTitle);
      nowTitleResizeObserver.observe(nowTitleContainer);
    }
    window.addEventListener("resize", refitNowTitle, { passive: true });
    window.addEventListener("orientationchange", refitNowTitle, { passive: true });
  }

  function saveState(){
    localStorage.setItem(STORAGE.favorites, JSON.stringify(state.favorites));
    localStorage.setItem(STORAGE.queue, JSON.stringify(state.queue));
    localStorage.setItem(STORAGE.playCounts, JSON.stringify(state.playCounts));
    localStorage.setItem(STORAGE.playHistory, JSON.stringify(state.playHistory));
    localStorage.setItem(STORAGE.playStats, JSON.stringify(state.playStats || {}));
    localStorage.setItem(STORAGE.playbackMonthly, JSON.stringify(state.playbackMonthly || {}));
    localStorage.setItem(STORAGE.eqState, JSON.stringify(state.eqState));
    localStorage.setItem(STORAGE.volume, String(currentVolumeTarget));
    localStorage.setItem(STORAGE.pitch, String(state.pitchSemitones));
    localStorage.setItem(STORAGE.shuffle, String(state.shuffle));
    localStorage.setItem(STORAGE.repeat, String(state.repeat));
    localStorage.setItem(STORAGE.favOnly, String(state.favOnly));
    localStorage.setItem(STORAGE.themeMode, state.themeMode);
    localStorage.setItem(STORAGE.customTheme, JSON.stringify(state.customTheme));
    localStorage.setItem(STORAGE.accentColor, state.accentColor || "#35D977");
    localStorage.setItem(STORAGE.playlists, JSON.stringify(state.playlists));
    localStorage.setItem(STORAGE.playlistOrder, JSON.stringify(state.playlistOrder || []));
    localStorage.setItem(STORAGE.crossfade, String(state.crossfade));
    localStorage.setItem(STORAGE.silenceSkip, String(state.silenceSkip));
    localStorage.setItem(STORAGE.dMode, state.dMode);
    localStorage.setItem(STORAGE.waveMode, state.waveMode);
    localStorage.setItem(STORAGE.waveParticleCount, String(state.waveParticleCount));
    localStorage.setItem(STORAGE.clippingProtection, String(state.clippingProtection));
    localStorage.setItem(STORAGE.channelLeft, String(currentLeftVolumeTarget));
    localStorage.setItem(STORAGE.channelRight, String(currentRightVolumeTarget));
    localStorage.setItem(STORAGE.micMonitorVolume, String(currentMicMonitorVolumeTarget));
    localStorage.setItem(STORAGE.micFeedbackProtection, "true");
    localStorage.setItem(STORAGE.micFeedbackStrength, String(state.micFeedbackStrength));
    localStorage.setItem(STORAGE.normalizeTrackVolume, String(state.normalizeTrackVolume !== false));
    localStorage.setItem(STORAGE.outputLevelDb, String(state.outputLevelDb));
    localStorage.setItem(STORAGE.loudnessCompression, String(state.loudnessCompression));
    localStorage.setItem(STORAGE.speakerPairSwap, "false");
    localStorage.setItem(STORAGE.visualizerSettings, JSON.stringify(state.visualizerSettings || {}));
    localStorage.setItem(STORAGE.visualizerModeSettings, JSON.stringify(state.visualizerModeSettings || {}));
    localStorage.setItem(STORAGE.outputRoutes, JSON.stringify(state.outputRoutes || []));
    localStorage.setItem(STORAGE.mainOutputDevice, state.mainOutputDeviceId || "");
    localStorage.setItem(STORAGE.speakerSettings, JSON.stringify(state.speakerSettings || {}));
    localStorage.setItem(STORAGE.playlistSettings, JSON.stringify(state.playlistSettings || {}));
  }

  function outputLevelDbToGain(value) {
    const db = Math.max(-12, Math.min(0, Number(value) || 0));
    return Math.pow(10, db / 20);
  }
  function applyOutputLevelDb(value, persist = true) {
    const parsed = Number(value);
    state.outputLevelDb = Math.max(-12, Math.min(0, Number.isFinite(parsed) ? parsed : 0));
    if (el.outputLevelDb) el.outputLevelDb.value = String(state.outputLevelDb);
    if (el.outputLevelDbText) {
      const db = state.outputLevelDb;
      el.outputLevelDbText.textContent = (db > 0 ? "+" : "") + db.toFixed(1) + " dB";
    }
    if (outputLevelGainNode && audioCtx) outputLevelGainNode.gain.setTargetAtTime(outputLevelDbToGain(state.outputLevelDb), audioCtx.currentTime, 0.08);
    if (persist) saveState();
  }
  function applyLoudnessCompression(value, persist = true) {
    const parsed = Number(value);
    state.loudnessCompression = Math.max(0, Math.min(100, Math.round(Number.isFinite(parsed) ? parsed : 0)));
    const intensity = state.loudnessCompression / 100;
    if (el.loudnessCompression) el.loudnessCompression.value = String(state.loudnessCompression);
    if (el.loudnessCompressionNumber) el.loudnessCompressionNumber.value = String(state.loudnessCompression);
    if (el.loudnessCompressionText) {
      el.loudnessCompressionText.textContent = state.loudnessCompression === 0 ? "OFF" : `${state.loudnessCompression}%`;
    }
    if (audioCtx) {
      const now = audioCtx.currentTime;
      if (loudnessCompressorNode) {
        loudnessCompressorNode.threshold.setTargetAtTime(-24, now, 0.04);
        loudnessCompressorNode.knee.setTargetAtTime(24, now, 0.04);
        loudnessCompressorNode.ratio.setTargetAtTime(1 + intensity * 7, now, 0.04);
        loudnessCompressorNode.attack.setTargetAtTime(0.003, now, 0.04);
        loudnessCompressorNode.release.setTargetAtTime(0.25, now, 0.04);
      }
      if (loudnessMakeupGainNode) {
        const makeupDb = intensity * 6;
        loudnessMakeupGainNode.gain.setTargetAtTime(Math.pow(10, makeupDb / 20), now, 0.08);
      }
    }
    if (persist) saveState();
  }
  function resetTrackLoudnessNormalization() {
    trackLoudnessRms = 0;
    lastTrackLoudnessUpdateAt = 0;
    if (trackLoudnessGainNode && audioCtx) {
      const now = audioCtx.currentTime;
      trackLoudnessGainNode.gain.cancelScheduledValues(now);
      trackLoudnessGainNode.gain.setTargetAtTime(1, now, 0.12);
    }
  }
  function updateTrackLoudnessNormalization() {
    if (state.normalizeTrackVolume === false) {
      if (trackLoudnessGainNode && audioCtx && Math.abs(trackLoudnessGainNode.gain.value - 1) > 0.01) resetTrackLoudnessNormalization();
      return;
    }
    if (!trackLoudnessAnalyser || !trackLoudnessData || !trackLoudnessGainNode || !audioCtx || audio.paused || !state.currentSong || Number(audio.currentTime) < 1.5) return;
    const now = audioCtx.currentTime;
    if (now - lastTrackLoudnessUpdateAt < 0.45) return;
    lastTrackLoudnessUpdateAt = now;
    trackLoudnessAnalyser.getFloatTimeDomainData(trackLoudnessData);
    let energy = 0;
    for (let i = 0; i < trackLoudnessData.length; i++) {
      const sample = trackLoudnessData[i] || 0;
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / trackLoudnessData.length);
    if (!Number.isFinite(rms) || rms < 0.008) return;
    trackLoudnessRms = trackLoudnessRms > 0 ? trackLoudnessRms * 0.82 + rms * 0.18 : rms;
    const canBoost = state.clippingProtection !== false && state.speakerSettings?.multipleOutputEnabled !== true;
    const maxGain = canBoost ? 1.8 : 1;
    const targetGain = Math.max(0.5, Math.min(maxGain, 0.12 / trackLoudnessRms));
    trackLoudnessGainNode.gain.setTargetAtTime(targetGain, now, 1.6);
  }
  if (el.outputLevelDb) {
    applyOutputLevelDb(state.outputLevelDb, false);
    el.outputLevelDb.addEventListener("input", () => applyOutputLevelDb(el.outputLevelDb.value));
  }
  if (el.loudnessCompression || el.loudnessCompressionNumber) {
    applyLoudnessCompression(state.loudnessCompression, false);
    el.loudnessCompression?.addEventListener("input", () => applyLoudnessCompression(el.loudnessCompression.value));
    el.loudnessCompressionNumber?.addEventListener("input", () => applyLoudnessCompression(el.loudnessCompressionNumber.value));
    el.loudnessCompressionNumber?.addEventListener("change", () => applyLoudnessCompression(el.loudnessCompressionNumber.value));
  }
  if (el.normalizeTrackVolume) {
    el.normalizeTrackVolume.checked = state.normalizeTrackVolume !== false;
    el.normalizeTrackVolume.addEventListener("change", () => {
      state.normalizeTrackVolume = !!el.normalizeTrackVolume.checked;
      resetTrackLoudnessNormalization();
      saveState();
    });
  }

  function setWaveMode(mode) {
    const validModes = ["3d", "2d", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];
    const nextMode = validModes.includes(mode) ? mode : "2d";
    if (!state.visualizerModeSettings) state.visualizerModeSettings = {};
    if (!state.visualizerModeSettings[state.waveMode]) state.visualizerModeSettings[state.waveMode] = {};
    state.visualizerModeSettings[state.waveMode].particleCount = state.waveParticleCount;
    state.waveMode = nextMode;
    const savedMode = state.visualizerModeSettings[nextMode];
    if (savedMode && Number.isFinite(Number(savedMode.particleCount))) {
      state.waveParticleCount = Math.max(0, Math.min(1200, Math.round(Number(savedMode.particleCount))));
      if (el.waveParticleCount) el.waveParticleCount.value = state.waveParticleCount;
      if (el.waveParticleCountText) el.waveParticleCountText.textContent = String(state.waveParticleCount);
    }
    saveState();
    waveTimeDisplayElapsed = WAVE_TIME_UPDATE_INTERVAL;
    if (typeof requestWaveStaticFrame === "function") requestWaveStaticFrame();

    [el.waveModeBtns, el.waveModeSettingsBtns].forEach(group => {
      if (!group) return;
      group.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.wave === state.waveMode);
      });
    });
  }

  [el.waveModeBtns, el.waveModeSettingsBtns].forEach(group => {
    if (!group) return;
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => setWaveMode(btn.dataset.wave));
    });
  });

  function requestWaveVisualDecay() {
    waveDecayActive = true;
    if (!isWaveAnimating) {
      isWaveAnimating = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(drawWave);
    }
  }

  function fmtTime(sec){
    if(!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function toast(msg){
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove("show"), 1400);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (err) {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; }).catch(() => {});
    }
  }

  function updateMediaSessionPosition() {
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1.0,
            position: Math.min(audio.currentTime || 0, audio.duration)
          });
        } catch(e) {}
      }
    }
  }

  function setupMediaSessionRemoteControls() {
    if (!('mediaSession' in navigator)) return;

    const bindAction = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
    };

    bindAction('play', async () => {
      setPlaybackIntent(true);
      ensureGraph();
      try {
        await audioCtx?.resume();
      } catch (e) {}
      try {
        if (audio.paused) await audio.play();
        await startOutputBridge?.();
      } catch (e) {}
      if ("mediaSession" in navigator) {
        try { navigator.mediaSession.playbackState = "playing"; } catch (e) {}
      }
      updatePlayPauseUI();
    });
    bindAction('pause', () => {
      setPlaybackIntent(false);
      if (!audio.paused) {
        audio.pause();
        updatePlayPauseUI();
      }
    });
    bindAction('previoustrack', () => { prevTrack(); });
    bindAction('nexttrack', () => { nextTrack(); });
    bindAction('stop', () => {
      setPlaybackIntent(false);
      audio.pause();
      audio.currentTime = 0;
      savePlaybackMemory?.(true);
      updatePlayPauseUI();
    });
    bindAction('seekbackward', details => {
      const skip = Number(details?.seekOffset) || 10;
      audio.currentTime = Math.max(0, audio.currentTime - skip);
      savePlaybackMemory?.(true);
      updateMediaSessionPosition();
    });
    bindAction('seekforward', details => {
      const skip = Number(details?.seekOffset) || 10;
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + skip);
      savePlaybackMemory?.(true);
      updateMediaSessionPosition();
    });
    bindAction('seekto', details => {
      if (details?.fastSeek && ('fastSeek' in audio)) audio.fastSeek(details.seekTime);
      else audio.currentTime = details.seekTime;
      savePlaybackMemory?.(true);
      updateMediaSessionPosition();
    });
  }

  function adjustColorLightness(hex, percent) {
    let num = parseInt(hex.replace("#",""), 16);
    if (isNaN(num)) return hex;
    let r = (num >> 16), g = ((num >> 8) & 0x00FF), b = (num & 0x0000FF);
    if (percent > 100) {
      let p = (percent - 100) / 100;
      r = Math.round(r + (255 - r) * p);
      g = Math.round(g + (255 - g) * p);
      b = Math.round(b + (255 - b) * p);
    } else {
      let p = percent / 100;
      r = Math.round(r * p);
      g = Math.round(g * p);
      b = Math.round(b * p);
    }
    return `rgb(${Math.min(255, Math.max(0, r))}, ${Math.min(255, Math.max(0, g))}, ${Math.min(255, Math.max(0, b))})`;
  }


let graphInputOwnership = null;

  function getGraphInputOwnership() {
    if (!graphInputOwnership) graphInputOwnership = new PcmGraphInputOwnership();
    return graphInputOwnership;
  }

  function setGraphInputNode(node, target = null) {
    if (node && !target) target = filters?.[0] || null;
    if (!node) return getGraphInputOwnership().set(null, null);
    return getGraphInputOwnership().set(node, target);
  }

  function clearGraphInputNode(expectedNode, expectedTarget = null) {
    return getGraphInputOwnership().clear(expectedNode, expectedTarget);
  }

  function canUseBufferedPlayback() {
    const rate = Number(currentRate);
    const userPitch = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
    const compensatedPitch = userPitch / Math.max(0.1, rate);
    return Number.isFinite(rate) && rate >= 0.5 && rate <= 2 &&
      compensatedPitch >= 0.5 && compensatedPitch <= 2;
  }

  async function switchBufferedPlaybackToMediaElement(error, resume = false) {
    if (!bufferedPlaybackMode || !bufferedPlaybackEngine) return false;
    ensureGraph();
    const url = bufferedPlaybackEngine.sourceUrl;
    const position = bufferedPlaybackEngine.currentTime;
    const shouldResume = !!resume || !bufferedPlaybackEngine.paused;
    bufferedPlaybackEngine.releaseForFallback();
    bufferedPlaybackMode = false;
    if (!url) return false;
    console.warn("Music Player PCM playback fallback:", error || "unsupported playback settings");
    mediaElement.src = url;
    mediaElement.playbackRate = currentRate;
    mediaElement.preservesPitch = true;
    setGraphInputNode(sourceNode, filters?.[0] || null);
    updatePitchShiftNode();

    const seekPosition = Math.max(0, Number(position) || 0);
    if (seekPosition > 0) {
      const applySeek = () => {
        if (mediaElement.readyState < 1) return false;
        try {
          mediaElement.currentTime = seekPosition;
          return true;
        } catch (e) {
          return false;
        }
      };
      let seekRestored = applySeek();
      if (!seekRestored) {
        seekRestored = await new Promise(resolve => {
          let settled = false;
          let timer = null;
          const finish = result => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            if (result) mediaElement.removeEventListener("loadedmetadata", onMetadata);
            resolve(!!result);
          };
          const onMetadata = () => {
            const restored = mediaElement.src === url && applySeek();
            mediaElement.removeEventListener("loadedmetadata", onMetadata);
            if (!settled) finish(restored);
          };
          mediaElement.addEventListener("loadedmetadata", onMetadata);
          timer = setTimeout(() => finish(applySeek()), 3000);
          if (applySeek()) finish(true);
        });
      }
      if (!seekRestored) {
        console.warn("Music Player fallback is waiting for metadata; playback remains paused until the saved position can be restored.");
        return false;
      }
    }

    if (shouldResume) await mediaElement.play();
    return true;
  }

  let outputTransitionPromise = Promise.resolve();
  let mainOutputDirectGainNode = null;
let mainOutputSinkInitializationPromise = null;
let mainOutputUsesDirectSink = false;
let mainOutputUsesNativeDestination = false;

  function failClosedMainOutputRouting(targetDeviceId = state.mainOutputDeviceId || "") {
    if (typeof muteAllAppOutputsForRoutingFailure === "function") {
      muteAllAppOutputsForRoutingFailure(targetDeviceId);
      return;
    }
    if (!state.speakerSettings || typeof state.speakerSettings !== "object") state.speakerSettings = {};
    state.speakerSettings.outputRoutingBlocked = true;
    state.mainOutputDeviceId = String(targetDeviceId || "");
    try { window.setYouTubeOutputRoutingBlocked?.(true); } catch (e) {}
    if (mainOutputDirectGainNode?.gain) mainOutputDirectGainNode.gain.value = 0;
    if (outputBridgeAudio) {
      outputBridgeAudio.volume = 0;
      try { outputBridgeAudio.pause(); } catch (e) {}
    }
    saveState();
  }

  function enableMainOutputAfterSinkConfirmed(expectedSinkId) {
    if (!audioCtx || !mainOutputDirectGainNode?.gain) return false;
    if (state.speakerSettings?.outputRoutingBlocked === true) return false;
    if ((state.mainOutputDeviceId || "") !== expectedSinkId) return false;
    const actualSinkId = audioCtx.sinkId;
    if (typeof actualSinkId === "string" && actualSinkId !== expectedSinkId) return false;
    const targetGain = state.speakerSettings?.mainEnabled === false ? 0 : 1;
    mainOutputDirectGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.01);
    return true;
  }

  function ensureGraph(){
    if(audioGraphReady) return;
    try {
      // 初期化失敗後も同じ AudioContext / MediaElementAudioSourceNode を再利用する。
      // createMediaElementSource() は同じ audio 要素に対して複数回実行できないため。
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
        if (typeof audioCtx.addEventListener === "function") {
          audioCtx.addEventListener("sinkchange", () => {
            const diagnostics = window.__musicPlayerSinkChangeDiagnostics || {
              requestCount: 0, successCount: 0, failureCount: 0, eventCount: 0
            };
            diagnostics.eventCount = (Number(diagnostics.eventCount) || 0) + 1;
            diagnostics.lastEventAtMs = Date.now();
            const sinkId = audioCtx.sinkId;
            diagnostics.lastEventSinkKind = typeof sinkId === "object"
              ? (sinkId?.type === "none" ? "none" : "other")
              : (sinkId ? "explicit" : "default");
            window.__musicPlayerSinkChangeDiagnostics = diagnostics;
          });
        }
        // バックグラウンド移行などでAudioContextだけが停止した場合も、
        // 再生意図が残っていれば状態変化を検知して音声経路を復帰させる。
        audioCtx.addEventListener("statechange", () => {
          if (!playbackIntent) return;
          if (audioCtx.state === "suspended" || audioCtx.state === "interrupted") {
            recoverBackgroundPlayback().catch(() => {});
          }
        });
      }
      if (!sourceNode) {
        sourceNode = audioCtx.createMediaElementSource(mediaElement);
      }
      
      const freqs = [60, 250, 1000, 4000, 12000];
      filters = freqs.map((f, i) => {
        const node = audioCtx.createBiquadFilter();
        node.type = i === 0 ? "lowshelf" : i === 4 ? "highshelf" : "peaking";
        node.frequency.value = f;
        node.gain.value = Number(state.eqState.gains[i] || 0);
        return node;
      });

      if (audioCtx.createStereoPanner) {
        pannerNode = audioCtx.createStereoPanner();
        pannerNode.pan.value = state.panValue;
      }

      if (audioCtx.createPanner) {
        panner3DNode = audioCtx.createPanner();
        panner3DNode.panningModel = 'HRTF';
        panner3DNode.distanceModel = 'inverse';
        panner3DNode.refDistance = 1.25;
        // HRTF移動中の距離減衰を抑え、位置変化による音量低下で定位が埋もれないようにする。
        panner3DNode.rolloffFactor = 0.18;
        panner3DNode.maxDistance = 10000;
        if (audioCtx.listener) {
          const listener = audioCtx.listener;
          if (listener.forwardX) {
            listener.forwardX.value = 0;
            listener.forwardY.value = 0;
            listener.forwardZ.value = -1;
            listener.upX.value = 0;
            listener.upY.value = 1;
            listener.upZ.value = 0;
          } else if (listener.setOrientation) {
            listener.setOrientation(0, 0, -1, 0, 1, 0);
          }
        }
        if (panner3DNode.positionX) {
          panner3DNode.positionX.value = 0;
          panner3DNode.positionY.value = 0;
          panner3DNode.positionZ.value = -1.5;
        } else {
          panner3DNode.setPosition(0, 0, -1.5);
        }
      }

      // PannerNode の3D経路は入力を明示的に1chへ整えてから渡し、出力のL/Rを安定して確保する。
      let panner3DInputGainNode = null;
      if (panner3DNode) {
        panner3DInputGainNode = audioCtx.createGain();
        panner3DInputGainNode.channelCountMode = "explicit";
        panner3DInputGainNode.channelCount = 1;
      }

      channelSplitter = audioCtx.createChannelSplitter(2);
      leftGainNode = audioCtx.createGain();
      rightGainNode = audioCtx.createGain();
      channelMerger = audioCtx.createChannelMerger(2);
      leftGainNode.gain.value = currentLeftVolumeTarget;
      rightGainNode.gain.value = currentRightVolumeTarget;

      outputSplitter = audioCtx.createChannelSplitter(2);
      leftLevelAnalyser = audioCtx.createAnalyser();
      rightLevelAnalyser = audioCtx.createAnalyser();
      waveOutputSplitter = audioCtx.createChannelSplitter(2);
      waveLeftOutputAnalyser = audioCtx.createAnalyser();
      waveRightOutputAnalyser = audioCtx.createAnalyser();
      leftLevelAnalyser.fftSize = 128;
      rightLevelAnalyser.fftSize = 128;
      // 非2Dビジュアライザー専用。2D用analyserのFFTサイズは変更しない。
      // 2048ポイントにして低音域の周波数分解能を高める。
      waveLeftOutputAnalyser.fftSize = 2048;
      waveRightOutputAnalyser.fftSize = 2048;
      waveLeftOutputAnalyser.smoothingTimeConstant = 0.42;
      waveRightOutputAnalyser.smoothingTimeConstant = 0.42;
      leftLevelData = new Uint8Array(leftLevelAnalyser.fftSize);
      rightLevelData = new Uint8Array(rightLevelAnalyser.fftSize);
      waveLeftOutputData = new Uint8Array(waveLeftOutputAnalyser.frequencyBinCount);
      waveRightOutputData = new Uint8Array(waveRightOutputAnalyser.frequencyBinCount);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = currentVolumeTarget;
      trackLoudnessGainNode = audioCtx.createGain();
      trackLoudnessGainNode.gain.value = 1;
      audio.volume = Math.min(1.0, Math.max(0.0, currentVolumeTarget));

      micReferenceAnalyser = audioCtx.createAnalyser();
      micReferenceAnalyser.fftSize = 256;
      micReferenceAnalyser.smoothingTimeConstant = 0.15;
      micReferenceData = new Uint8Array(micReferenceAnalyser.frequencyBinCount);

      // マイクモニターはプレイヤー音声の最終ミックスへ入れ、マイク音量だけ別調整する
      micGainNode = audioCtx.createGain();
      micGainNode.gain.value = currentMicMonitorVolumeTarget;
      finalMixGainNode = audioCtx.createGain();
      finalMixGainNode.gain.value = 1;
      outputLevelGainNode = audioCtx.createGain();
      outputLevelGainNode.gain.value = outputLevelDbToGain(state.outputLevelDb);
      // 音圧調整：PCM・通常再生・マイクを含む共通ミックスの後段で
      // 大きな音を圧縮し、メイクアップゲインで小さな音を相対的に聞き取りやすくする。
      loudnessCompressorNode = audioCtx.createDynamicsCompressor();
      loudnessMakeupGainNode = audioCtx.createGain();
      applyLoudnessCompression(state.loudnessCompression, false);

      // --- DynamicsCompressorNode (最終クリッピング保護) ---
      // masterGain は最大2.0倍まで許可されているため、-1dB/4:1では
      // 強いピークを十分に抑え切れず、後段で0dBを超える可能性がある。
      // 余裕を持った閾値と穏やかな比率で早めに圧縮し、急激な非線形処理を避ける。
      limiterNode = audioCtx.createDynamicsCompressor();
      limiterNode.threshold.setValueAtTime(-6.0, audioCtx.currentTime);
      limiterNode.knee.setValueAtTime(24, audioCtx.currentTime);
      limiterNode.ratio.setValueAtTime(2.5, audioCtx.currentTime);
      limiterNode.attack.setValueAtTime(0.005, audioCtx.currentTime);
      limiterNode.release.setValueAtTime(0.2, audioCtx.currentTime);

      trackLoudnessAnalyser = audioCtx.createAnalyser();
      trackLoudnessAnalyser.fftSize = 4096;
      trackLoudnessAnalyser.smoothingTimeConstant = 0;
      trackLoudnessData = new Float32Array(trackLoudnessAnalyser.fftSize);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      waveTimeData = new Uint8Array(analyser.fftSize);

      setGraphInputNode(sourceNode, filters[0]);
      for(let i=0; i<filters.length-1; i++) filters[i].connect(filters[i+1]);
      
      const pitchShiftNode = createPitchShifter(audioCtx);
      audioCtx._musicPlayerPitchShifter = pitchShiftNode;

      // 通常再生（ピッチ0）はピッチシフターを経由させず、元信号をそのまま使う。
      // ピッチ変更時だけ処理済み経路へ切り替える。
      const pitchBypassGainNode = audioCtx.createGain();
      const pitchProcessedGainNode = audioCtx.createGain();
      const pitchRouteNode = audioCtx.createGain();
      audioCtx._musicPlayerPitchRoute = pitchRouteNode;
      // Stable PCM insertion boundary: processed PCM already contains EQ/pitch,
      // so it enters here before the shared spatial and output graph.
      audioCtx._musicPlayerPostDspInputNode = pitchRouteNode;
      audioCtx._musicPlayerPitchBypassGain = pitchBypassGainNode;
      audioCtx._musicPlayerPitchProcessedGain = pitchProcessedGainNode;
      pitchBypassGainNode.gain.value = 1;
      pitchProcessedGainNode.gain.value = 0;

      const pitchRatio = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
      pitchShiftNode.pitch = pitchRatio;

      let spatialSourceNode = filters[filters.length - 1];
      spatialSourceNode.connect(pitchBypassGainNode);
      pitchShiftNode.connect(pitchProcessedGainNode);
      pitchBypassGainNode.connect(pitchRouteNode);
      audioCtx._musicPlayerPitchSource = spatialSourceNode;
      if (Math.abs(pitchRatio - 1) >= 0.0001) {
        spatialSourceNode.connect(pitchShiftNode);
      }
      pitchProcessedGainNode.connect(pitchRouteNode);
      spatialSourceNode = pitchRouteNode;
      if (pannerNode) {
        spatialSourceNode.connect(pannerNode);
        spatialSourceNode = pannerNode;
      }

      spatialDirectGainNode = audioCtx.createGain();
      spatial3DGainNode = audioCtx.createGain();
      spatialSourceNode.connect(spatialDirectGainNode);
      if (panner3DNode && panner3DInputGainNode) {
        spatialSourceNode.connect(panner3DInputGainNode);
        panner3DInputGainNode.connect(panner3DNode);
        panner3DNode.connect(spatial3DGainNode);
      }

      const use3DSpatialRoute = state.dMode !== "2D" && !!panner3DNode;
      spatialDirectGainNode.gain.value = use3DSpatialRoute ? 0 : 1;
      spatial3DGainNode.gain.value = use3DSpatialRoute ? 1 : 0;

      // 空間処理の出力をここで確実に2chへ整えてからL/Rを分離する。
      // mono入力ならL/Rへ均等にアップミックスし、stereo入力なら左右をそのまま維持する。
      const channelNormalizeNode = audioCtx.createGain();
      channelNormalizeNode.channelCountMode = "explicit";
      channelNormalizeNode.channelCount = 2;
      channelNormalizeNode.channelInterpretation = "speakers";
      spatialDirectGainNode.connect(channelNormalizeNode);
      spatial3DGainNode.connect(channelNormalizeNode);

      // パイプライン: 空間処理ルート -> 2ch正規化 -> L/R個別ゲイン -> masterGain -> (limiter) -> analyser -> destination
      // マスター音量・マイクを含む2chミックスを、各スピーカーの個別L/R調整より前で分岐する。
      // メイン側のL/R音量変更が登録スピーカーへ影響しないようにする。
      channelNormalizeNode.connect(trackLoudnessAnalyser);
      trackLoudnessAnalyser.connect(trackLoudnessGainNode);
      trackLoudnessGainNode.connect(masterGain);
      masterGain.connect(micReferenceAnalyser);
      masterGain.connect(finalMixGainNode);

      micFeedbackGainNode = audioCtx.createGain();
      micFeedbackGainNode.gain.value = 1;
      micFeedbackAnalyser = audioCtx.createAnalyser();
      micFeedbackAnalyser.fftSize = 256;
      micFeedbackAnalyser.smoothingTimeConstant = 0.12;
      micFeedbackData = new Uint8Array(micFeedbackAnalyser.frequencyBinCount);

      micGainNode.connect(finalMixGainNode);

      speakerBusNode = audioCtx.createGain();
      // PCMエンジン側の内部バッファで音声データを先行準備する。
      // 出力経路には追加の固定遅延を挿入せず、スピーカーバスへ直接接続する。
      finalMixGainNode.connect(outputLevelGainNode);
      outputLevelGainNode.connect(loudnessCompressorNode);
      loudnessCompressorNode.connect(loudnessMakeupGainNode);
      loudnessMakeupGainNode.connect(speakerBusNode);

      speakerBusNode.connect(channelSplitter);
      channelSplitter.connect(leftGainNode, 0, 0);
      channelSplitter.connect(rightGainNode, 1, 0);
      applyPairedSpeakerRouting();
      leftGainNode.connect(channelMerger, 0, 0);
      rightGainNode.connect(channelMerger, 0, 1);

      // 最終クリッピング保護はL/R個別ゲインの「後」に置く。
      if (state.clippingProtection) {
        channelMerger.connect(limiterNode);
        limiterNode.connect(outputSplitter);
        limiterNode.connect(analyser);
      } else {
        channelMerger.connect(outputSplitter);
        channelMerger.connect(analyser);
      }
      outputSplitter.connect(leftLevelAnalyser, 0);
      outputSplitter.connect(rightLevelAnalyser, 1);
      outputSplitter.connect(waveOutputSplitter);

      waveOutputSplitter.connect(waveLeftOutputAnalyser, 0);
      waveOutputSplitter.connect(waveRightOutputAnalyser, 1);

      // メイン出力は対応ブラウザではAudioContext.setSinkId()を優先する。
      // MediaStreamDestination + HTMLMediaElement はフォールバックとして残す。
      mainOutputDirectGainNode = audioCtx.createGain();
      // 保存済みの明示出力先がある場合、setSinkId成功を確認するまでdirect経路を開かない。
      mainOutputDirectGainNode.gain.value =
        state.speakerSettings?.outputRoutingBlocked === true ||
        state.speakerSettings?.mainEnabled === false ||
        !!state.mainOutputDeviceId ? 0 : 1;

      // Androidのホーム画面追加PWAでは、AudioContext.setSinkId()を使うと
      // Chromeのスタンドアロン音声経路で出力が途切れたり音が不安定になる場合がある。
      // 明示的な出力機器を指定していない場合は、OS標準のdestinationへ直接出力する。
      if (state.speakerSettings?.outputRoutingBlocked === true) {
        mainOutputUsesDirectSink = false;
        mainOutputUsesNativeDestination = isAndroidStandalonePwa() && !state.mainOutputDeviceId;
        if (mainOutputUsesNativeDestination) {
          analyser.connect(mainOutputDirectGainNode);
          mainOutputDirectGainNode.connect(audioCtx.destination);
        } else {
          ensureOutputBridge();
          if (outputBridgeAudio) {
            outputBridgeAudio.volume = 0;
            try { outputBridgeAudio.pause(); } catch (e) {}
          }
        }
      } else if (isAndroidStandalonePwa() && !state.mainOutputDeviceId) {
        mainOutputUsesDirectSink = false;
        mainOutputUsesNativeDestination = true;
        analyser.connect(mainOutputDirectGainNode);
        mainOutputDirectGainNode.connect(audioCtx.destination);
      } else if (typeof audioCtx.setSinkId === "function") {
        mainOutputUsesDirectSink = true;
        mainOutputUsesNativeDestination = false;
        analyser.connect(mainOutputDirectGainNode);
        // AudioContext.setSinkId() は出力先を選ぶだけなので、destination への接続も必要。
        mainOutputDirectGainNode.connect(audioCtx.destination);
        const initialMainOutputDeviceId = state.mainOutputDeviceId || "";
        mainOutputSinkInitializationPromise = audioCtx.setSinkId(initialMainOutputDeviceId).then(() => {
          if (initialMainOutputDeviceId) {
            enableMainOutputAfterSinkConfirmed(initialMainOutputDeviceId);
          }
        }).catch(async error => {
          mainOutputUsesDirectSink = false;
          mainOutputUsesNativeDestination = false;
          try { mainOutputDirectGainNode.disconnect(); } catch (e) {}
          ensureOutputBridge();
          if (outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
            outputBridgeAudio.volume = 0;
            try {
              await outputBridgeAudio.setSinkId(initialMainOutputDeviceId);
              if (state.speakerSettings?.outputRoutingBlocked !== true) {
                outputBridgeAudio.volume = state.speakerSettings?.mainEnabled === false ? 0 : 1;
              }
            } catch (fallbackError) {
              failClosedMainOutputRouting(initialMainOutputDeviceId);
              console.warn("Music Player output bridge fallback unavailable:", fallbackError);
            }
          } else if (initialMainOutputDeviceId) {
            failClosedMainOutputRouting(initialMainOutputDeviceId);
          } else if (outputBridgeAudio) {
            outputBridgeAudio.volume = state.speakerSettings?.mainEnabled === false ? 0 : 1;
          }
          applyAllSpeakerDelayNodes();
          console.warn("Music Player direct AudioContext output unavailable:", error);
        }).finally(() => {
          mainOutputSinkInitializationPromise = null;
        });
      } else {
        ensureOutputBridge();
        if (state.mainOutputDeviceId) {
          if (outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
            const initialMainOutputDeviceId = state.mainOutputDeviceId;
            outputBridgeAudio.volume = 0;
            mainOutputSinkInitializationPromise = outputBridgeAudio.setSinkId(initialMainOutputDeviceId).then(() => {
              if (
                state.speakerSettings?.outputRoutingBlocked !== true &&
                state.mainOutputDeviceId === initialMainOutputDeviceId
              ) {
                outputBridgeAudio.volume = state.speakerSettings?.mainEnabled === false ? 0 : 1;
              }
            }).catch(error => {
              failClosedMainOutputRouting(initialMainOutputDeviceId);
              console.warn("Music Player output device restore failed:", error);
            }).finally(() => {
              mainOutputSinkInitializationPromise = null;
            });
          } else {
            failClosedMainOutputRouting(state.mainOutputDeviceId);
          }
        }
      }

      mainDelayNode = audioCtx.createDelay(1.5);
      applyMainOutputDelayNode();

      audioGraphReady = true;
      updatePitchShiftNode();
      upgradePitchShifterToAudioWorklet(audioCtx).catch(error => {
        console.warn("Music Player AudioWorklet pitch upgrade unavailable; keeping ScriptProcessor fallback:", error);
      });
      syncAdditionalOutputRuntimes().catch(() => {});
    } catch(e) {
      audioGraphReady = false;
      graphInputOwnership?.reset();
      if (audioCtx) audioCtx._musicPlayerPostDspInputNode = null;
      // 途中まで構築した経路を切り離し、次回は同じ sourceNode から組み直す。
      // sourceNode 自体は破棄・再生成しない（同じ audio 要素への二重生成を防ぐ）。
      try { sourceNode?.disconnect(); } catch (ignore) {}
      console.error("Music Player audio graph initialization failed:", e);
      try { outputBridgeAudio?.pause(); } catch (ignore) {}
    }
  }


  async function resumeAudioCtx(){
    ensureGraph();
    if(audioCtx && audioCtx.state === "suspended"){
      try { await audioCtx.resume(); } catch{}
    }
  }

  async function upgradePitchShifterToAudioWorklet(ctx) {
    if (!ctx || !ctx.audioWorklet || typeof AudioWorkletNode !== "function") return false;
    if (ctx._musicPlayerPitchWorkletReady) return true;
    if (ctx._musicPlayerPitchWorkletUpgradePromise) return ctx._musicPlayerPitchWorkletUpgradePromise;

    ctx._musicPlayerPitchWorkletUpgradePromise = (async () => {
      const sourceNode = ctx._musicPlayerPitchSource;
      const oldShifter = ctx._musicPlayerPitchShifter;
      const oldGain = ctx._musicPlayerPitchProcessedGain;
      const routeNode = ctx._musicPlayerPitchRoute;
      if (!sourceNode || !oldShifter || !oldGain || !routeNode) return false;

      const moduleUrl = new URL("js/8. pitch-worklet.js?v=7.5.39-r39", document.baseURI).href;
      await ctx.audioWorklet.addModule(moduleUrl);
      if (audioCtx !== ctx || !audioGraphReady) return false;

      const workletNode = new AudioWorkletNode(ctx, "music-player-pitch-shifter", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { protocolVersion: PITCH_WORKLET_PROTOCOL_VERSION }
      });
      const userPitchRatio = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
      let pitchValue = Math.max(0.5, Math.min(2, bufferedPlaybackMode
        ? userPitchRatio / Math.max(0.1, Number(currentRate) || 1)
        : userPitchRatio));
      Object.defineProperty(workletNode, "pitch", {
        configurable: false,
        enumerable: true,
        get: () => pitchValue,
        set: value => {
          const next = Math.max(0.5, Math.min(2, Number(value) || 1));
          pitchValue = next;
          workletNode.port.postMessage({ type: "pitch", value: next });
        }
      });
      // Workletがアップグレード後にprocessorerrorを起こした場合に備え、
      // 旧ScriptProcessorノードを保持して再接続可能にしておく。
      ctx._musicPlayerPitchFallbackShifter = oldShifter;
      ctx._musicPlayerPitchFallbackGain = oldGain;
      if (!workletNode._musicPlayerProcessorErrorHandlerInstalled) {
        workletNode._musicPlayerProcessorErrorHandlerInstalled = true;
        workletNode.addEventListener("processorerror", () => {
          if (ctx !== audioCtx || !ctx._musicPlayerPitchWorkletReady ||
              ctx._musicPlayerPitchFallbackActive) return;
          ctx._musicPlayerPitchFallbackActive = true;
          ctx._musicPlayerPitchWorkletReady = false;
          ctx._musicPlayerPitchWorkletFailed = true;

          const now = ctx.currentTime;
          const currentPitchRatio = Math.max(0.5, Math.min(2,
            bufferedPlaybackMode
              ? Math.pow(2, Number(state.pitchSemitones || 0) / 12) / Math.max(0.1, Number(currentRate) || 1)
              : Math.pow(2, Number(state.pitchSemitones || 0) / 12)));
          const isNeutral = Math.abs(currentPitchRatio - 1) < 0.0001;
          try { sourceNode.disconnect(workletNode); } catch (e) {}
          try { workletNode.disconnect(); } catch (e) {}
          try { nextGain.disconnect(); } catch (e) {}

          try {
            sourceNode.connect(oldShifter);
            oldShifter.connect(oldGain);
            oldGain.connect(routeNode);
            oldShifter.pitch = currentPitchRatio;
            oldGain.gain.cancelScheduledValues(now);
            oldGain.gain.setValueAtTime(0, now);
            oldGain.gain.linearRampToValueAtTime(isNeutral ? 0 : 1, now + 0.05);
            if (ctx._musicPlayerPitchBypassGain) {
              ctx._musicPlayerPitchBypassGain.gain.cancelScheduledValues(now);
              ctx._musicPlayerPitchBypassGain.gain.setValueAtTime(
                Number(ctx._musicPlayerPitchBypassGain.gain.value) || 0, now);
              ctx._musicPlayerPitchBypassGain.gain.linearRampToValueAtTime(isNeutral ? 1 : 0, now + 0.05);
            }
            if (isNeutral) {
              try { sourceNode.disconnect(oldShifter); } catch (e) {}
            } else {
              try { sourceNode.connect(oldShifter); } catch (e) {}
            }
            ctx._musicPlayerPitchShifter = oldShifter;
            ctx._musicPlayerPitchProcessedGain = oldGain;
            console.warn("Music Player AudioWorklet processor failed; restored ScriptProcessor pitch path.");
          } catch (fallbackError) {
            // 代替経路の復旧にも失敗した場合は、無音／誤出力より安全停止を優先。
            try { oldGain.gain.setValueAtTime(0, now); } catch (e) {}
            try { ctx._musicPlayerPitchBypassGain?.gain.setValueAtTime(0, now); } catch (e) {}
            console.error("Music Player ScriptProcessor pitch fallback failed:", fallbackError);
          }
        }, { once: true });
      }

      const pitchProtocolReady = new Promise((resolve, reject) => {
        let timeoutId = null;
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          callback(value);
        };
        timeoutId = setTimeout(() => {
          finish(reject, new Error("Pitch Worklet protocol handshake timed out"));
        }, 1500);
        workletNode.port.onmessage = event => {
          const data = event.data || {};
          if (data.type !== "ready" && data.type !== "protocol-error") return;
          if (data.type === "ready" && data.protocolVersion === PITCH_WORKLET_PROTOCOL_VERSION) {
            finish(resolve, true);
          } else {
            finish(reject, new Error("Pitch Worklet protocol version mismatch"));
          }
        };
        try {
          workletNode.port.postMessage({ type: "hello", protocolVersion: PITCH_WORKLET_PROTOCOL_VERSION });
        } catch (error) {
          finish(reject, error);
        }
      });
      try {
        await pitchProtocolReady;
      } catch (protocolError) {
        try { workletNode.disconnect(); } catch (e) {}
        try { workletNode.port.close(); } catch (e) {}
        throw protocolError;
      }
      workletNode.pitch = pitchValue;

      const nextGain = ctx.createGain();
      nextGain.gain.value = 0;
      workletNode.connect(nextGain);
      nextGain.connect(routeNode);

      if (Math.abs(pitchValue - 1) >= 0.0001) {
        sourceNode.connect(workletNode);
      }

      const now = ctx.currentTime;
      const oldValue = Math.max(0, Number(oldGain.gain.value) || 0);
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldValue, now);
      oldGain.gain.linearRampToValueAtTime(0, now + 0.045);
      nextGain.gain.setValueAtTime(0, now);
      nextGain.gain.linearRampToValueAtTime(1, now + 0.045);

      ctx._musicPlayerPitchShifter = workletNode;
      ctx._musicPlayerPitchProcessedGain = nextGain;
      ctx._musicPlayerPitchWorkletReady = true;

      setTimeout(() => {
        if (!ctx._musicPlayerPitchWorkletReady) return;
        try { sourceNode.disconnect(oldShifter); } catch (e) {}
        try { oldShifter.disconnect(oldGain); } catch (e) {}
        try { oldGain.disconnect(routeNode); } catch (e) {}
        try { oldShifter.disconnect(); } catch (e) {}
        try { oldGain.disconnect(); } catch (e) {}
      }, 80);
      return true;
    })().finally(() => {
      ctx._musicPlayerPitchWorkletUpgradePromise = null;
    });

    return ctx._musicPlayerPitchWorkletUpgradePromise;
  }

  function resetPitchShifter() {
    const shifter = audioCtx?._musicPlayerPitchShifter;
    if (!shifter) return;
    try {
      if (shifter.port?.postMessage) shifter.port.postMessage({ type: "reset" });
      else if (typeof shifter.reset === "function") shifter.reset();
    } catch (e) {}
  }

  function updatePitchShiftNode(){
    const shifter = audioCtx?._musicPlayerPitchShifter;
    const pitchSource = audioCtx?._musicPlayerPitchSource;
    const userPitchRatio = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
    const pitchRatio = bufferedPlaybackMode ? userPitchRatio / Math.max(0.1, Number(currentRate) || 1) : userPitchRatio;
    const isNeutral = Math.abs(pitchRatio - 1) < 0.0001;

    if (shifter) shifter.pitch = pitchRatio;

    // ピッチ0ではピッチシフターへの音声入力そのものを外す。
    // 無音化した処理経路を裏で動かし続けることも避ける。
    if (pitchSource && shifter) {
      try { pitchSource.disconnect(shifter); } catch (e) {}
      if (!isNeutral) {
        try { pitchSource.connect(shifter); } catch (e) {}
      }
    }

    if (audioCtx?._musicPlayerPitchBypassGain && audioCtx?._musicPlayerPitchProcessedGain) {
      const now = audioCtx.currentTime;
      audioCtx._musicPlayerPitchBypassGain.gain.setTargetAtTime(isNeutral ? 1 : 0, now, 0.005);
      audioCtx._musicPlayerPitchProcessedGain.gain.setTargetAtTime(isNeutral ? 0 : 1, now, 0.005);
    }
  }

  function createPitchShifter(ctx){
    // 2グレインOLA方式を安定化したピッチシフター。
    // グレインの位相を読み出し位置から独立させ、常に50%オーバーラップで
    // クロスフェードする。これにより、旧実装で起きていた読み出し位置の
    // 不整合による「少しズレた音が重なる」症状と不規則なノイズを抑える。
    const node = ctx.createScriptProcessor(256, 2, 2);
    const grainSize = Math.max(2048, Math.round(ctx.sampleRate * 0.09));
    const hopSize = Math.floor(grainSize / 2);
    const bufferLength = grainSize * 6;
    const buffers = [new Float32Array(bufferLength), new Float32Array(bufferLength)];
    const stateRef = { pitch: 1 };

    let writeIndex = 0;
    let spawnCountdown = 0;
    let nextSlot = 0;
    const grains = [
      { active: false, readPos: 0, phase: 0 },
      { active: false, readPos: 0, phase: 0 }
    ];

    const wrap = value => {
      value %= bufferLength;
      return value < 0 ? value + bufferLength : value;
    };

    const readInterpolated = (buffer, pos) => {
      const p = wrap(pos);
      const i0 = Math.floor(p);
      const i1 = (i0 + 1) % bufferLength;
      const f = p - i0;
      return buffer[i0] * (1 - f) + buffer[i1] * f;
    };

    // Hann窓。50%オーバーラップ時の境界を滑らかにして、
    // 三角窓よりもグレイン境界の周期的な音色変化を抑える。
    const window = phase => {
      const x = Math.max(0, Math.min(1, phase));
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    };

    const getStartDelay = pitch => {
      // 高音側は読み出しが書き込み位置へ追いつきやすいため、
      // ピッチに応じて少し深い位置から読み出す。
      return grainSize * (pitch > 1 ? pitch + 0.35 : 1.35);
    };

    const spawnGrain = (pitch, writePos) => {
      const grain = grains[nextSlot];
      grain.active = true;
      grain.phase = 0;
      grain.readPos = wrap(writePos - getStartDelay(pitch));
      nextSlot = nextSlot === 0 ? 1 : 0;
    };

    const resetHeads = () => {
      const pitch = Math.max(0.5, Math.min(2, Number(stateRef.pitch) || 1));
      const startDelay = getStartDelay(pitch);
      const firstPos = wrap(writeIndex - startDelay);
      const secondPos = wrap(firstPos - hopSize * pitch);

      grains[0].active = true;
      grains[0].phase = 0;
      grains[0].readPos = firstPos;

      grains[1].active = true;
      grains[1].phase = 0.5;
      grains[1].readPos = secondPos;

      nextSlot = 0;
      spawnCountdown = hopSize;
    };

    node.reset = () => {
      buffers[0].fill(0);
      buffers[1].fill(0);
      writeIndex = 0;
      spawnCountdown = 0;
      nextSlot = 0;
      grains[0].active = false;
      grains[1].active = false;
      if (Math.abs(Number(stateRef.pitch) - 1) >= 0.0001) resetHeads();
    };

    node.onaudioprocess = e => {
      const input = e.inputBuffer;
      const output = e.outputBuffer;
      const pitch = Math.max(0.5, Math.min(2, Number(stateRef.pitch) || 1));
      const inputL = input.numberOfChannels ? input.getChannelData(0) : null;
      const inputR = input.numberOfChannels > 1 ? input.getChannelData(1) : inputL;
      const outputL = output.numberOfChannels ? output.getChannelData(0) : null;
      const outputR = output.numberOfChannels > 1 ? output.getChannelData(1) : outputL;

      for (let i = 0; i < output.length; i++) {
        // ピッチ1倍でもリングバッファには常に書き込んでおく。
        // そのためピッチ変更時にバッファを消去する必要がなく、
        // 変更直後の無音や余計な待ち時間を発生させない。
        buffers[0][writeIndex] = inputL ? inputL[i] : 0;
        buffers[1][writeIndex] = inputR ? inputR[i] : buffers[0][writeIndex];

        if (Math.abs(pitch - 1) < 0.0001) {
          if (outputL) outputL[i] = inputL ? inputL[i] : 0;
          if (outputR) outputR[i] = inputR ? inputR[i] : (inputL ? inputL[i] : 0);
          writeIndex = wrap(writeIndex + 1);
          continue;
        }

        if (spawnCountdown <= 0) {
          spawnGrain(pitch, writeIndex);
          spawnCountdown = hopSize;
        }

        let sumL = 0;
        let sumR = 0;
        let weight = 0;

        for (let g = 0; g < grains.length; g++) {
          const grain = grains[g];
          if (!grain.active) continue;

          const gain = window(grain.phase);
          if (gain > 0) {
            sumL += readInterpolated(buffers[0], grain.readPos) * gain;
            sumR += readInterpolated(buffers[1], grain.readPos) * gain;
            weight += gain;
          }

          grain.readPos = wrap(grain.readPos + pitch);
          grain.phase += 1 / grainSize;
          if (grain.phase >= 1) grain.active = false;
        }

        if (weight > 0.0001) {
          if (outputL) outputL[i] = sumL / weight;
          if (outputR) outputR[i] = sumR / weight;
        } else {
          if (outputL) outputL[i] = 0;
          if (outputR) outputR[i] = 0;
        }

        writeIndex = wrap(writeIndex + 1);
        spawnCountdown--;
      }
    };

    Object.defineProperty(node, "pitch", {
      get: () => stateRef.pitch,
      set: v => {
        const next = Math.max(0.5, Math.min(2, Number(v) || 1));
        if (Math.abs(next - stateRef.pitch) > 0.0001) {
          stateRef.pitch = next;
          if (Math.abs(next - 1) >= 0.0001) {
            resetHeads();
          } else {
            grains[0].active = false;
            grains[1].active = false;
            spawnCountdown = 0;
          }
        }
      }
    });

    return node;
  }

  function invalidateBufferedPcmProcessing() {
    // While audible PCM output is active, leave its scheduled tail intact.
    // applyPitchAndRate/applyEqGains will request a frame-aligned Worker handoff.
    if (bufferedPlaybackMode && bufferedPlaybackEngine &&
        audio.paused && !bufferedPlaybackEngine.playRequested &&
        typeof bufferedPlaybackEngine.cancelProcessedPcmQueue === "function") {
      bufferedPlaybackEngine.cancelProcessedPcmQueue();
    }
  }

  function applyPitchAndRate(){
    invalidateBufferedPcmProcessing();
    ensureGraph();
    if (bufferedPlaybackMode && !canUseBufferedPlayback()) {
      switchBufferedPlaybackToMediaElement(
        new Error("速度・ピッチの組み合わせがPCM経路の対応範囲外です"),
        !audio.paused || !!bufferedPlaybackEngine?.playRequested
      ).catch(error => {
        console.warn("Music Player playback fallback failed:", error);
      });
    } else {
      audio.playbackRate = currentRate;
      audio.preservesPitch = true;
      if (bufferedPlaybackMode && bufferedPlaybackEngine &&
          typeof bufferedPlaybackEngine.updateProcessingSettings === "function") {
        bufferedPlaybackEngine.updateProcessingSettings().catch(error => {
          switchBufferedPlaybackToMediaElement(error, !audio.paused).catch(fallbackError => {
            console.warn("Music Player playback fallback failed:", fallbackError);
          });
        });
      } else {
        updatePitchShiftNode();
      }
    }
    if (el.rateText) el.rateText.textContent = `${currentRate.toFixed(2)}x`;
    if (el.pitchText) el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
    updateMediaSessionPosition();
  }
  // --- 経過時間（dt）ベースの空間軌道更新 ---
  function updateSpatialAudio(dt) {
    if (!audioCtx || !panner3DNode || audio.paused || state.dMode === "2D") return;
    const panOffset = Math.max(-1, Math.min(1, Number(state.panValue) || 0)) * 1.8;
    const rotationSpeed = 1.5; // ラジアン/秒
    spatialAngle += rotationSpeed * dt;
    const t = spatialAngle;
    let x = 0, y = 0, z = 0;

    const setPos = (px, py, pz) => {
      if (panner3DNode.positionX) {
        panner3DNode.positionX.value = px;
        panner3DNode.positionY.value = py;
        panner3DNode.positionZ.value = pz;
      } else {
        panner3DNode.setPosition(px, py, pz);
      }
    };

    switch (state.dMode) {
      case "3D":
        // 前方定位を保ち、左右位置だけを連続的に変える。
        x = panOffset; y = 0; z = -1.5; setPos(x, y, z); break;
      case "4D": {
        // 4D：楕円軌道で前後左右を周回し、1周につき上下2回の起伏を作る。
        const phase = t * 0.55;
        x = Math.sin(phase) * 2.5;
        y = Math.sin(phase * 2) * 1.35;
        z = Math.cos(phase) * 2.0;
        setPos(x + panOffset, y, z);
        break;
      }
      case "8D": {
        // 8D：高さをほぼ固定し、頭の周囲を水平面で明確に一周する。
        const phase = t * 0.95;
        x = Math.sin(phase) * 2.6;
        y = 0;
        z = Math.cos(phase) * 2.6;
        setPos(x + panOffset, y, z);
        break;
      }
      case "16D": {
        // 16D：3軸を異なる周期で動かす非同期Lissajous軌道。
        const phase = t * 0.72;
        x = Math.sin(phase) * 2.45;
        y = (Math.sin(phase * 1.618) + 0.35 * Math.sin(phase * 0.5)) * 1.05;
        z = Math.cos(phase * 0.7071) * 2.45;
        setPos(x + panOffset, y, z);
        break;
      }
      case "2D":
      default:
        setPos(0, 0, 0); break;
    }
  }

  function updateSpatialAudioRouting() {
    if (!spatialDirectGainNode || !spatial3DGainNode) return;
    const use3DSpatialRoute = state.dMode !== "2D" && !!panner3DNode;
    const now = audioCtx ? audioCtx.currentTime : 0;
    const timeConstant = 0.02;

    spatialDirectGainNode.gain.cancelScheduledValues(now);
    spatial3DGainNode.gain.cancelScheduledValues(now);
    spatialDirectGainNode.gain.setTargetAtTime(use3DSpatialRoute ? 0 : 1, now, timeConstant);
    spatial3DGainNode.gain.setTargetAtTime(use3DSpatialRoute ? 1 : 0, now, timeConstant);
  }

  function setDMode(mode) {
    // 旧バージョンで保存されたBINAURALは、統合後の3Dとして扱う。
    const nextMode = mode === "BINAURAL" ? "3D" : mode;
    state.dMode = nextMode;
    saveState();
    const descriptions = {
      "2D": "2D：通常の左右ステレオで再生します。",
      "3D": "3D：HRTF方式で音源の方向を表現し、左右パンにも対応します。ヘッドホン推奨。",
      "4D": "4D：楕円軌道で前後左右を周回しながら、上下にも動きます。ヘッドホン推奨。",
      "8D": "8D：頭の周囲を水平面で一周し続けます。ヘッドホン推奨。",
      "16D": "16D：前後左右・上下を異なる周期で移動する複合的な立体軌道です。ヘッドホン推奨。"
    };
    if (el.dModeDesc) el.dModeDesc.textContent = descriptions[nextMode] || descriptions["2D"];
    if (el.dModeBtns) {
      el.dModeBtns.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.d === nextMode);
      });
    }
    if (mode === "2D" && panner3DNode) {
      if (panner3DNode.positionX) {
        panner3DNode.positionX.value = 0; panner3DNode.positionY.value = 0; panner3DNode.positionZ.value = 0;
      } else {
        panner3DNode.setPosition(0, 0, 0);
      }
    }
    updateSpatialAudioRouting();
  }

  if (el.dModeBtns) {
    el.dModeBtns.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => setDMode(btn.dataset.d));
    });
  }

  const CUSTOM_THEME_BACKGROUND_LAYOUT_KEY = "mp_custom_theme_background_layout_v1";
  function normalizeCustomThemeBackgroundLayout(value) {
    const source = value && typeof value === "object" ? value : {};
    const validRotations = [0, 90, 180, 270];
    const rotationValue = Number(source.rotation);
    const rotation = validRotations.includes(rotationValue)
      ? rotationValue
      : validRotations.reduce((best, candidate) => Math.abs(candidate - (Number.isFinite(rotationValue) ? rotationValue : 0)) < Math.abs(best - (Number.isFinite(rotationValue) ? rotationValue : 0)) ? candidate : best, 0);
    const normalizeView = device => {
      const view = source[device] && typeof source[device] === "object" ? source[device] : {};
      const number = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
      return {
        zoom: Math.max(1, Math.min(2.5, number(view.zoom, 1))),
        x: Math.max(0, Math.min(100, number(view.x, 50))),
        y: Math.max(0, Math.min(100, number(view.y, 50)))
      };
    };
    return { rotation, mobile: normalizeView("mobile"), desktop: normalizeView("desktop") };
  }
  function readCustomThemeBackgroundLayout() {
    try {
      return normalizeCustomThemeBackgroundLayout(JSON.parse(localStorage.getItem(CUSTOM_THEME_BACKGROUND_LAYOUT_KEY) || "null"));
    } catch {
      return normalizeCustomThemeBackgroundLayout(null);
    }
  }
  function saveCustomThemeBackgroundLayout(layout) {
    try {
      localStorage.setItem(CUSTOM_THEME_BACKGROUND_LAYOUT_KEY, JSON.stringify(normalizeCustomThemeBackgroundLayout(layout)));
      return true;
    } catch {
      return false;
    }
  }

  let customThemeBackgroundLayout = readCustomThemeBackgroundLayout();
  let customThemeBackgroundObjectUrl = null;
  let customThemeBackgroundPreviewObjectUrl = null;
  let customThemeBackgroundOriginalBlob = null;
  let customThemeBackgroundPendingBlob = null;
  let customThemeBackgroundDimensions = null;
  let customThemeBackgroundRenderToken = 0;
  let customThemeBackgroundPreviewToken = 0;

  function updateCustomThemeBackgroundStatus(hasImage, message = "") {
    if (el.customThemeBackgroundStatus) {
      el.customThemeBackgroundStatus.textContent = message || (hasImage ? "背景画像を保存済みです" : "背景画像は設定されていません");
    }
    if (el.btnClearCustomThemeBackground) el.btnClearCustomThemeBackground.disabled = !customThemeBackgroundOriginalBlob;
    const saveButton = document.getElementById("btnSaveCustomThemeBackground");
    if (saveButton) saveButton.disabled = !hasImage;
  }

  async function setCustomThemeBackgroundPreviewBlob(blob, prepared = null) {
    const token = ++customThemeBackgroundPreviewToken;
    if (customThemeBackgroundPreviewObjectUrl) {
      URL.revokeObjectURL(customThemeBackgroundPreviewObjectUrl);
      customThemeBackgroundPreviewObjectUrl = null;
    }
    if (!(blob instanceof Blob) || !/^image\/(png|jpeg|webp|avif)$/i.test(blob.type)) {
      updateCustomThemeBackgroundPreviews();
      return;
    }
    const rendered = prepared || await prepareCustomThemeBackground(blob, customThemeBackgroundLayout.rotation);
    if (token !== customThemeBackgroundPreviewToken || !rendered) {
      updateCustomThemeBackgroundPreviews();
      return;
    }
    customThemeBackgroundPreviewObjectUrl = URL.createObjectURL(rendered.blob);
    updateCustomThemeBackgroundPreviews();
  }

  function updateCustomThemeBackgroundPreviews() {
    const editor = document.getElementById("themeBackgroundEditor");
    if (editor) editor.hidden = !customThemeBackgroundPreviewObjectUrl;
    for (const device of ["mobile", "desktop"]) {
      const image = document.getElementById(device === "mobile" ? "themeBgPreviewMobile" : "themeBgPreviewDesktop");
      const stage = document.getElementById(device === "mobile" ? "themeBgMobileStage" : "themeBgDesktopStage");
      const view = customThemeBackgroundLayout[device];
      if (!image || !stage) continue;
      if (customThemeBackgroundPreviewObjectUrl) {
        if (image.src !== customThemeBackgroundPreviewObjectUrl) image.src = customThemeBackgroundPreviewObjectUrl;
        image.style.objectPosition = view.x + "% " + view.y + "%";
        image.style.transform = "scale(" + view.zoom + ")";
      } else {
        image.removeAttribute("src");
        image.style.transform = "";
      }
    }
    const controls = [
      ["themeBgMobileZoom", "themeBgMobileZoomValue", customThemeBackgroundLayout.mobile.zoom * 100, "%"],
      ["themeBgMobileX", "themeBgMobileXValue", customThemeBackgroundLayout.mobile.x, "%"],
      ["themeBgMobileY", "themeBgMobileYValue", customThemeBackgroundLayout.mobile.y, "%"],
      ["themeBgDesktopZoom", "themeBgDesktopZoomValue", customThemeBackgroundLayout.desktop.zoom * 100, "%"],
      ["themeBgDesktopX", "themeBgDesktopXValue", customThemeBackgroundLayout.desktop.x, "%"],
      ["themeBgDesktopY", "themeBgDesktopYValue", customThemeBackgroundLayout.desktop.y, "%"]
    ];
    controls.forEach(([inputId, outputId, value, suffix]) => {
      const input = document.getElementById(inputId);
      const output = document.getElementById(outputId);
      if (input && document.activeElement !== input) input.value = String(Math.round(value));
      if (output) output.textContent = Math.round(value) + suffix;
    });
    document.querySelectorAll("[data-theme-bg-rotation]").forEach(button => {
      const selected = Number(button.dataset.themeBgRotation) === customThemeBackgroundLayout.rotation;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  async function prepareCustomThemeBackground(blob, rotation) {
    if (!(blob instanceof Blob)) return null;
    let bitmap;
    let temporaryUrl = null;
    try {
      if (typeof createImageBitmap === "function") {
        bitmap = await createImageBitmap(blob);
      } else {
        temporaryUrl = URL.createObjectURL(blob);
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = temporaryUrl;
        });
      }
      const downscale = Math.min(1, 3072 / Math.max(bitmap.width, bitmap.height));
      const sourceWidth = Math.max(1, Math.round(bitmap.width * downscale));
      const sourceHeight = Math.max(1, Math.round(bitmap.height * downscale));
      const swapped = rotation % 180 !== 0;
      const width = swapped ? sourceHeight : sourceWidth;
      const height = swapped ? sourceWidth : sourceHeight;
      if (rotation === 0 && downscale === 1) return { blob, width, height };
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.translate(width / 2, height / 2);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(bitmap, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
      const outputType = blob.type === "image/jpeg" ? "image/jpeg" : blob.type === "image/webp" ? "image/webp" : "image/png";
      const outputBlob = await new Promise(resolve => canvas.toBlob(resolve, outputType, 0.92));
      if (!outputBlob) return null;
      return { blob: outputBlob, width, height };
    } catch {
      return null;
    } finally {
      bitmap?.close?.();
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    }
  }

  async function setCustomThemeBackgroundBlob(blob, prepared = null) {
    const token = ++customThemeBackgroundRenderToken;
    customThemeBackgroundOriginalBlob = blob instanceof Blob ? blob : null;
    if (customThemeBackgroundObjectUrl) {
      URL.revokeObjectURL(customThemeBackgroundObjectUrl);
      customThemeBackgroundObjectUrl = null;
    }
    customThemeBackgroundDimensions = null;
    if (!customThemeBackgroundOriginalBlob) {
      await setCustomThemeBackgroundPreviewBlob(null);
      updateCustomThemeBackgroundStatus(false);
      return true;
    }
    const rendered = prepared || await prepareCustomThemeBackground(customThemeBackgroundOriginalBlob, customThemeBackgroundLayout.rotation);
    if (!rendered || token !== customThemeBackgroundRenderToken) {
      updateCustomThemeBackgroundStatus(true, "画像を処理できませんでした。別の画像を選択してください");
      return false;
    }
    await setCustomThemeBackgroundPreviewBlob(customThemeBackgroundOriginalBlob, rendered);
    customThemeBackgroundDimensions = { width: rendered.width, height: rendered.height };
    customThemeBackgroundObjectUrl = URL.createObjectURL(rendered.blob);
    updateCustomThemeBackgroundStatus(true);
    return true;
  }

  async function restoreCustomThemeBackground() {
    customThemeBackgroundLayout = readCustomThemeBackgroundLayout();
    const blob = await loadCustomThemeBackground();
    await setCustomThemeBackgroundBlob(blob);
    applyTheme();
  }
  function applyTheme(){
    const safeAccent = /^#[0-9a-f]{6}$/i.test(String(state.accentColor || "")) ? state.accentColor : "#35D977";
    state.accentColor = safeAccent;
    const accentRgb = safeAccent.slice(1).match(/.{2}/g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2));
    const accentLuminance = 0.2126 * accentRgb[0] + 0.7152 * accentRgb[1] + 0.0722 * accentRgb[2];
    document.body.style.setProperty("--accent", safeAccent);
    document.body.style.setProperty("--accent-contrast", accentLuminance > 0.42 ? "#07120a" : "#ffffff");
    if (el.accentColorInput && el.accentColorInput.value.toLowerCase() !== safeAccent.toLowerCase()) el.accentColorInput.value = safeAccent;
    document.body.classList.remove("theme-light");
    [el.btnThemeSystem, el.btnThemeDark, el.btnThemeLight, el.btnThemeCustom].forEach(b => b?.classList.remove("active"));
    if (el.customThemeArea) el.customThemeArea.style.display = "none";

    document.body.style.removeProperty("--text");
    document.body.style.removeProperty("--muted");
    document.body.style.removeProperty("--bottom-nav-bg");
    document.body.style.removeProperty("--bg");

    let activeMode = state.themeMode;
    if(activeMode === "system"){
      if (el.btnThemeSystem) el.btnThemeSystem.classList.add("active");
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeMode = isSystemDark ? "dark" : "light";
    }

    if(activeMode === "light"){
      document.body.classList.add("theme-light");
      document.body.style.background = "";
      document.body.style.color = "";
      if(state.themeMode === "light" && el.btnThemeLight) el.btnThemeLight.classList.add("active");
    } else if(activeMode === "custom"){
      if (el.btnThemeCustom) el.btnThemeCustom.classList.add("active");
      if (el.customThemeArea) el.customThemeArea.style.display = "block";

      const { c1, l1, c2, l2, text, lText, dir } = state.customTheme;
      const computedC1 = adjustColorLightness(c1 || "#1d3557", l1 !== undefined ? l1 : 100);
      const computedC2 = adjustColorLightness(c2 || "#121212", l2 !== undefined ? l2 : 100);
      
      const baseLText = lText !== undefined ? lText : 100;
      const computedText = adjustColorLightness(text || "#ffffff", baseLText);
      const computedMuted = adjustColorLightness(text || "#ffffff", Math.round(baseLText * 0.65));

      if (customThemeBackgroundObjectUrl) {
        document.body.style.backgroundColor = computedC2;
        document.body.style.backgroundImage =
          `linear-gradient(${dir || "180deg"}, color-mix(in srgb, ${computedC1} 48%, transparent), color-mix(in srgb, ${computedC2} 48%, transparent)), url("${customThemeBackgroundObjectUrl}")`;
        const device = window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop";
        const view = customThemeBackgroundLayout[device];
        const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
        const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
        const scale = customThemeBackgroundDimensions
          ? Math.max(viewportWidth / customThemeBackgroundDimensions.width, viewportHeight / customThemeBackgroundDimensions.height) * view.zoom
          : view.zoom;
        const imageWidth = customThemeBackgroundDimensions ? Math.round(customThemeBackgroundDimensions.width * scale) : "cover";
        const imageHeight = customThemeBackgroundDimensions ? Math.round(customThemeBackgroundDimensions.height * scale) : "cover";
        document.body.style.backgroundSize = customThemeBackgroundDimensions
          ? "cover, " + imageWidth + "px " + imageHeight + "px"
          : "cover, cover";
        document.body.style.backgroundPosition = "center, " + view.x + "% " + view.y + "%";
        document.body.style.backgroundRepeat = "no-repeat, no-repeat";
      } else {
        document.body.style.background = `linear-gradient(${dir || "180deg"}, ${computedC1} 0%, ${computedC2} 100%)`;
      }
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.color = computedText;
      
      document.body.style.setProperty("--text", computedText);
      document.body.style.setProperty("--muted", computedMuted);
      document.body.style.setProperty("--bottom-nav-bg", computedC2);
      document.body.style.setProperty("--bg", computedC2);
    } else {
      document.body.style.background = "";
      document.body.style.color = "";
      if(state.themeMode === "dark" && el.btnThemeDark) el.btnThemeDark.classList.add("active");
    }

    // テーマ切替後も、ジャケット未設定時のキャンバス色を現在のテーマに合わせて再描画する。
    if (typeof updateArtwork === "function") updateArtwork(state.currentSong);
  }

  if (el.customThemeBackgroundInput) {
    el.customThemeBackgroundInput.addEventListener("change", () => {
      const file = el.customThemeBackgroundInput.files?.[0];
      el.customThemeBackgroundInput.value = "";
      if (!file) return;
      const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);
      if (!allowedTypes.has(file.type)) { toast("PNG・JPEG・WebP・AVIF画像を選択してください"); return; }
      if (file.size > 8 * 1024 * 1024) { toast("背景画像は8MB以下にしてください"); return; }
      customThemeBackgroundPendingBlob = file;
      setCustomThemeBackgroundPreviewBlob(file).then(() => {
        const previewReady = !!customThemeBackgroundPreviewObjectUrl;
        updateCustomThemeBackgroundStatus(previewReady, previewReady
          ? "新しい画像をプレビュー中です。配置を調整して保存してください"
          : "画像のプレビューを作成できませんでした。別の画像を選択してください");
      }).catch(error => {
        console.error("Custom theme background preview failed:", error);
        updateCustomThemeBackgroundStatus(false, "画像のプレビューに失敗しました。別の画像を選択してください");
        toast("背景画像のプレビューを作成できませんでした");
      });
    });
  }
  document.querySelectorAll("[data-theme-bg-rotation]").forEach(button => {
    button.addEventListener("click", () => {
      customThemeBackgroundLayout.rotation = Number(button.dataset.themeBgRotation);
      const previewBlob = customThemeBackgroundPendingBlob || customThemeBackgroundOriginalBlob;
      setCustomThemeBackgroundPreviewBlob(previewBlob);
      updateCustomThemeBackgroundPreviews();
      updateCustomThemeBackgroundStatus(true, "画像の向き・配置はまだ保存されていません");
    });
  });
  document.querySelectorAll("[data-theme-bg-setting]").forEach(input => {
    input.addEventListener("input", () => {
      const [device, key] = String(input.dataset.themeBgSetting || "").split(".");
      if (!["mobile", "desktop"].includes(device) || !["zoom", "x", "y"].includes(key)) return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      customThemeBackgroundLayout[device][key] = key === "zoom"
        ? Math.max(1, Math.min(2.5, value / 100))
        : Math.max(0, Math.min(100, value));
      updateCustomThemeBackgroundPreviews();
      updateCustomThemeBackgroundStatus(true, "画像の向き・配置はまだ保存されていません");
    });
  });
  const saveCustomThemeBackgroundButton = document.getElementById("btnSaveCustomThemeBackground");
  if (saveCustomThemeBackgroundButton) {
    saveCustomThemeBackgroundButton.addEventListener("click", async () => {
      if (saveCustomThemeBackgroundButton.dataset.saving === "true") return;
      const sourceBlob = customThemeBackgroundPendingBlob || customThemeBackgroundOriginalBlob;
      if (!sourceBlob) return;
      saveCustomThemeBackgroundButton.dataset.saving = "true";
      saveCustomThemeBackgroundButton.disabled = true;
      try {
        // 起動時のDB初期化に失敗した場合も、保存操作時に再接続を試みる。
        if (!await initDB()) {
          updateCustomThemeBackgroundStatus(true, "保存領域に接続できません。ブラウザのストレージ設定を確認してください");
          toast("背景画像を保存できませんでした。保存領域に接続できません");
          return;
        }
        const layout = normalizeCustomThemeBackgroundLayout(customThemeBackgroundLayout);
        const prepared = await prepareCustomThemeBackground(sourceBlob, layout.rotation);
        if (!prepared) {
          toast("画像を回転・変換できませんでした。このブラウザで対応する画像を選択してください");
          return;
        }
        const saved = await saveCustomThemeBackground(sourceBlob);
        if (!saved) {
          updateCustomThemeBackgroundStatus(true, "画像を端末内へ保存できませんでした。保存容量やブラウザの設定を確認してください");
          toast("背景画像を端末内へ保存できませんでした。保存容量やストレージ設定を確認してください");
          return;
        }
        if (!saveCustomThemeBackgroundLayout(layout)) {
          updateCustomThemeBackgroundStatus(true, "画像本体は保存されましたが、配置設定を保存できませんでした");
          toast("画像本体は保存されましたが、配置設定を保存できませんでした");
          return;
        }
        customThemeBackgroundLayout = layout;
        customThemeBackgroundPendingBlob = null;
        const applied = await setCustomThemeBackgroundBlob(sourceBlob, prepared);
        if (!applied) {
          toast("画像は保存されましたが、背景への適用に失敗しました");
          return;
        }
        applyTheme();
        updateCustomThemeBackgroundStatus(true, "背景画像とスマホ・PCの配置を保存しました");
        toast("カスタム背景画像と配置を保存しました");
      } catch (error) {
        console.error("Custom theme background save failed:", error);
        updateCustomThemeBackgroundStatus(true, "背景画像の保存中にエラーが発生しました。もう一度お試しください");
        toast("背景画像の保存中にエラーが発生しました");
      } finally {
        delete saveCustomThemeBackgroundButton.dataset.saving;
        saveCustomThemeBackgroundButton.disabled = !(customThemeBackgroundPendingBlob || customThemeBackgroundOriginalBlob);
      }
    });
  }
  const cancelCustomThemeBackgroundButton = document.getElementById("btnCancelCustomThemeBackground");
  if (cancelCustomThemeBackgroundButton) {
    cancelCustomThemeBackgroundButton.addEventListener("click", async () => {
      customThemeBackgroundPendingBlob = null;
      customThemeBackgroundLayout = readCustomThemeBackgroundLayout();
      const savedBlob = await loadCustomThemeBackground();
      await setCustomThemeBackgroundBlob(savedBlob);
      applyTheme();
      updateCustomThemeBackgroundStatus(!!savedBlob);
    });
  }
  if (el.btnClearCustomThemeBackground) {
    el.btnClearCustomThemeBackground.addEventListener("click", async () => {
      if (!customThemeBackgroundOriginalBlob) return;
      const removed = await deleteCustomThemeBackground();
      if (!removed) { toast("背景画像を削除できませんでした"); return; }
      try { localStorage.removeItem(CUSTOM_THEME_BACKGROUND_LAYOUT_KEY); } catch {}
      customThemeBackgroundLayout = normalizeCustomThemeBackgroundLayout(null);
      customThemeBackgroundPendingBlob = null;
      await setCustomThemeBackgroundBlob(null);
      applyTheme();
      toast("カスタム背景画像を削除しました");
    });
  }
  window.addEventListener("resize", () => {
    updateCustomThemeBackgroundPreviews();
    if (state.themeMode === "custom" && customThemeBackgroundObjectUrl) applyTheme();
  }, { passive: true });
  window.addEventListener("pagehide", event => {
    if (!event.persisted) {
      [customThemeBackgroundObjectUrl, customThemeBackgroundPreviewObjectUrl].forEach(url => {
        if (url) URL.revokeObjectURL(url);
      });
      customThemeBackgroundObjectUrl = null;
      customThemeBackgroundPreviewObjectUrl = null;
    }
  });
  if (el.accentColorInput) {
    el.accentColorInput.addEventListener("input", () => {
      const nextAccent = String(el.accentColorInput.value || "").trim();
      if (!/^#[0-9a-f]{6}$/i.test(nextAccent)) return;
      state.accentColor = nextAccent;
      saveState();
      applyTheme();
    });
  }
  if (el.btnResetAccentColor) {
    el.btnResetAccentColor.addEventListener("click", () => {
      state.accentColor = "#35D977";
      saveState();
      applyTheme();
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if(state.themeMode === "system") applyTheme();
  });

  function renderColorPickers(){
    const targets = [
      { grid: el.gridColor1, key: "c1" },
      { grid: el.gridColor2, key: "c2" },
      { grid: el.gridTextColor, key: "text" }
    ];

    targets.forEach(({ grid, key }) => {
      if(!grid) return;
      grid.innerHTML = "";
      const current = state.customTheme[key];
      COLOR_PALETTE_12.forEach(color => {
        const dot = document.createElement("div");
        dot.className = "colorDot" + (current === color ? " selected" : "");
        dot.style.background = color;
        dot.addEventListener("click", () => {
          state.customTheme[key] = color;
          saveState();
          applyTheme();
          renderColorPickers();
        });
        grid.appendChild(dot);
      });
    });

    if(el.sliderL1) el.sliderL1.value = state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100;
    if(el.sliderL2) el.sliderL2.value = state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100;
    if(el.sliderLText) el.sliderLText.value = state.customTheme.lText !== undefined ? state.customTheme.lText : 100;
    if(el.txtL1) el.txtL1.textContent = `${el.sliderL1.value}%`;
    if(el.txtL2) el.txtL2.textContent = `${el.sliderL2.value}%`;
    if(el.txtLText) el.txtLText.textContent = `${el.sliderLText.value}%`;

    const previewC1 = adjustColorLightness(state.customTheme.c1 || "#1d3557", state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100);
    const previewC2 = adjustColorLightness(state.customTheme.c2 || "#121212", state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100);
    document.querySelectorAll(".gradOption").forEach(opt => {
      opt.classList.toggle("selected", opt.dataset.deg === (state.customTheme.dir || "180deg"));
      const preview = opt.querySelector(".gradPreview");
      if (preview) preview.style.background = `linear-gradient(${opt.dataset.deg}, ${previewC1} 0%, ${previewC2} 100%)`;
    });
  }

  document.querySelectorAll(".gradOption").forEach(opt => {
    opt.addEventListener("click", () => {
      state.customTheme.dir = opt.dataset.deg;
      saveState();
      applyTheme();
      renderColorPickers();
    });
  });

  [{ slider: el.sliderL1, txt: el.txtL1, key: "l1" },
   { slider: el.sliderL2, txt: el.txtL2, key: "l2" },
   { slider: el.sliderLText, txt: el.txtLText, key: "lText" }].forEach(({ slider, txt, key }) => {
    if(!slider) return;
    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      state.customTheme[key] = val;
      if (txt) txt.textContent = `${val}%`;
      saveState();
      applyTheme();
    });
  });

  function renderEqualizer(){
    if(!el.eqPresetRow || !el.eqBands) return;
    el.eqPresetRow.innerHTML = "";
    const presetNames = Object.keys(EQ_PRESETS);
    const orderedPresetNames = presetNames;

    orderedPresetNames.forEach(pName => {
      const b = document.createElement("button");
      b.className = "btn small" + (state.eqState.preset === pName ? " active" : "");
      b.textContent = pName;
      b.addEventListener("click", () => {
        state.eqState.preset = pName;
        animateEqPreset(EQ_PRESETS[pName]);
        renderEqualizer();
      });
      el.eqPresetRow.appendChild(b);
    });

    el.eqBands.innerHTML = "";
    const labels = ["60Hz", "250Hz", "1kHz", "4kHz", "12kHz"];
    labels.forEach((lbl, idx) => {
      const gainVal = Math.max(-24, Math.min(24, Number(state.eqState.gains[idx]) || 0));
      state.eqState.gains[idx] = Math.round(gainVal * 10) / 10;
      const vBand = document.createElement("div");
      vBand.className = "vBand";
      vBand.innerHTML = `
        <div class="vVal" id="eqVal_${idx}">${gainVal > 0 ? "+" + gainVal.toFixed(1) : gainVal.toFixed(1)}dB</div>
        <div class="vTrack">
          <input type="range" class="vSlider" id="eqSlider_${idx}" min="-12" max="12" step="0.5" value="${Math.max(-12, Math.min(12, gainVal))}" aria-label="${lbl} イコライザー調整">
        </div>
        <input type="number" class="eqNumberInput" id="eqNumber_${idx}" min="-24" max="24" step="0.1" value="${gainVal.toFixed(1)}" inputmode="decimal" aria-label="${lbl} の手動数値（−24〜+24 dB、0.1 dB刻み）">
        <span class="eqBandFrequency">${lbl}</span>
      `;
      const slider = vBand.querySelector(".vSlider");
      const numberInput = vBand.querySelector(".eqNumberInput");
      const commitBandValue = (value, formatNumber = true, manualInput = false) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return false;
        const limit = manualInput ? 24 : 12;
        const step = manualInput ? 10 : 2;
        const nextValue = Math.max(-limit, Math.min(limit, Math.round(parsed * step) / step));
        invalidateBufferedPcmProcessing();
        if (eqAnimId) cancelAnimationFrame(eqAnimId);
        state.eqState.preset = "Custom";
        state.eqState.gains[idx] = nextValue;
        if (slider) slider.value = String(Math.max(-12, Math.min(12, nextValue)));
        if (numberInput && formatNumber) numberInput.value = nextValue.toFixed(1);
        updatePresetButtonsUI();
        applyEqGains(0.05);
        updateEqUIValues();
        saveState();
        return true;
      };
      slider.addEventListener("input", () => commitBandValue(slider.value, true, false));
      numberInput.addEventListener("input", () => {
        if (numberInput.value.trim() === "") return;
        const parsed = Number(numberInput.value);
        if (!Number.isFinite(parsed) || parsed < -24 || parsed > 24) return;
        commitBandValue(parsed, false, true);
      });
      numberInput.addEventListener("change", () => {
        const parsed = numberInput.value.trim() === "" ? state.eqState.gains[idx] : Number(numberInput.value);
        commitBandValue(Number.isFinite(parsed) ? parsed : 0, true, true);
      });
      el.eqBands.appendChild(vBand);
    });
  }

  function updatePresetButtonsUI(){
    if (!el.eqPresetRow) return;
    const btns = el.eqPresetRow.querySelectorAll("button");
    btns.forEach(b => {
      b.classList.toggle("active", b.textContent === state.eqState.preset);
    });
  }

  function updateEqUIValues(){
    state.eqState.gains.forEach((g, idx) => {
      const slider = document.getElementById(`eqSlider_${idx}`);
      const numberInput = document.getElementById(`eqNumber_${idx}`);
      const valDisp = document.getElementById(`eqVal_${idx}`);
      if(slider) slider.value = Math.max(-12, Math.min(12, g));
      if(numberInput && document.activeElement !== numberInput) numberInput.value = Number(g).toFixed(1);
      if(valDisp) valDisp.textContent = (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1)) + "dB";
    });
  }

  function animateEqPreset(targetGains) {
    invalidateBufferedPcmProcessing();
    if(eqAnimId) cancelAnimationFrame(eqAnimId);
    
    const startGains = [...state.eqState.gains];
    const duration = 300;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      startGains.forEach((start, i) => {
        state.eqState.gains[i] = start + (targetGains[i] - start) * ease;
      });

      applyEqGains(0.05);
      updateEqUIValues();

      if (progress < 1) {
        eqAnimId = requestAnimationFrame(step);
      } else {
        state.eqState.gains = [...targetGains];
        applyEqGains(0.05);
        updateEqUIValues();
        saveState();
      }
    }

    eqAnimId = requestAnimationFrame(step);
  }

  function applyEqGains(timeConstant = 0.1){
    if(!filters.length) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    state.eqState.gains.forEach((g, i) => {
      if(filters[i]) {
        if(audioCtx) {
          filters[i].gain.setTargetAtTime(g, now, timeConstant);
        } else {
          filters[i].gain.value = g;
        }
      }
    });
    if (bufferedPlaybackMode && bufferedPlaybackEngine &&
        typeof bufferedPlaybackEngine.scheduleProcessingSettingsUpdate === "function") {
      bufferedPlaybackEngine.scheduleProcessingSettingsUpdate();
    }
  }

  if (el.btnEqReset) {
    el.btnEqReset.addEventListener("click", () => {
      state.eqState.preset = "Normal";
      animateEqPreset([0,0,0,0,0]);
      updatePresetButtonsUI();
    });
  }

  let artworkRenderGeneration = 0;

  function updateArtwork(song) {
    const renderGeneration = ++artworkRenderGeneration;
    const showVideo = song?.mediaType === "video" &&
      el.nowCoverBox && mediaElement instanceof HTMLVideoElement;
    if (showVideo) {
      mediaElement.classList.add("coverVideo");
      mediaElement.controls = false;
      mediaElement.playsInline = true;
      mediaElement.setAttribute("playsinline", "");
      mediaElement.setAttribute("webkit-playsinline", "");
      if (song.coverUrl) mediaElement.poster = song.coverUrl;
      else mediaElement.removeAttribute("poster");
      if (mediaElement.parentElement !== el.nowCoverBox) el.nowCoverBox.insertBefore(mediaElement, el.btnVideoFullscreen || null);
      if (el.nowCoverCanvas) el.nowCoverCanvas.hidden = mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      if (el.btnVideoFullscreen) el.btnVideoFullscreen.hidden = false;
    } else {
      if (mediaElement.parentElement === el.nowCoverBox) mediaElement.remove();
      mediaElement.classList.remove("coverVideo");
      mediaElement.removeAttribute("poster");
      if (el.nowCoverCanvas) el.nowCoverCanvas.hidden = false;
      if (el.btnVideoFullscreen) el.btnVideoFullscreen.hidden = true;
    }
    const drawCanvas = (canvas, size) => {
      if (!canvas) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      if (song?.coverUrl) {
        const coverUrl = song.coverUrl;
        const img = new Image();
        img.onload = () => {
          if (renderGeneration !== artworkRenderGeneration || song.coverUrl !== coverUrl) return;
          ctx.clearRect(0, 0, size, size);
          const scale = Math.max(size / img.width, size / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const dx = (size - drawW) / 2;
          const dy = (size - drawH) / 2;
          ctx.drawImage(img, dx, dy, drawW, drawH);
        };
        img.src = coverUrl;
        return;
      }
      const isLightTheme = document.body.classList.contains("theme-light");
      ctx.fillStyle = isLightTheme ? "#e9edf2" : "rgba(35, 35, 40, 0.9)";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = isLightTheme ? "rgba(72, 82, 94, 0.48)" : "rgba(200, 200, 200, 0.3)";
      ctx.font = `bold ${Math.round(size / 6.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`NO IMAGE #${BUILD_REVISION}`, size / 2, size / 2);
    };
    drawCanvas(el.nowCoverCanvas, 160);
    drawCanvas(el.miniCoverCanvas, 32);
  }
  // 同じ再生要素の映像データが準備できたら、静止サムネイルから動画表示へ切り替える。
  mediaElement.addEventListener("loadeddata", () => {
    if (state.currentSong?.mediaType !== "video" ||
        mediaElement.currentSrc !== state.currentSong.url ||
        mediaElement.parentElement !== el.nowCoverBox) return;
    if (el.nowCoverCanvas) el.nowCoverCanvas.hidden = true;
    if (el.btnVideoFullscreen) el.btnVideoFullscreen.hidden = false;
  });

  // 動画をデコードできない場合は静止ジャケットへ戻し、黒い映像枠を残さない。
  mediaElement.addEventListener("error", () => {
    if (state.currentSong?.mediaType !== "video" ||
        mediaElement.currentSrc !== state.currentSong.url) return;
    if (mediaElement.parentElement === el.nowCoverBox) mediaElement.remove();
    mediaElement.classList.remove("coverVideo");
    if (el.nowCoverCanvas) el.nowCoverCanvas.hidden = false;
    if (el.btnVideoFullscreen) el.btnVideoFullscreen.hidden = true;
  });

  if (el.btnVideoFullscreen) {
    el.btnVideoFullscreen.addEventListener("click", async e => {
      e.stopPropagation();
      if (!(mediaElement instanceof HTMLVideoElement) ||
          state.currentSong?.mediaType !== "video" ||
          mediaElement.parentElement !== el.nowCoverBox) return;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen?.();
        } else if (mediaElement.requestFullscreen) {
          await mediaElement.requestFullscreen();
        } else if (mediaElement.webkitEnterFullscreen) {
          mediaElement.webkitEnterFullscreen();
        }
      } catch (err) {
        toast("映像を全画面表示できませんでした");
      }
    });
  }

  async function clearAllTracksFromDB() {
    if (!db) return false;
    return await new Promise(resolve => {
      try {
        const tx = db.transaction("tracks", "readwrite");
        tx.objectStore("tracks").clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function resetAllFiles() {
    const cleared = await clearAllTracksFromDB();
    if (!cleared) {
      toast("保存データを消去できなかったため、リセットを中止しました。");
      return;
    }
    revokeAllObjectURLs();
    setPlaybackIntent(false);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.playlist = [];
    state.playlistOrder = [];
    state.currentSong = null;
    resetTrackLoudnessNormalization();
    state.queue = [];
    state.favorites = [];
    state.playCounts = {};
    state.playHistory = {};
    state.playStats = {};
    state.playbackMonthly = {};
    state.playlists = {};
    state.playlistSettings = {};
    clearPlaylistContext();
    resetHomeCycle();
    try {
      localStorage.removeItem(STORAGE.lastSong);
      localStorage.removeItem(STORAGE.lastPosition);
      localStorage.removeItem(STORAGE.lastPlayback);
    } catch (e) {}
    if (el.folder) el.folder.value = "";
    const directoryInput = document.getElementById("folderDirectory");
    if (directoryInput) directoryInput.value = "";
    updateArtwork(null);
    updateTitleTextAndScroll(el.nowTitle, "未再生");
    updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
    updateTitleTextAndScroll(el.miniTitle, "停止中");
    if (el.timeNow) el.timeNow.textContent = "0:00";
    if (el.timeAll) el.timeAll.textContent = "0:00";
    if (el.miniTimeNow) el.miniTimeNow.textContent = "0:00";
    if (el.miniTimeAll) el.miniTimeAll.textContent = "0:00";
    if (el.progress) el.progress.value = "0";
    if (el.miniProgress) el.miniProgress.value = "0";
    if (el.btnFav) { el.btnFav.textContent = "☆"; el.btnFav.classList.remove("active"); }
    try { if ("mediaSession" in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "paused"; } } catch (e) {}
    lastStatsTime = 0;
    updatePlayPauseUI();
    saveState();
    renderAll();
    toast("全ファイルをリセットしました");
  }

  if (el.btnResetFiles) {
    el.btnResetFiles.addEventListener("click", () => {
      showInSiteConfirm(
        "保存された全ファイルを削除しますか？",
        "曲ファイル、プレイリスト、キュー、お気に入りなどの音楽データをすべて削除します。設定はそのままです。",
        () => { resetAllFiles(); },
        "すべて削除"
      );
    });
  }

  if (el.btnResetSettings) {
    el.btnResetSettings.addEventListener("click", () => {
      showInSiteConfirm(
        "すべての設定を初期化しますか？",
        "音楽ファイルやプレイリストなどのデータは残したまま、設定だけを初回アクセス時の状態に戻します。",
        async () => {
          // IndexedDBの削除が成功するまでは、他の設定や保存データに触れない。
          const backgroundDeleted = await deleteCustomThemeBackground();
          if (!backgroundDeleted) {
            toast("背景画像の削除に失敗したため、設定の初期化を中止しました。時間をおいて再試行してください。");
            return;
          }

          [
            STORAGE.eqState,
            STORAGE.volume,
            STORAGE.pitch,
            STORAGE.shuffle,
            STORAGE.repeat,
            STORAGE.favOnly,
            STORAGE.themeMode,
            STORAGE.customTheme,
            STORAGE.accentColor,
            STORAGE.crossfade,
            STORAGE.silenceSkip,
            STORAGE.dMode,
            STORAGE.waveMode,
            STORAGE.clippingProtection,
            STORAGE.channelLeft,
            STORAGE.channelRight,
            STORAGE.micMonitorVolume,
            STORAGE.micFeedbackProtection,
            STORAGE.mainOutputDevice,
            STORAGE.speakerSettings,
            STORAGE.outputRoutes,
            STORAGE.micFeedbackStrength,
            STORAGE.normalizeTrackVolume,
            STORAGE.outputLevelDb,
            STORAGE.loudnessCompression,
            STORAGE.speakerPairSwap,
            STORAGE.visualizerSettings,
            STORAGE.visualizerModeSettings,
            STORAGE.playlistSettings,
            STORAGE.homeLayout,
            STORAGE.lastSong,
            STORAGE.lastPosition
          ].forEach(key => localStorage.removeItem(key));

          if (sleepTimerId) clearTimeout(sleepTimerId);
          if (sleepIntervalId) clearInterval(sleepIntervalId);

          try { localStorage.removeItem(CUSTOM_THEME_BACKGROUND_LAYOUT_KEY); } catch {}
          location.reload();
        },
        "初期化"
      );
    });
  }