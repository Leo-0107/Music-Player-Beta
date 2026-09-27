  const BUILD_REVISION = 62;

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
    if (document.visibilityState === "visible" && !audio.paused) {
      lastFrameTime = performance.now();
      startWaveAnimation();
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
    localStorage.setItem(STORAGE.clippingProtection, String(state.clippingProtection));
    localStorage.setItem(STORAGE.channelLeft, String(currentLeftVolumeTarget));
    localStorage.setItem(STORAGE.channelRight, String(currentRightVolumeTarget));
    localStorage.setItem(STORAGE.micMonitorVolume, String(currentMicMonitorVolumeTarget));
    localStorage.setItem(STORAGE.outputRoutes, JSON.stringify(state.outputRoutes || []));
    localStorage.setItem(STORAGE.mainOutputDevice, state.mainOutputDeviceId || "");
    localStorage.setItem(STORAGE.speakerSettings, JSON.stringify(state.speakerSettings || {}));
    localStorage.setItem(STORAGE.playlistSettings, JSON.stringify(state.playlistSettings || {}));
  }

  function setWaveMode(mode) {
    const validModes = ["3d", "2d", "a1", "a2", "a3", "a4"];
    state.waveMode = validModes.includes(mode) ? mode : "2d";
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

    bindAction('play', () => {
      if (audio.paused) {
        ensureGraph();
        audio.play().catch(() => {});
      }
    });
    bindAction('pause', () => {
      if (!audio.paused) {
        audio.pause();
        updatePlayPauseUI();
      }
    });
    bindAction('previoustrack', () => { prevTrack(); });
    bindAction('nexttrack', () => { nextTrack(); });
    bindAction('stop', () => {
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

  function ensureOutputBridge() {
    if (!audioCtx || outputBridgeAudio || !audioCtx.createMediaStreamDestination) return;

    outputStreamDestination = audioCtx.createMediaStreamDestination();
    outputBridgeAudio = document.createElement("audio");
    outputBridgeAudio.autoplay = true;
    outputBridgeAudio.controls = false;
    outputBridgeAudio.playsInline = true;
    outputBridgeAudio.setAttribute("aria-hidden", "true");
    outputBridgeAudio.style.display = "none";
    outputBridgeAudio.srcObject = outputStreamDestination.stream;
    document.body.appendChild(outputBridgeAudio);
  }

  function ensureGraph(){
    if(audioGraphReady) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audio);
      
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
        if (panner3DNode.positionX) {
          panner3DNode.positionX.value = 0;
          panner3DNode.positionY.value = 0;
          panner3DNode.positionZ.value = 0;
        } else {
          panner3DNode.setPosition(0, 0, 0);
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

      // --- DynamicsCompressorNode (リミッター) 挿入 ---
      limiterNode = audioCtx.createDynamicsCompressor();
      limiterNode.threshold.setValueAtTime(-0.5, audioCtx.currentTime);
      limiterNode.knee.setValueAtTime(0, audioCtx.currentTime);
      limiterNode.ratio.setValueAtTime(20, audioCtx.currentTime);
      limiterNode.attack.setValueAtTime(0.003, audioCtx.currentTime);
      limiterNode.release.setValueAtTime(0.1, audioCtx.currentTime);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      waveTimeData = new Uint8Array(analyser.fftSize);

      sourceNode.connect(filters[0]);
      for(let i=0; i<filters.length-1; i++) filters[i].connect(filters[i+1]);
      
      let spatialSourceNode = filters[filters.length - 1];
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
      if (state.clippingProtection) {
        finalMixGainNode.connect(limiterNode);
        limiterNode.connect(speakerBusNode);
      } else {
        finalMixGainNode.connect(speakerBusNode);
      }

      speakerBusNode.connect(channelSplitter);
      channelSplitter.connect(leftGainNode, 0, 0);
      channelSplitter.connect(rightGainNode, 1, 0);
      leftGainNode.connect(channelMerger, 0, 0);
      rightGainNode.connect(channelMerger, 0, 1);

      // スピーカーのL/Rを反映した信号だけをメーター・波形に使用する。
      channelMerger.connect(outputSplitter);
      outputSplitter.connect(leftLevelAnalyser, 0);
      outputSplitter.connect(rightLevelAnalyser, 1);
      channelMerger.connect(analyser);
      analyser.connect(waveOutputSplitter);

      waveOutputSplitter.connect(waveLeftOutputAnalyser, 0);
      waveOutputSplitter.connect(waveRightOutputAnalyser, 1);

      // メイン出力は常に MediaStreamDestination + HTMLMediaElement.setSinkId()
      // を使う。AudioContext.setSinkId() の対応差による切替失敗を避ける。
      ensureOutputBridge();

      if (state.mainOutputDeviceId && outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
        outputBridgeAudio.setSinkId(state.mainOutputDeviceId).catch(() => {});
      }

      mainDelayNode = audioCtx.createDelay(1.5);
      applyMainOutputDelayNode();
      analyser.connect(mainDelayNode);

      ensureOutputBridge();
      if (outputBridgeAudio && outputStreamDestination) {
        mainDelayNode.connect(outputStreamDestination);
      }

      audioGraphReady = true;
      syncAdditionalOutputRuntimes().catch(() => {});
    } catch(e) {}
  }

  function clampSpeakerDelay(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n * 10) / 10)) : 0;
  }

  function getMainOutputDelay() {
    return clampSpeakerDelay(state.speakerSettings?.mainDelayMs);
  }

  function getSpeakerDelayOffsets() {
    const delays = [getMainOutputDelay()];
    state.outputRoutes.forEach(route => {
      delays.push(clampSpeakerDelay(route.delayMs));
    });
    return delays;
  }

  function getEffectiveSpeakerDelay(delayMs) {
    return clampSpeakerDelay(delayMs);
  }

  function applyAllSpeakerDelayNodes() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (mainDelayNode) {
      mainDelayNode.delayTime.setValueAtTime(
        Math.min(1.5, getEffectiveSpeakerDelay(getMainOutputDelay()) / 1000),
        now
      );
    }
    for (const route of state.outputRoutes) {
      const runtime = additionalOutputRuntimes.get(route.deviceId);
      if (runtime?.delayNode) {
        runtime.delayNode.delayTime.setValueAtTime(
          Math.min(1.5, getEffectiveSpeakerDelay(route.delayMs) / 1000),
          now
        );
      }
    }
  }

  function applyMainOutputDelayNode() {
    const delayMs = getMainOutputDelay();
    applyAllSpeakerDelayNodes();
    if (el.mainOutputDelay) el.mainOutputDelay.value = String(delayMs);
    if (el.mainOutputDelayText) el.mainOutputDelayText.textContent = String(delayMs) + " ms";
  }

  function setMainOutputDelay(value) {
    const delayMs = clampSpeakerDelay(value);
    state.speakerSettings.mainDelayMs = delayMs;
    saveState();
    applyMainOutputDelayNode();
  }

  function adjustMainOutputDelay(step) {
    setMainOutputDelay(getMainOutputDelay() + step);
  }

  function autoEstimateSpeakerDelay() {
    ensureGraph();
    const base = Number(audioCtx?.baseLatency) || 0;
    const output = Number(audioCtx?.outputLatency) || 0;
    const estimated = clampSpeakerDelay((base + output) * 1000);
    state.speakerSettings.autoEstimateMs = estimated;
    state.speakerSettings.mainDelayMs = estimated;
    state.outputRoutes.forEach(route => { route.delayMs = estimated; });
    saveState();
    applyMainOutputDelayNode();
    renderAdditionalOutputSpeakers();
    toast("ブラウザ推定の遅延 " + estimated + " ms を適用しました");
  }

  if (el.mainOutputDelay) {
    el.mainOutputDelay.value = String(getMainOutputDelay());
    el.mainOutputDelay.addEventListener("change", e => setMainOutputDelay(e.target.value));
  }
  if (el.btnMainOutputDelayDown) {
    el.btnMainOutputDelayDown.addEventListener("click", () => adjustMainOutputDelay(-0.1));
  }
  if (el.btnMainOutputDelayUp) {
    el.btnMainOutputDelayUp.addEventListener("click", () => adjustMainOutputDelay(0.1));
  }
  if (el.btnAutoCalibrateSpeakers) {
    el.btnAutoCalibrateSpeakers.addEventListener("click", autoEstimateSpeakerDelay);
  }

  function snapToDefault(value, defaultValue, threshold) {
    const n = Number(value);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.abs(n - defaultValue) <= threshold ? defaultValue : n;
  }

  function updateChannelVolumeUI(side, value) {
    const clamped = Math.max(0, Math.min(2, snapToDefault(value, 1, 0.07)));
    const isLeft = side === "left";
    if (isLeft) {
      currentLeftVolumeTarget = clamped;
      state.channelLeft = clamped;
      if (leftGainNode) leftGainNode.gain.setTargetAtTime(clamped, audioCtx ? audioCtx.currentTime : 0, 0.045);
      if (el.channelLeft) el.channelLeft.value = clamped;
      if (el.channelLeftText) el.channelLeftText.textContent = `${Math.round(clamped * 100)}%`;
    } else {
      currentRightVolumeTarget = clamped;
      state.channelRight = clamped;
      if (rightGainNode) rightGainNode.gain.setTargetAtTime(clamped, audioCtx ? audioCtx.currentTime : 0, 0.045);
      if (el.channelRight) el.channelRight.value = clamped;
      if (el.channelRightText) el.channelRightText.textContent = `${Math.round(clamped * 100)}%`;
    }
    saveState();
  }

  if (el.channelLeft) {
    el.channelLeft.value = currentLeftVolumeTarget;
    el.channelLeftText && (el.channelLeftText.textContent = `${Math.round(currentLeftVolumeTarget * 100)}%`);
    el.channelLeft.addEventListener("input", e => {
      ensureGraph();
      updateChannelVolumeUI("left", e.target.value);
    });
  }
  if (el.channelRight) {
    el.channelRight.value = currentRightVolumeTarget;
    el.channelRightText && (el.channelRightText.textContent = `${Math.round(currentRightVolumeTarget * 100)}%`);
    el.channelRight.addEventListener("input", e => {
      ensureGraph();
      updateChannelVolumeUI("right", e.target.value);
    });
  }

  function getCurrentMainOutputSinkId() {
    return state.mainOutputDeviceId || "";
  }

  function getOutputDeviceLabel(device, fallback = "音声出力デバイス") {
    return device?.label || fallback;
  }

  async function enumerateAudioOutputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === "audiooutput");
    } catch (e) {
      return [];
    }
  }

  async function ensureOutputDeviceAccess() {
    const outputs = await enumerateAudioOutputs();
    const hasUsableOutput = outputs.some(d => d.deviceId && d.deviceId !== "default");
    if (hasUsableOutput) return outputs;

    // Chrome系では selectAudioOutput() が使えない場合があるため、
    // ユーザー操作の直後だけ getUserMedia() でデバイス権限を取得して再列挙する。
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (e) {
        return outputs;
      }
    }
    return await enumerateAudioOutputs();
  }

  async function restoreStoredMainOutputIfAvailable() {
    const deviceId = state.mainOutputDeviceId || "";
    if (!deviceId) return;
    const outputs = await enumerateAudioOutputs();
    if (!outputs.some(device => device.deviceId === deviceId)) return;

    try {
      ensureGraph();
      ensureOutputBridge();
      if (outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
        await outputBridgeAudio.setSinkId(deviceId);
        await startOutputBridge();
      }
      await updateOutputDeviceName();
    } catch (e) {}
  }

  async function updateOutputDeviceName() {
    if (!el.outputDeviceName) return;
    try {
      const outputs = await enumerateAudioOutputs();
      const sinkId = state.mainOutputDeviceId || "";
      const current = outputs.find(d => d.deviceId === sinkId);
      if (current?.label) {
        state.speakerSettings.mainOutputLabel = current.label;
        el.outputDeviceName.textContent = current.label;
        saveState();
      } else if (sinkId && state.speakerSettings.mainOutputLabel) {
        el.outputDeviceName.textContent = state.speakerSettings.mainOutputLabel + "（未接続）";
      } else {
        el.outputDeviceName.textContent = "既定のスピーカー";
      }
    } catch (e) {
      el.outputDeviceName.textContent = state.speakerSettings.mainOutputLabel || "既定のスピーカー";
    }
  }

  function moveOutputDeviceModalsToBody() {
    [el.outputDeviceModal, el.outputDeviceAddModal].forEach(modal => {
      if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
    });
  }

  function closeOutputDeviceModal() {
    if (el.outputDeviceModal) el.outputDeviceModal.hidden = true;
    document.body.classList.remove("output-device-modal-open");
  }

  function closeOutputDeviceAddModal() {
    if (el.outputDeviceAddModal) el.outputDeviceAddModal.hidden = true;
    document.body.classList.remove("output-device-modal-open");
  }

  async function setMainOutputDevice(deviceId) {
    ensureGraph();
    const normalized = deviceId || "";

    if (normalized && hasAdditionalOutput(normalized)) {
      toast("そのスピーカーは登録済みです");
      return false;
    }

    const previousId = outputBridgeAudio?.sinkId || state.mainOutputDeviceId || "";
    const wasPlaying = !audio.paused;
    try {
      ensureOutputBridge();
      if (!outputBridgeAudio || typeof outputBridgeAudio.setSinkId !== "function") {
        throw new Error("HTMLMediaElement.setSinkId is unavailable");
      }

      await outputBridgeAudio.setSinkId(normalized);

      if (mainDelayNode && outputStreamDestination) {
        try { mainDelayNode.disconnect(audioCtx.destination); } catch (e) {}
        try { mainDelayNode.disconnect(outputStreamDestination); } catch (e) {}
        mainDelayNode.connect(outputStreamDestination);
      }

      if (wasPlaying) {
        await outputBridgeAudio.play();
        if (outputBridgeAudio.paused) {
          throw new Error("Output bridge did not resume");
        }
      }

      state.mainOutputDeviceId = normalized;
      const outputs = await enumerateAudioOutputs();
      const current = outputs.find(device => device.deviceId === normalized);
      state.speakerSettings.mainOutputLabel =
        current?.label || (normalized ? state.speakerSettings.mainOutputLabel || "選択したスピーカー" : "");
      saveState();
      await updateOutputDeviceName();
      renderAdditionalOutputSpeakers();
      renderOutputDevicePicker();
      toast("スピーカーを変更しました");
      return true;
    } catch (e) {
      try {
        if (outputBridgeAudio && outputBridgeAudio.sinkId !== previousId) {
          await outputBridgeAudio.setSinkId(previousId);
          if (wasPlaying) await outputBridgeAudio.play();
        }
      } catch (restoreError) {
        try {
          if (outputBridgeAudio) {
            await outputBridgeAudio.setSinkId("");
            if (wasPlaying) await outputBridgeAudio.play();
          }
        } catch (ignore) {}
        state.mainOutputDeviceId = "";
      }
      state.mainOutputDeviceId = previousId;
      if (e?.name === "NotAllowedError") {
        toast("この出力機器の使用がブラウザで許可されていません");
      } else if (e?.name === "NotFoundError") {
        toast("接続中の出力機器が見つかりません");
      } else if (e?.name === "AbortError") {
        toast("出力機器の切り替えに失敗しました。元のスピーカーへ戻しました");
      } else {
        toast("スピーカーの切り替えに失敗しました。元のスピーカーへ戻しました");
      }
      return false;
    }
  }

  function renderAdditionalOutputSpeakers() {
    if (!el.additionalOutputSpeakers) return;
    el.additionalOutputSpeakers.innerHTML = "";

    state.outputRoutes.forEach((route, index) => {
      const card = document.createElement("div");
      card.className = "additionalOutputSpeakerCard";

      const head = document.createElement("div");
      head.className = "additionalOutputSpeakerHead";

      const name = document.createElement("strong");
      name.className = "additionalOutputSpeakerName";
      name.textContent = route.label || "登録スピーカー";

      const actions = document.createElement("div");
      actions.className = "additionalOutputSpeakerActions";

      const toggle = document.createElement("button");
      toggle.className = "btn small additionalOutputSpeakerToggle";
      toggle.type = "button";
      const isEnabled = route.enabled !== false;
      toggle.textContent = isEnabled ? "使用中" : "停止中";
      toggle.classList.toggle("active", isEnabled);
      toggle.setAttribute("aria-pressed", String(isEnabled));
      toggle.setAttribute("aria-label", (route.label || "登録スピーカー") + "の使用状態を切り替える");
      toggle.addEventListener("click", () => toggleAdditionalOutputSpeaker(index));

      const remove = document.createElement("button");
      remove.className = "btn small ghost";
      remove.type = "button";
      remove.textContent = "削除";
      remove.addEventListener("click", () => removeAdditionalOutputSpeaker(index));

      actions.append(toggle, remove);
      head.append(name, actions);

      const wrap = document.createElement("div");
      wrap.className = "channelVolumeWrap additionalChannelVolumeWrap";

      const makeChannel = (side, value) => {
        const item = document.createElement("div");
        item.className = "channelVolume";

        const valueEl = document.createElement("span");
        valueEl.className = "channelValue";
        valueEl.textContent = Math.round(value * 100) + "%";

        const slider = document.createElement("input");
        slider.className = "channelSlider";
        slider.type = "range";
        slider.min = "0";
        slider.max = "2";
        slider.step = "0.01";
        slider.value = String(value);
        slider.setAttribute("aria-label", (side === "left" ? "左" : "右") + "チャンネル音量");

        const label = document.createElement("strong");
        label.textContent = side === "left" ? "L" : "R";

        slider.addEventListener("input", e => {
          updateAdditionalOutputVolume(index, side, e.target.value);
          valueEl.textContent = Math.round(state.outputRoutes[index][side === "left" ? "left" : "right"] * 100) + "%";
        });

        item.append(valueEl, slider, label);
        return item;
      };

      const delayWrap = document.createElement("div");
      delayWrap.className = "speakerDelayControls additionalSpeakerDelayControls";

      const delayLabel = document.createElement("span");
      delayLabel.className = "speakerDelayLabel";
      delayLabel.textContent = "遅延";

      const delayDown = document.createElement("button");
      delayDown.className = "btn small ghost";
      delayDown.type = "button";
      delayDown.textContent = "▼";
      delayDown.setAttribute("aria-label", (route.label || "登録スピーカー") + "の遅延を0.1ミリ秒減らす");

      const delayInput = document.createElement("input");
      delayInput.className = "speakerDelayInput";
      delayInput.type = "number";
      delayInput.min = "0";
      delayInput.max = "1000";
      delayInput.step = "0.1";
      delayInput.value = String(clampSpeakerDelay(route.delayMs));
      delayInput.inputMode = "numeric";
      delayInput.setAttribute("aria-label", (route.label || "登録スピーカー") + "の遅延ミリ秒");

      const delayUnit = document.createElement("span");
      delayUnit.className = "speakerDelayUnit";
      delayUnit.textContent = "ms";

      const delayUp = document.createElement("button");
      delayUp.className = "btn small ghost";
      delayUp.type = "button";
      delayUp.textContent = "▲";
      delayUp.setAttribute("aria-label", (route.label || "登録スピーカー") + "の遅延を0.1ミリ秒増やす");

      delayDown.addEventListener("click", () => setAdditionalOutputDelay(index, route.delayMs - 0.1));
      delayUp.addEventListener("click", () => setAdditionalOutputDelay(index, route.delayMs + 0.1));
      delayInput.addEventListener("change", e => setAdditionalOutputDelay(index, e.target.value));

      delayWrap.append(delayLabel, delayDown, delayInput, delayUnit, delayUp);

      wrap.append(
        makeChannel("left", Number(route.left) || 1),
        makeChannel("right", Number(route.right) || 1)
      );

      card.append(head, wrap, delayWrap);
      el.additionalOutputSpeakers.appendChild(card);
    });
  }
  function getMainOutputIdentity() {
    return getCurrentMainOutputSinkId() || "default";
  }

  function hasAdditionalOutput(deviceId) {
    const normalized = deviceId || "default";
    return state.outputRoutes.some(route => (route.deviceId || "default") === normalized);
  }

  function disconnectAdditionalOutputRuntime(deviceId) {
    const runtime = additionalOutputRuntimes.get(deviceId);
    if (!runtime) return;
    if (runtime.connected) {
      try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
      runtime.connected = false;
    }
    try { runtime.audio.pause(); } catch (e) {}
  }

  async function toggleAdditionalOutputSpeaker(index) {
    const route = state.outputRoutes[index];
    if (!route) return;

    route.enabled = route.enabled === false;
    saveState();

    if (route.enabled) {
      const runtime = additionalOutputRuntimes.get(route.deviceId);
      if (runtime) {
        if (!runtime.connected) {
          try {
            speakerBusNode.connect(runtime.splitter);
            runtime.connected = true;
          } catch (e) {}
        }
        try { await runtime.audio.play(); } catch (e) {}
      } else {
        await createAdditionalOutputRuntime(route);
      }
    } else {
      disconnectAdditionalOutputRuntime(route.deviceId);
    }

    renderAdditionalOutputSpeakers();
    renderOutputDevicePicker();
  }

  function removeAdditionalOutputSpeaker(index) {
    const route = state.outputRoutes[index];
    if (!route) return;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    if (runtime) {
      try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
      try { runtime.audio.pause(); } catch (e) {}
      try { runtime.audio.srcObject = null; } catch (e) {}
      runtime.audio.remove();
      additionalOutputRuntimes.delete(route.deviceId);
    }

    state.outputRoutes.splice(index, 1);
    saveState();
    renderAdditionalOutputSpeakers();
    renderOutputDevicePicker();
  }

  function updateAdditionalOutputVolume(index, side, value) {
    const route = state.outputRoutes[index];
    if (!route) return;
    const key = side === "left" ? "left" : "right";
    const n = Math.max(0, Math.min(2, Number(value)));
    route[key] = Number.isFinite(n) ? n : 1;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    if (runtime) {
      const gain = side === "left" ? runtime.leftGain : runtime.rightGain;
      gain.gain.setTargetAtTime(route[key], audioCtx?.currentTime || 0, 0.045);
    }
    saveState();
  }

  function setAdditionalOutputDelay(index, value) {
    const route = state.outputRoutes[index];
    if (!route) return;
    const delayMs = clampSpeakerDelay(value);
    route.delayMs = delayMs;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    saveState();
    applyAllSpeakerDelayNodes();
    renderAdditionalOutputSpeakers();
  }

  async function createAdditionalOutputRuntime(route) {
    if (!audioCtx || !analyser || !route?.deviceId) return null;
    if (additionalOutputRuntimes.has(route.deviceId)) return additionalOutputRuntimes.get(route.deviceId);
    if (!("setSinkId" in HTMLMediaElement.prototype) || !audioCtx.createMediaStreamDestination) return null;

    const destination = audioCtx.createMediaStreamDestination();
    const splitter = audioCtx.createChannelSplitter(2);
    const leftGain = audioCtx.createGain();
    const rightGain = audioCtx.createGain();
    const merger = audioCtx.createChannelMerger(2);
    const delayNode = audioCtx.createDelay(1.5);
    const media = document.createElement("audio");

    leftGain.gain.value = Number.isFinite(Number(route.left)) ? Number(route.left) : 1;
    rightGain.gain.value = Number.isFinite(Number(route.right)) ? Number(route.right) : 1;
    media.autoplay = true;
    media.controls = false;
    media.playsInline = true;
    media.setAttribute("aria-hidden", "true");
    media.style.display = "none";
    media.srcObject = destination.stream;
    delayNode.delayTime.value = Math.min(1.5, getEffectiveSpeakerDelay(route.delayMs) / 1000);

    speakerBusNode.connect(splitter);
    const runtime = { audio: media, destination, splitter, leftGain, rightGain, merger, delayNode, connected: true };
    splitter.connect(leftGain, 0, 0);
    splitter.connect(rightGain, 1, 0);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
    merger.connect(delayNode);
    delayNode.connect(destination);

    media.volume = 1;
    media.muted = false;
    document.body.appendChild(media);

    try {
      await media.setSinkId(route.deviceId);
    } catch (e) {
      try { speakerBusNode?.disconnect(splitter); } catch (ignore) {}
      media.pause();
      media.srcObject = null;
      media.remove();
      return null;
    }

    additionalOutputRuntimes.set(route.deviceId, runtime);
    if (route.enabled !== false && !audio.paused) {
      try { await media.play(); } catch (e) {}
    } else if (route.enabled === false) {
      disconnectAdditionalOutputRuntime(route.deviceId);
    }
    return runtime;
  }

  async function syncAdditionalOutputRuntimes() {
    if (!audioCtx || !analyser) return;
    const validIds = new Set(state.outputRoutes.map(route => route.deviceId).filter(Boolean));

    for (const [deviceId, runtime] of additionalOutputRuntimes) {
      if (!validIds.has(deviceId)) {
        try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
        try { runtime.audio.pause(); } catch (e) {}
        try { runtime.audio.srcObject = null; } catch (e) {}
        runtime.audio.remove();
        additionalOutputRuntimes.delete(deviceId);
      }
    }

    for (const route of state.outputRoutes) {
      if (route.enabled === false) {
        disconnectAdditionalOutputRuntime(route.deviceId);
        continue;
      }
      await createAdditionalOutputRuntime(route);
    }
  }

  async function startOutputBridge() {
    if (outputBridgeAudio) {
      try {
        if (outputBridgeAudio.paused) await outputBridgeAudio.play();
      } catch (e) {}
    }
    for (const runtime of additionalOutputRuntimes.values()) {
      try {
        if (runtime.audio.paused) await runtime.audio.play();
      } catch (e) {}
    }
  }

  async function addAdditionalOutputSpeaker(device) {
    const deviceId = device?.deviceId || "";
    if (!deviceId) return false;
    const normalized = deviceId || "default";
    const mainId = getMainOutputIdentity();

    if (normalized === mainId) {
      toast("現在のスピーカーはすでにメイン出力です");
      return false;
    }
    if (hasAdditionalOutput(normalized)) {
      toast("そのスピーカーは追加済みです");
      return false;
    }

    const label = String(device?.label || "").trim();
    if (!label) {
      toast("スピーカー名を取得できないため追加できません。先に出力機器を選択してください");
      return false;
    }

    const route = {
      deviceId,
      label,
      left: 1,
      right: 1,
      delayMs: 0,
      enabled: true
    };

    // 接続に成功してから登録する。失敗した機器を「登録スピーカー」として保存しない。
    const runtime = await createAdditionalOutputRuntime(route);
    if (!runtime) {
      toast("スピーカーを追加できませんでした");
      return false;
    }

    state.outputRoutes.push(route);
    saveState();
    renderAdditionalOutputSpeakers();
    await startOutputBridge();
    renderOutputDeviceAddPicker();
    closeOutputDeviceAddModal();
    toast("スピーカーを追加しました");
    return true;
  }

  function outputDeviceIsDefaultPhysical(device, outputs) {
    const defaultDevice = outputs.find(d => d.deviceId === "default");
    return !!defaultDevice && areSameOutputDevice(defaultDevice, device);
  }

  function getOutputDevicePriority(device) {
    const label = String(device?.label || "").toLowerCase();
    const externalPattern = /(hdmi|displayport|headphone|headset|earphone|bluetooth|usb|wireless|ヘッドホン|ヘッドセット|イヤホン|bluetooth|無線|usb)/i;
    return externalPattern.test(label) ? 0 : 1;
  }

  async function renderOutputDevicePicker() {
    if (!el.outputDeviceList || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const outputs = await ensureOutputDeviceAccess();
      const mainId = getMainOutputIdentity();

      el.outputDeviceList.innerHTML = "";

      const defaultDevice = outputs.find(d => d.deviceId === "default") || { deviceId: "", label: "既定のスピーカー" };
      const physicalOutputs = outputs
        .filter(d => d.deviceId && d.deviceId !== "default")
        .sort((a, b) => {
          const priorityDiff = getOutputDevicePriority(a) - getOutputDevicePriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          return String(a.label || "").localeCompare(String(b.label || ""), "ja");
        });
      const defaultPhysical = physicalOutputs.find(device => areSameOutputDevice(defaultDevice, device));

      const list = [
        ...physicalOutputs.filter(device => !defaultPhysical || !areSameOutputDevice(defaultDevice, device)),
        { deviceId: "", label: "既定のスピーカー" }
      ];

      const seen = new Set();
      for (const device of list) {
        const key = device.deviceId || "default";
        if (seen.has(key)) continue;
        seen.add(key);

        const item = document.createElement("div");
        item.className = "outputDeviceItem";

        const info = document.createElement("div");
        info.className = "outputDeviceItemInfo";

        const name = document.createElement("strong");
        name.textContent = getOutputDeviceLabel(device, "音声出力デバイス");

        const stateText = document.createElement("small");
        const isMain = key === mainId || (
          key === "default" &&
          defaultPhysical &&
          mainId === defaultPhysical.deviceId
        );
        stateText.textContent = isMain ? "現在使用中" : "";

        info.append(name, stateText);

        const actions = document.createElement("div");
        actions.className = "outputDeviceItemActions";

        const mainBtn = document.createElement("button");
        mainBtn.className = "btn small";
        mainBtn.type = "button";
        mainBtn.textContent = isMain ? "使用中" : "使用する";
        mainBtn.disabled = isMain;
        mainBtn.addEventListener("click", async () => {
          await selectOutputDeviceForMain(device.deviceId || "");
          closeOutputDeviceModal();
        });

        actions.append(mainBtn);
        item.append(info, actions);
        el.outputDeviceList.appendChild(item);
      }

      if (!physicalOutputs.length && typeof navigator.mediaDevices?.selectAudioOutput === "function") {
        const discoverWrap = document.createElement("div");
        discoverWrap.style.display = "grid";
        discoverWrap.style.gap = "8px";
        discoverWrap.style.marginTop = "8px";

        const discoverMessage = document.createElement("div");
        discoverMessage.style.color = "var(--muted)";
        discoverMessage.style.fontSize = ".82rem";
        discoverMessage.textContent =
          "非デフォルトの出力機器は、ブラウザの許可後に一覧へ表示されます。";

        const discoverButton = document.createElement("button");
        discoverButton.className = "btn small";
        discoverButton.type = "button";
        discoverButton.textContent = "接続中の出力機器を読み込む";
        discoverButton.addEventListener("click", async () => {
          try {
            const device = await navigator.mediaDevices.selectAudioOutput();
            if (!device?.deviceId) return;
            await setMainOutputDevice(device.deviceId);
            await renderOutputDevicePicker();
          } catch (e) {
            if (e?.name === "NotAllowedError") {
              toast("ブラウザの出力機器選択が許可されていません");
            } else if (e?.name === "NotFoundError") {
              toast("接続中の出力機器が見つかりません");
            } else if (e?.name === "InvalidStateError") {
              toast("このボタンからもう一度実行してください");
            } else {
              toast("出力機器の読み込みに失敗しました");
            }
          }
        });

        discoverWrap.append(discoverMessage, discoverButton);
        el.outputDeviceList.appendChild(discoverWrap);
      }
    } catch (e) {
      el.outputDeviceList.textContent = "利用できるスピーカーを取得できませんでした。";
    }
  }

  async function requestOutputDevicePermission(deviceId = "") {
    if (!deviceId) return { deviceId: "" };
    if (typeof navigator.mediaDevices?.selectAudioOutput !== "function") {
      return { deviceId };
    }

    try {
      const options = { deviceId };
      const selected = await navigator.mediaDevices.selectAudioOutput(options);
      return selected?.deviceId ? selected : null;
    } catch (e) {
      if (e?.name === "NotAllowedError") {
        toast("ブラウザの出力機器選択が許可されていません");
      } else if (e?.name === "NotFoundError") {
        toast("接続中の出力機器が見つかりません");
      } else if (e?.name === "InvalidStateError") {
        toast("出力機器の選択をもう一度ボタンから実行してください");
      } else {
        toast("出力機器の選択に失敗しました");
      }
      return null;
    }
  }

  async function selectOutputDeviceForMain(deviceId = "") {
    const device = await requestOutputDevicePermission(deviceId);
    if (!device?.deviceId) return;
    await setMainOutputDevice(device.deviceId);
  }

  async function selectAndAddOutputDevice(deviceId = "") {
    const device = await requestOutputDevicePermission(deviceId);
    if (!device?.deviceId) return;
    await addAdditionalOutputSpeaker(device);
  }

  async function renderOutputDeviceAddPicker() {
    if (!el.outputDeviceAddList || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const outputs = await ensureOutputDeviceAccess();
      const mainId = getMainOutputIdentity();

      el.outputDeviceAddList.innerHTML = "";

      const physicalOutputs = outputs
        .filter(d => d.deviceId && d.deviceId !== "default")
        .sort((a, b) => {
          const priorityDiff = getOutputDevicePriority(a) - getOutputDevicePriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          return String(a.label || "").localeCompare(String(b.label || ""), "ja");
        });
      const seen = new Set();

      for (const device of physicalOutputs) {
        const key = device.deviceId;
        if (seen.has(key)) continue;
        seen.add(key);

        const item = document.createElement("div");
        item.className = "outputDeviceItem";

        const info = document.createElement("div");
        info.className = "outputDeviceItemInfo";

        const name = document.createElement("strong");
        name.textContent = getOutputDeviceLabel(device, "音声出力デバイス");

        const stateText = document.createElement("small");
        const isMain = key === mainId || (
          mainId === "default" && outputDeviceIsDefaultPhysical(device, outputs)
        );
        const isAdditional = hasAdditionalOutput(key);
        stateText.textContent = isMain ? "現在使用中" : (isAdditional ? "追加済み" : "");

        info.append(name, stateText);

        const actions = document.createElement("div");
        actions.className = "outputDeviceItemActions";

        const addBtn = document.createElement("button");
        addBtn.className = "btn small";
        addBtn.type = "button";
        addBtn.textContent = isMain ? "使用中" : (isAdditional ? "追加済み" : "追加");
        addBtn.disabled = isMain || isAdditional;
        addBtn.addEventListener("click", () => selectAndAddOutputDevice(device.deviceId || ""));

        actions.append(addBtn);
        item.append(info, actions);
        el.outputDeviceAddList.appendChild(item);
      }

      if (!physicalOutputs.length) {
        el.outputDeviceAddList.innerHTML = "";

        const emptyMessage = document.createElement("div");
        emptyMessage.style.color = "var(--muted)";
        emptyMessage.style.fontSize = ".82rem";
        emptyMessage.textContent =
          "非デフォルトの出力機器は、ブラウザの許可後に一覧へ表示されます。";

        const discoverButton = document.createElement("button");
        discoverButton.className = "btn small";
        discoverButton.type = "button";
        discoverButton.textContent = typeof navigator.mediaDevices?.selectAudioOutput === "function"
          ? "接続中の出力機器を読み込む"
          : "出力機器一覧を更新";
        discoverButton.addEventListener("click", async () => {
          try {
            if (typeof navigator.mediaDevices?.selectAudioOutput === "function") {
              const device = await navigator.mediaDevices.selectAudioOutput();
              if (device?.deviceId) {
                await addAdditionalOutputSpeaker(device);
                return;
              }
            } else {
              await ensureOutputDeviceAccess();
              await renderOutputDeviceAddPicker();
            }
          } catch (e) {
            if (e?.name === "NotAllowedError") {
              toast("ブラウザの出力機器選択が許可されていません");
            } else if (e?.name === "NotFoundError") {
              toast("接続中の出力機器が見つかりません");
            } else if (e?.name === "InvalidStateError") {
              toast("このボタンからもう一度実行してください");
            } else {
              toast("出力機器の読み込みに失敗しました");
            }
            await renderOutputDeviceAddPicker();
          }
        });

        el.outputDeviceAddList.append(emptyMessage, discoverButton);
      }
    } catch (e) {
      el.outputDeviceAddList.textContent = "利用できるスピーカーを取得できませんでした。";
    }
  }

  function openOutputDeviceModal() {
    if (!el.outputDeviceModal) return;
    moveOutputDeviceModalsToBody();
    ensureGraph();
    el.outputDeviceModal.hidden = false;
    document.body.classList.add("output-device-modal-open");
    renderOutputDevicePicker();
  }

  function openOutputDeviceAddModal() {
    if (!el.outputDeviceAddModal) return;
    moveOutputDeviceModalsToBody();
    ensureGraph();
    el.outputDeviceAddModal.hidden = false;
    document.body.classList.add("output-device-modal-open");
    renderOutputDeviceAddPicker();
  }

  async function chooseMainOutputDevice() {
    openOutputDeviceModal();
  }

  if (el.btnSelectOutput) el.btnSelectOutput.addEventListener("click", chooseMainOutputDevice);
  if (el.btnSelectOutputDirect) el.btnSelectOutputDirect.addEventListener("click", selectOutputDeviceForMain);
  if (el.btnAddOutputSpeaker) el.btnAddOutputSpeaker.addEventListener("click", openOutputDeviceAddModal);
  if (el.btnSelectOutputToAdd) el.btnSelectOutputToAdd.addEventListener("click", selectAndAddOutputDevice);
  if (el.btnCloseOutputDeviceModal) el.btnCloseOutputDeviceModal.addEventListener("click", closeOutputDeviceModal);
  if (el.btnCloseOutputDeviceModalBottom) el.btnCloseOutputDeviceModalBottom.addEventListener("click", closeOutputDeviceModal);
  if (el.btnCloseOutputDeviceAddModal) el.btnCloseOutputDeviceAddModal.addEventListener("click", closeOutputDeviceAddModal);
  if (el.btnCloseOutputDeviceAddModalBottom) el.btnCloseOutputDeviceAddModalBottom.addEventListener("click", closeOutputDeviceAddModal);
  if (el.btnRefreshOutputAddList) el.btnRefreshOutputAddList.addEventListener("click", renderOutputDeviceAddPicker);
  if (el.btnDiscoverOutputSpeaker) {
    el.btnDiscoverOutputSpeaker.addEventListener("click", async () => {
      try {
        if (typeof navigator.mediaDevices?.selectAudioOutput === "function") {
          await navigator.mediaDevices.selectAudioOutput();
        }
        await ensureOutputDeviceAccess();
        await renderOutputDeviceAddPicker();
        toast("接続可能な出力機器を更新しました");
      } catch (e) {
        toast("出力機器の許可・取得に失敗しました");
      }
    });
  }

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      await restoreStoredMainOutputIfAvailable();
      await updateOutputDeviceName();
      await renderOutputDevicePicker();
      await renderOutputDeviceAddPicker();
      await syncAdditionalOutputRuntimes();
    });
  }

  updateOutputDeviceName();
  renderAdditionalOutputSpeakers();

  function setClippingProtection(enabled) {
    state.clippingProtection = !!enabled;
    saveState();
    if (audioCtx && finalMixGainNode && speakerBusNode && limiterNode) {
      try {
        try { finalMixGainNode.disconnect(limiterNode); } catch (e) {}
        try { finalMixGainNode.disconnect(speakerBusNode); } catch (e) {}
        try { limiterNode.disconnect(speakerBusNode); } catch (e) {}
        if (state.clippingProtection) {
          finalMixGainNode.connect(limiterNode);
          limiterNode.connect(speakerBusNode);
        } else {
          finalMixGainNode.connect(speakerBusNode);
        }
      } catch (e) {}
    }
    if (el.btnClippingProtection) {
      el.btnClippingProtection.textContent = `音割れ防止: ${state.clippingProtection ? "ON" : "OFF"}`;
      el.btnClippingProtection.classList.toggle("active", state.clippingProtection);
    }
  }

  if (el.btnClippingProtection) {
    el.btnClippingProtection.addEventListener("click", () => setClippingProtection(!state.clippingProtection));
    el.btnClippingProtection.textContent = `音割れ防止: ${state.clippingProtection ? "ON" : "OFF"}`;
    el.btnClippingProtection.classList.toggle("active", state.clippingProtection);
  }

  function updateMicMonitorUI() {
    if (el.btnMicMonitor) {
      el.btnMicMonitor.textContent = `マイクモニター: ${state.micMonitor ? "ON" : "OFF"}`;
      el.btnMicMonitor.classList.toggle("active", state.micMonitor);
    }
    if (el.micMonitorVolume) el.micMonitorVolume.value = currentMicMonitorVolumeTarget;
    if (el.micMonitorVolumeText) {
      el.micMonitorVolumeText.textContent = `${Math.round(currentMicMonitorVolumeTarget * 100)}%`;
    }
  }

  function stopMicFeedbackMonitor() {
    if (micFeedbackTimer) {
      clearInterval(micFeedbackTimer);
      micFeedbackTimer = null;
    }
    micFeedbackHighSimilarityFrames = 0;
    micFeedbackStableFrames = 0;
    if (micFeedbackGainNode && audioCtx) {
      micFeedbackGainNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.15);
    }
  }

  function micFeedbackSimilarity() {
    if (!state.micFeedbackProtection ||
        !state.micMonitor ||
        !micFeedbackAnalyser ||
        !micReferenceAnalyser ||
        !micFeedbackData ||
        !micReferenceData) {
      return 0;
    }

    micFeedbackAnalyser.getByteFrequencyData(micFeedbackData);
    micReferenceAnalyser.getByteFrequencyData(micReferenceData);

    let dot = 0;
    let micEnergy = 0;
    let referenceEnergy = 0;
    let micPeak = 0;
    let micPeakBin = 0;

    for (let i = 1; i < micFeedbackData.length; i++) {
      const micValue = micFeedbackData[i] / 255;
      const referenceValue = micReferenceData[i] / 255;
      dot += micValue * referenceValue;
      micEnergy += micValue * micValue;
      referenceEnergy += referenceValue * referenceValue;

      if (micValue > micPeak) {
        micPeak = micValue;
        micPeakBin = i;
      }
    }

    if (micEnergy < 0.002 || referenceEnergy < 0.004) return 0;

    const cosine = dot / Math.sqrt(micEnergy * referenceEnergy);
    const localReference = micReferenceData[Math.min(micPeakBin, micReferenceData.length - 1)] / 255;
    const peakSupport = localReference > 0.18 ? 1 : 0;

    return peakSupport ? cosine : cosine * 0.75;
  }

  function updateMicFeedbackProtection() {
    if (!state.micFeedbackProtection || !state.micMonitor || !micFeedbackGainNode || !audioCtx) {
      if (micFeedbackGainNode && audioCtx) {
        micFeedbackGainNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.15);
      }
      micFeedbackHighSimilarityFrames = 0;
      micFeedbackStableFrames = 0;
      return;
    }

    const similarity = micFeedbackSimilarity();

    if (similarity >= 0.90) {
      micFeedbackHighSimilarityFrames += 1;
      micFeedbackStableFrames += 1;
    } else {
      micFeedbackHighSimilarityFrames = Math.max(0, micFeedbackHighSimilarityFrames - 1);
      micFeedbackStableFrames = Math.max(0, micFeedbackStableFrames - 1);
    }

    const isLikelyFeedback =
      micFeedbackHighSimilarityFrames >= 4 &&
      micFeedbackStableFrames >= 4;

    const targetGain = isLikelyFeedback ? 0.15 : 1;
    const timeConstant = isLikelyFeedback ? 0.025 : 0.20;
    micFeedbackGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, timeConstant);
  }

  function startMicFeedbackMonitor() {
    stopMicFeedbackMonitor();
    if (!state.micFeedbackProtection) return;
    micFeedbackTimer = setInterval(updateMicFeedbackProtection, 50);
  }

  function updateMicFeedbackProtectionUI() {
    if (!el.btnMicFeedbackProtection) return;
    el.btnMicFeedbackProtection.textContent =
      "ハウリング防止: " + (state.micFeedbackProtection ? "ON" : "OFF");
    el.btnMicFeedbackProtection.classList.toggle("active", state.micFeedbackProtection);
  }

  async function setMicFeedbackProtectionEnabled(enabled) {
    const wasMonitoring = state.micMonitor;
    state.micFeedbackProtection = !!enabled;
    saveState();
    updateMicFeedbackProtectionUI();

    if (wasMonitoring) {
      await setMicMonitorEnabled(false);
      await setMicMonitorEnabled(true);
    }
  }

  function stopMicMonitor() {
    stopMicFeedbackMonitor();
    if (micSourceNode) {
      try { micSourceNode.disconnect(); } catch (e) {}
      micSourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      micStream = null;
    }
  }

  function updateMicMonitorVolumeUI(value) {
    const n = Number(value);
    currentMicMonitorVolumeTarget = Math.max(0, Math.min(2, Number.isFinite(n) ? n : 1));
    state.micMonitorVolume = currentMicMonitorVolumeTarget;
    if (micGainNode) {
      micGainNode.gain.setTargetAtTime(
        currentMicMonitorVolumeTarget,
        audioCtx ? audioCtx.currentTime : 0,
        0.045
      );
    }
    updateMicMonitorUI();
    saveState();
  }

  async function setMicMonitorEnabled(enabled) {
    state.micMonitor = !!enabled;
    const requestId = ++micMonitorRequestId;
    updateMicMonitorUI();

    if (!state.micMonitor) {
      stopMicMonitor();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      state.micMonitor = false;
      updateMicMonitorUI();
      toast("このブラウザではマイク入力を利用できません");
      return;
    }

    ensureGraph();
    if (audioCtx && audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch {}
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: "default" },
          echoCancellation: state.micFeedbackProtection,
          noiseSuppression: state.micFeedbackProtection,
          autoGainControl: false,
          channelCount: { ideal: 2 }
        }
      });

      if (requestId !== micMonitorRequestId || !state.micMonitor) {
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
        return;
      }

      stopMicMonitor();
      micStream = stream;
      micSourceNode = audioCtx.createMediaStreamSource(stream);
      micGainNode.gain.value = currentMicMonitorVolumeTarget;
      micSourceNode.connect(micFeedbackGainNode);
      micFeedbackGainNode.connect(micFeedbackAnalyser);
      micFeedbackGainNode.connect(micGainNode);
      startMicFeedbackMonitor();
      toast("マイクモニターを開始しました");

      const track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener("ended", () => {
          if (micStream !== stream) return;
          stopMicMonitor();
          state.micMonitor = false;
          updateMicMonitorUI();
          toast("マイクが切断されたため、マイクモニターをOFFにしました");
        });
      }
    } catch (e) {
      if (requestId !== micMonitorRequestId) return;
      state.micMonitor = false;
      stopMicMonitor();
      updateMicMonitorUI();

      const message = e?.name === "NotAllowedError"
        ? "マイクの使用が許可されていません。サイトのマイク権限も確認してください"
        : e?.name === "NotFoundError"
          ? "使用できるマイクが見つかりません"
          : e?.name === "NotReadableError"
            ? "マイクは見つかりましたが、別のアプリで使用中などの理由で読み取れません"
            : "マイクを開始できませんでした";
      toast(message);
    }
  }

  if (el.btnMicMonitor) {
    el.btnMicMonitor.addEventListener("click", () => {
      setMicMonitorEnabled(!state.micMonitor);
    });
  }

  if (el.micMonitorVolume) {
    el.micMonitorVolume.value = currentMicMonitorVolumeTarget;
    el.micMonitorVolume.addEventListener("input", e => {
      updateMicMonitorVolumeUI(e.target.value);
    });
  }
  updateMicMonitorUI();
  updateMicFeedbackProtectionUI();

  if (el.btnMicFeedbackProtection) {
    el.btnMicFeedbackProtection.addEventListener("click", () => {
      setMicFeedbackProtectionEnabled(!state.micFeedbackProtection);
    });
  }

  async function resumeAudioCtx(){
    ensureGraph();
    if(audioCtx && audioCtx.state === "suspended"){
      try { await audioCtx.resume(); } catch{}
    }
  }

  function applyPitchAndRate(){
    const pitchFactor = Math.pow(2, state.pitchSemitones / 12);
    audio.playbackRate = currentRate * pitchFactor;
    audio.preservesPitch = false;
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
        x = state.panValue * 2; y = 0; z = 1; setPos(x, y, z); break;
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
      "2D": "2D: 標準ステレオ再生",
      "3D": "3D: 左右パン連動の固定立体音響",
      "4D": "4D: 前後左右＋上下の緩やかな空間揺らぎ",
      "8D": "8D: 頭の周りを360度全方位回転",
      "16D": "16D: 高度なマルチトラック8の字立体周回"
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
    Object.keys(EQ_PRESETS).forEach(pName => {
      const b = document.createElement("button");
      b.className = "btn small" + (state.eqState.preset === pName ? " active" : "");
      b.textContent = pName;
      b.addEventListener("click", () => {
        state.eqState.preset = pName;
        animateEqPreset(EQ_PRESETS[pName]);
        updatePresetButtonsUI();
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
            STORAGE.playlistSettings,
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