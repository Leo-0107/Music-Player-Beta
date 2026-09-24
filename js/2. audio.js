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
    localStorage.setItem(STORAGE.playlistSettings, JSON.stringify(state.playlistSettings || {}));
  }

  function setWaveMode(mode) {
    state.waveMode = mode === "2d" ? "2d" : "3d";
    saveState();
    if (el.waveModeBtns) {
      el.waveModeBtns.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.wave === mode);
      });
    }
  }

  if (el.waveModeBtns) {
    el.waveModeBtns.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => setWaveMode(btn.dataset.wave));
    });
  }

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

    bindAction('play', () => { if (audio.paused) playPause(); });
    bindAction('pause', () => { if (!audio.paused) playPause(); });
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

      channelSplitter = audioCtx.createChannelSplitter(2);
      leftGainNode = audioCtx.createGain();
      rightGainNode = audioCtx.createGain();
      channelMerger = audioCtx.createChannelMerger(2);
      leftGainNode.gain.value = currentLeftVolumeTarget;
      rightGainNode.gain.value = currentRightVolumeTarget;

      outputSplitter = audioCtx.createChannelSplitter(2);
      leftLevelAnalyser = audioCtx.createAnalyser();
      rightLevelAnalyser = audioCtx.createAnalyser();
      leftLevelAnalyser.fftSize = 128;
      rightLevelAnalyser.fftSize = 128;
      leftLevelData = new Uint8Array(leftLevelAnalyser.fftSize);
      rightLevelData = new Uint8Array(rightLevelAnalyser.fftSize);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = currentVolumeTarget;
      audio.volume = Math.min(1.0, Math.max(0.0, currentVolumeTarget));

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

      sourceNode.connect(filters[0]);
      for(let i=0; i<filters.length-1; i++) filters[i].connect(filters[i+1]);
      
      let lastFilter = filters[filters.length-1];
      if (pannerNode && panner3DNode) {
        lastFilter.connect(pannerNode);
        pannerNode.connect(panner3DNode);
        lastFilter = panner3DNode;
      } else if (pannerNode) {
        lastFilter.connect(pannerNode);
        lastFilter = pannerNode;
      } else if (panner3DNode) {
        lastFilter.connect(panner3DNode);
        lastFilter = panner3DNode;
      }

      // パイプライン: lastFilter -> L/R個別ゲイン -> masterGain -> (limiter) -> analyser -> destination
      lastFilter.connect(channelSplitter);
      channelSplitter.connect(leftGainNode, 0, 0);
      channelSplitter.connect(rightGainNode, 1, 0);
      leftGainNode.connect(channelMerger, 0, 0);
      rightGainNode.connect(channelMerger, 0, 1);
      channelMerger.connect(masterGain);

      // マスター音量後のL/Rを個別に測定して2D波形へ表示
      masterGain.connect(outputSplitter);
      outputSplitter.connect(leftLevelAnalyser, 0);
      outputSplitter.connect(rightLevelAnalyser, 1);

      if (state.clippingProtection) {
        outputSplitter.connect(limiterNode, 0, 0);
        outputSplitter.connect(limiterNode, 1, 1);
        limiterNode.connect(analyser);
      } else {
        masterGain.connect(analyser);
      }
      analyser.connect(audioCtx.destination);

      audioGraphReady = true;
    } catch(e) {}
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

  async function updateOutputDeviceName() {
    if (!el.outputDeviceName || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === "audiooutput");
      const sinkId = audio.sinkId || "default";
      const current = outputs.find(d => d.deviceId === sinkId)
        || outputs.find(d => d.deviceId === "default")
        || outputs[0];
      el.outputDeviceName.textContent = current?.label || "既定のスピーカー";
    } catch (e) {
      el.outputDeviceName.textContent = "既定のスピーカー";
    }
  }

  updateOutputDeviceName();
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", updateOutputDeviceName);
  }

  function setClippingProtection(enabled) {
    state.clippingProtection = !!enabled;
    saveState();
    if (audioCtx && masterGain && analyser && limiterNode) {
      try {
        masterGain.disconnect();
        limiterNode.disconnect();
        try { outputSplitter?.disconnect(limiterNode); } catch (e) {}
        if (state.clippingProtection) {
          outputSplitter.connect(limiterNode, 0, 0);
          outputSplitter.connect(limiterNode, 1, 1);
          limiterNode.connect(analyser);
        } else {
          masterGain.connect(analyser);
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
    if (!audioCtx || !panner3DNode || audio.paused) return;
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
      ctx.fillText("5", size / 2, size / 2);
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
