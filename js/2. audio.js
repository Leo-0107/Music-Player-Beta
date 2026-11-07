  const BUILD_REVISION = 16;

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
  let lastSystemDefaultOutputDeviceId = "";
  let knownPhysicalOutputDeviceIds = new Set();
  let pendingOutputDeviceRefresh = false;
  let playbackIntent = loadStr(STORAGE.lastPlayback, "") === "playing";
  let backgroundPlaybackRecovery = false;

  function setPlaybackIntent(playing) {
    playbackIntent = !!playing;
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
    setPlaybackIntent(true);
  });

  audio.addEventListener("pause", () => {
    // ユーザー操作ではなくバックグラウンド移行で一時停止された場合は、
    // タイマーを挟まず直ちに復帰を試みる。
    if (playbackIntent && document.visibilityState === "hidden" && !backgroundPlaybackRecovery) {
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
      if (playbackIntent) {
        recoverBackgroundPlayback().catch(() => {});
      }
    } else if (document.visibilityState === "visible" && pendingOutputDeviceRefresh) {
      pendingOutputDeviceRefresh = false;
      setTimeout(() => {
        navigator.mediaDevices?.dispatchEvent?.(new Event("devicechange"));
      }, 0);
    } else if (playbackIntent) {
      recoverBackgroundPlayback().catch(() => {});
    }

    if (document.visibilityState === "visible" && playbackIntent) {
      recoverBackgroundPlayback().catch(() => {});
    }

    if (document.visibilityState === "visible" && !audio.paused) {
      lastFrameTime = performance.now();
      startWaveAnimation();
    }
  });

  window.addEventListener("pageshow", () => {
    if (playbackIntent) {
      recoverBackgroundPlayback().catch(() => {});
    }
  });

  function updateTitleTextAndScroll(element, text) {
    if (!element) return;
    const container = element.closest(".scroll-container");
    element.classList.remove("scrolling");
    element.style.animationPlayState = "paused";
    element.textContent = text;

    requestAnimationFrame(() => {
      if (!container) return;
      const overflow = element.scrollWidth - container.clientWidth;
      if (overflow > 6) {
        element.style.setProperty("--scroll-dist", `-${overflow + 12}px`);
        element.classList.add("scrolling");
        if (container._isIntersecting && document.visibilityState === "visible") {
          element.style.animationPlayState = "running";
        }
      }
    });
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
    localStorage.setItem(STORAGE.speakerPairSwap, "false");
    localStorage.setItem(STORAGE.visualizerSettings, JSON.stringify(state.visualizerSettings || {}));
    localStorage.setItem(STORAGE.visualizerModeSettings, JSON.stringify(state.visualizerModeSettings || {}));
    localStorage.setItem(STORAGE.outputRoutes, JSON.stringify(state.outputRoutes || []));
    localStorage.setItem(STORAGE.mainOutputDevice, state.mainOutputDeviceId || "");
    localStorage.setItem(STORAGE.speakerSettings, JSON.stringify(state.speakerSettings || {}));
    localStorage.setItem(STORAGE.playlistSettings, JSON.stringify(state.playlistSettings || {}));
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


let outputTransitionPromise = Promise.resolve();
let mainOutputDirectGainNode = null;
let mainOutputUsesDirectSink = false;
let mainOutputUsesNativeDestination = false;

  function ensureGraph(){
    if(audioGraphReady) return;
    try {
      // 初期化失敗後も同じ AudioContext / MediaElementAudioSourceNode を再利用する。
      // createMediaElementSource() は同じ audio 要素に対して複数回実行できないため。
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
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
        sourceNode = audioCtx.createMediaElementSource(audio);
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
        panner3DNode.refDistance = 1;
        panner3DNode.rolloffFactor = 0.35;
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
      waveLeftOutputAnalyser.fftSize = 128;
      waveRightOutputAnalyser.fftSize = 128;
      leftLevelData = new Uint8Array(leftLevelAnalyser.fftSize);
      rightLevelData = new Uint8Array(rightLevelAnalyser.fftSize);
      waveLeftOutputData = new Uint8Array(waveLeftOutputAnalyser.frequencyBinCount);
      waveRightOutputData = new Uint8Array(waveRightOutputAnalyser.frequencyBinCount);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = currentVolumeTarget;
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

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      waveTimeData = new Uint8Array(analyser.fftSize);

      sourceNode.connect(filters[0]);
      for(let i=0; i<filters.length-1; i++) filters[i].connect(filters[i+1]);
      
      const pitchShiftNode = createPitchShifter(audioCtx);
      audioCtx._musicPlayerPitchShifter = pitchShiftNode;

      // 通常再生（ピッチ0）はピッチシフターを経由させず、元信号をそのまま使う。
      // ピッチ変更時だけ処理済み経路へ切り替える。
      const pitchBypassGainNode = audioCtx.createGain();
      const pitchProcessedGainNode = audioCtx.createGain();
      const pitchRouteNode = audioCtx.createGain();
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
      channelNormalizeNode.connect(masterGain);
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
      finalMixGainNode.connect(speakerBusNode);

      speakerBusNode.connect(channelSplitter);
      channelSplitter.connect(leftGainNode, 0, 0);
      channelSplitter.connect(rightGainNode, 1, 0);
      applyPairedSpeakerRouting();
      leftGainNode.connect(channelMerger, 0, 0);
      rightGainNode.connect(channelMerger, 0, 1);

      // 最終クリッピング保護はL/R個別ゲインの「後」に置く。
      // ここより前で抑えても、その後に最大2倍のチャンネルゲインを
      // 掛けられると再びピーク超過するため、最終出力直前で保護する。
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
      analyser.connect(waveOutputSplitter);

      waveOutputSplitter.connect(waveLeftOutputAnalyser, 0);
      waveOutputSplitter.connect(waveRightOutputAnalyser, 1);

      // メイン出力は対応ブラウザではAudioContext.setSinkId()を優先する。
      // MediaStreamDestination + HTMLMediaElement はフォールバックとして残す。
      mainOutputDirectGainNode = audioCtx.createGain();
      mainOutputDirectGainNode.gain.value = state.speakerSettings?.mainEnabled === false ? 0 : 1;

      // Androidのホーム画面追加PWAでは、AudioContext.setSinkId()を使うと
      // Chromeのスタンドアロン音声経路で出力が途切れたり音が不安定になる場合がある。
      // 明示的な出力機器を指定していない場合は、OS標準のdestinationへ直接出力する。
      if (isAndroidStandalonePwa() && !state.mainOutputDeviceId) {
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
        audioCtx.setSinkId(state.mainOutputDeviceId || "").catch(error => {
          mainOutputUsesDirectSink = false;
          mainOutputUsesNativeDestination = false;
          try { mainOutputDirectGainNode.disconnect(); } catch (e) {}
          ensureOutputBridge();
          if (outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
            outputBridgeAudio.setSinkId(state.mainOutputDeviceId || "").catch(() => {});
          }
          applyAllSpeakerDelayNodes();
          console.warn("Music Player direct AudioContext output unavailable:", error);
        });
      } else {
        ensureOutputBridge();
        if (state.mainOutputDeviceId && outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
          outputBridgeAudio.setSinkId(state.mainOutputDeviceId).catch(error => {
            console.warn("Music Player output device restore failed:", error);
          });
        }
      }

      mainDelayNode = audioCtx.createDelay(1.5);
      applyMainOutputDelayNode();

      audioGraphReady = true;
      syncAdditionalOutputRuntimes().catch(() => {});
    } catch(e) {
      audioGraphReady = false;
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

  function updatePitchShiftNode(){
    const shifter = audioCtx?._musicPlayerPitchShifter;
    const pitchSource = audioCtx?._musicPlayerPitchSource;
    const pitchRatio = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
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

  function applyPitchAndRate(){
    ensureGraph();
    audio.playbackRate = currentRate;
    audio.preservesPitch = true;
    updatePitchShiftNode();
    if (el.rateText) el.rateText.textContent = `${currentRate.toFixed(2)}x`;
    if (el.pitchText) el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
    updateMediaSessionPosition();
  }
  // --- 経過時間（dt）ベースの回転更新 ---
  function updateSpatialAudio(dt) {
    if (!audioCtx || !panner3DNode || audio.paused || state.dMode === "2D") return;
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
        // YouTubeの動画で聞くような自然な前方定位：HRTFで左右の位置だけを連続的に変える。
        x = state.panValue * 1.8; y = 0; z = -1.5; setPos(x, y, z); break;
      case "BINAURAL":
        // 固定バイノーラル：HRTFで音源を正面の一定位置へ固定する。
        x = 0; y = 0; z = -1.5; setPos(x, y, z); break;
      case "4D":
        x = Math.sin(t * 0.4) * 2.5; y = Math.sin(t * 0.8) * 1.2; z = Math.cos(t * 0.4) * 2.5; setPos(x, y, z); break;
      case "8D":
        x = Math.sin(t) * 3.2; y = 0; z = Math.cos(t) * 3.2; setPos(x, y, z); break;
      case "16D":
        x = Math.sin(t * 1.2) * 3.5; y = Math.sin(t * 2.4) * 1.8; z = Math.cos(t * 0.7) * 3.5; setPos(x, y, z); break;
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
    state.dMode = mode;
    saveState();
    const descriptions = {
      "2D": "2D：通常の左右ステレオで再生します。",
      "3D": "3D：音が前方にあるような立体感を加えます。",
      "BINAURAL": "バイノーラル：音を正面に定位させ、ヘッドホン向けの立体感を加えます。",
      "4D": "4D：音が前後左右や上下にゆっくり移動します。",
      "8D": "8D：音が周囲を回るように移動します。",
      "16D": "16D：音が上下も交えて複雑に周回します。"
    };
    if (el.dModeDesc) el.dModeDesc.textContent = descriptions[mode] || descriptions["2D"];
    if (el.dModeBtns) {
      el.dModeBtns.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.d === mode);
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

  function applyTheme(){
    document.body.classList.remove("theme-light");
    [el.btnThemeSystem, el.btnThemeDark, el.btnThemeLight, el.btnThemeCustom].forEach(b => b?.classList.remove("active"));
    if (el.customThemeArea) el.customThemeArea.style.display = "none";

    document.body.style.removeProperty("--text");
    document.body.style.removeProperty("--muted");

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

      document.body.style.background = `linear-gradient(${dir || "180deg"}, ${computedC1} 0%, ${computedC2} 100%)`;
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.color = computedText;
      
      document.body.style.setProperty("--text", computedText);
      document.body.style.setProperty("--muted", computedMuted);
    } else {
      document.body.style.background = "";
      document.body.style.color = "";
      if(state.themeMode === "dark" && el.btnThemeDark) el.btnThemeDark.classList.add("active");
    }
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
      const gainVal = Number(state.eqState.gains[idx] || 0);
      const vBand = document.createElement("div");
      vBand.className = "vBand";
      vBand.innerHTML = `
        <div class="vVal" id="eqVal_${idx}">${gainVal > 0 ? "+" + gainVal.toFixed(1) : gainVal.toFixed(1)}dB</div>
        <div class="vTrack">
          <input type="range" class="vSlider" id="eqSlider_${idx}" min="-12" max="12" step="0.5" value="${gainVal}">
        </div>
        <span style="font-size:.75rem; color:var(--muted); margin-top:4px">${lbl}</span>
      `;
      const slider = vBand.querySelector(".vSlider");

      slider.addEventListener("input", () => {
        if(eqAnimId) cancelAnimationFrame(eqAnimId);
        const v = Number(slider.value);
        state.eqState.preset = "Custom";
        state.eqState.gains[idx] = v;
        updatePresetButtonsUI();
        applyEqGains(0.05);
        updateEqUIValues();
        saveState();
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
      const valDisp = document.getElementById(`eqVal_${idx}`);
      if(slider) slider.value = g;
      if(valDisp) valDisp.textContent = (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1)) + "dB";
    });
  }

  function animateEqPreset(targetGains) {
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
  }

  if (el.btnEqReset) {
    el.btnEqReset.addEventListener("click", () => {
      state.eqState.preset = "Normal";
      animateEqPreset([0,0,0,0,0]);
      updatePresetButtonsUI();
    });
  }

  function updateArtwork(song) {
    const drawCanvas = (canvas, size) => {
      if(!canvas) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;

      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      if (song?.coverUrl) {
        const img = new Image();
        img.onload = () => {
          ctx.clearRect(0, 0, size, size);
          const scale = Math.max(size / img.width, size / img.height);
          const drawW = img.width * scale;
          const drawH = img.height * scale;
          const dx = (size - drawW) / 2;
          const dy = (size - drawH) / 2;
          ctx.drawImage(img, dx, dy, drawW, drawH);
        };
        img.src = song.coverUrl;
        return;
      }

      ctx.fillStyle = "rgba(35, 35, 40, 0.9)";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
      ctx.font = `bold ${Math.round(size / 6.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`NO IMAGE #${BUILD_REVISION}`, size / 2, size / 2);
    };

    drawCanvas(el.nowCoverCanvas, 160);
    drawCanvas(el.miniCoverCanvas, 32);
  }

  if (el.btnVideoFullscreen) {
    el.btnVideoFullscreen.addEventListener("click", async e => {
      e.stopPropagation();
      if (!(audio instanceof HTMLVideoElement) || state.currentSong?.mediaType !== "video") return;
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen?.();
        } else if (audio.requestFullscreen) {
          await audio.requestFullscreen();
        } else if (audio.webkitEnterFullscreen) {
          audio.webkitEnterFullscreen();
        }
      } catch (err) {
        toast("映像を全画面表示できませんでした");
      }
    });
  }

  async function clearAllTracksFromDB() {
    if (!db) return;
    await new Promise(resolve => {
      try {
        const tx = db.transaction("tracks", "readwrite");
        tx.objectStore("tracks").clear();
        tx.oncomplete = resolve;
        tx.onerror = resolve;
        tx.onabort = resolve;
      } catch (e) {
        resolve();
      }
    });
  }

  async function resetAllFiles() {
    await clearAllTracksFromDB();
    revokeAllObjectURLs();
    setPlaybackIntent(false);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.playlist = [];
    state.playlistOrder = [];
    state.currentSong = null;
    state.queue = [];
    state.favorites = [];
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
        () => {
          [
            STORAGE.eqState,
            STORAGE.volume,
            STORAGE.pitch,
            STORAGE.shuffle,
            STORAGE.repeat,
            STORAGE.favOnly,
            STORAGE.themeMode,
            STORAGE.customTheme,
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

          location.reload();
        },
        "初期化"
      );
    });
  }