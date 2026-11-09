      showInSiteConfirm("再生履歴を削除しますか？", "再生履歴と再生回数のデータを削除します。", () => {
        state.playCounts = {};
        state.playHistory = {};
        state.playStats = {};
        saveState();
        renderStats();
        renderSongList();
        toast("再生履歴を削除しました");
      });
    });
  }

  const networkStatusElement = document.getElementById("networkStatus");
  function updateNetworkStatus() {
    if (!networkStatusElement) return;
    const online = navigator.onLine !== false;
    networkStatusElement.textContent = online ? "オンライン" : "オフライン";
    networkStatusElement.classList.toggle("isOnline", online);
    networkStatusElement.classList.toggle("isOffline", !online);
    networkStatusElement.title = online ? "ネットワーク接続あり" : "ネットワーク接続なし";
  }
  updateNetworkStatus();
  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);

  function renderAll(){
    renderSongList();
    renderQueue();
    renderPlaylists();
    renderStats();
  }

  audio.addEventListener("play", () => {
    updatePlayPauseUI();
    if (typeof startOutputBridge === "function") {
      startOutputBridge().catch(() => {});
    }
    if (typeof drawWave === "function" && drawWave._wave3DHistory) {
      // 曲が変わっても3D波形の履歴は継続させる。
      // 実際の曲変更・シーク判定はdrawWave側で行う。
      drawWave._wave3DSampleElapsed = 0;
      drawWave._wave3DLastAudioTime = -1;
      drawWave._wave3DLastSampleTime = -1;
    }
    lastFrameTime = performance.now();
    waveTimeDisplayElapsed = WAVE_TIME_UPDATE_INTERVAL;
    if (typeof drawWave === "function") drawWave._wave3DPauseFade = 1;
    startWaveAnimation();
  });

  audio.addEventListener("pause", () => {
    recordPartialPlayIfNeeded?.();
    updatePlayPauseUI();
    if (typeof drawWave === "function" && drawWave._wave3DHistory) {
      drawWave._wave3DSampleElapsed = 0;
      drawWave._wave3DLastAudioTime = Number(audio.currentTime) || 0;
      drawWave._wave3DLastSampleTime = -1;
      drawWave._wave3DPauseFade = 1;
    }
    waveTimeDisplayElapsed = 0;
    requestWaveVisualDecay?.();
  });

  audio.addEventListener("playing", () => {
    updatePlayPauseUI();
  });

  audio.addEventListener("waiting", () => {
    updatePlayPauseUI();
  });

  let lastStatsTime = 0;
  audio.addEventListener("timeupdate", () => {
    const dur = Number(audio.duration);
    const cur = Number(audio.currentTime) || 0;
    if (!audio.paused && state.currentSong && lastStatsTime > 0) {
      recordPlaybackTime(Math.min(1.5, Math.max(0, cur - lastStatsTime)));
    }
    lastStatsTime = cur;

    if (el.timeNow) el.timeNow.textContent = fmtTime(cur);
    if (el.timeAll) el.timeAll.textContent = Number.isFinite(dur) && dur > 0 ? fmtTime(dur) : "0:00";
    if (el.miniTimeNow) el.miniTimeNow.textContent = fmtTime(cur);
    if (el.miniTimeAll) el.miniTimeAll.textContent = Number.isFinite(dur) && dur > 0 ? fmtTime(dur) : "0:00";

    if(!audio.duration) return;
    if(!isSlidingRange) {
      if (el.progress) el.progress.value = (cur / dur) * 100;
      if (el.miniProgress) el.miniProgress.value = (cur / dur) * 100;
    }
    if (cur > 30 || (dur > 0 && cur / dur > 0.5)) {
      recordPlayCount();
    }

    updateMediaSessionPosition();
  });

  audio.addEventListener("loadedmetadata", () => {
    const dur = Number(audio.duration);
    const text = Number.isFinite(dur) && dur > 0 ? fmtTime(dur) : "0:00";
    if (el.timeAll) el.timeAll.textContent = text;
    if (el.miniTimeNow) el.miniTimeNow.textContent = fmtTime(audio.currentTime || 0);
    if (el.miniTimeAll) el.miniTimeAll.textContent = text;
  });

  audio.addEventListener("ended", () => {
    recordPlaybackTime(Math.min(1.5, Math.max(0, (Number(audio.duration) || 0) - (Number(lastStatsTime) || 0))));
    lastStatsTime = 0;
    releaseWakeLock();
    if (sleepTimerPendingStop && sleepTimerPendingSongName === state.currentSong?.name) {
      sleepTimerPendingStop = false;
      sleepTimerPendingSongName = null;
      setPlaybackIntent(false);
      audio.pause();
      if (sleepIntervalId) clearInterval(sleepIntervalId);
      sleepIntervalId = null;
      if (sleepTimerId) clearTimeout(sleepTimerId);
      sleepTimerId = null;
      sleepTimerEnd = null;
      if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
      toast("現在の曲が終了したため再生を停止しました");
      return;
    }
    if (state.activePlaylistName) {
      nextTrack(true);
      return;
    }
    if(state.repeat) {
      audio.currentTime = 0;
      audio.play().then(() => requestWakeLock()).catch(()=>{});
    } else {
      nextTrack(true);
    }
  });

  if (el.progress) {
    el.progress.addEventListener("pointerdown", () => isSlidingRange = true);
    el.progress.addEventListener("pointerup", () => isSlidingRange = false);
    el.progress.addEventListener("input", () => {
      if(audio.duration) audio.currentTime = (Number(el.progress.value) / 100) * audio.duration;
    });
  }

  if (el.miniProgress) {
    el.miniProgress.addEventListener("pointerdown", () => isSlidingRange = true);
    el.miniProgress.addEventListener("pointerup", () => isSlidingRange = false);
    el.miniProgress.addEventListener("input", () => {
      if(audio.duration) audio.currentTime = (Number(el.miniProgress.value) / 100) * audio.duration;
    });
  }

  if (el.btnPlay) el.btnPlay.addEventListener("click", playPause);
  if (el.miniPlay) el.miniPlay.addEventListener("click", playPause);
  if (el.btnPrev) el.btnPrev.addEventListener("click", prevTrack);
  if (el.miniPrev) el.miniPrev.addEventListener("click", prevTrack);
  if (el.btnNext) el.btnNext.addEventListener("click", () => nextTrack(false));
  if (el.miniNext) el.miniNext.addEventListener("click", () => nextTrack(false));

  if (el.btnRewind10) el.btnRewind10.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  if (el.btnForward10) el.btnForward10.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

  if (el.btnFav) {
    el.btnFav.addEventListener("click", () => {
      if(state.currentSong) toggleFav(state.currentSong.name);
    });
  }

  if (el.btnMainShuffle) {
    el.btnMainShuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      resetHomeCycle();
      saveState();
      el.btnMainShuffle.classList.toggle("active", state.shuffle);
      renderQueue();
      toast(`シャッフル: ${state.shuffle ? "ON" : "OFF"}`);
    });
    el.btnMainShuffle.classList.toggle("active", state.shuffle);
  }

  if (el.btnMainRepeat) {
    el.btnMainRepeat.addEventListener("click", () => {
      state.repeat = !state.repeat;
      saveState();
      el.btnMainRepeat.classList.toggle("active", state.repeat);
      toast(`リピート: ${state.repeat ? "ON" : "OFF"}`);
    });
    el.btnMainRepeat.classList.toggle("active", state.repeat);
  }

  if (el.pillFavs) {
    el.pillFavs.addEventListener("click", () => {
      state.favOnly = !state.favOnly;
      el.pillFavs.classList.toggle("active", state.favOnly);
      renderSongList();
    });
  }

  if (el.search) {
    el.search.addEventListener("input", e => {
      state.search = e.target.value;
      resetHomeCycle();
      renderSongList();
    });
  }

  if (el.playbackRate) {
    el.playbackRate.addEventListener("input", e => {
      currentRate = Math.max(0, Math.min(2, snapToDefault(Number(e.target.value), 1, 0.08)));
      e.target.value = currentRate;
      if (el.customRateInput) el.customRateInput.value = currentRate.toFixed(2);
      applyPitchAndRate();
    });
  }

  if (el.customRateInput) {
    el.customRateInput.addEventListener("change", e => {
      let v = Number(e.target.value);
      if (v < 0.1) v = 0.1;
      if (v > 10) v = 10;
      currentRate = snapToDefault(v, 1, 0.08);
      if (el.playbackRate) el.playbackRate.value = Math.min(2.0, Math.max(0.0, currentRate));
      applyPitchAndRate();
    });
  }

  if (el.pitchShift) {
    el.pitchShift.addEventListener("input", e => {
      state.pitchSemitones = Math.max(-12, Math.min(12, snapToDefault(Number(e.target.value), 0, 0.75)));
      e.target.value = state.pitchSemitones;
      saveState();
      applyPitchAndRate();
    });
  }

  if (el.btnCrossfade) {
    el.btnCrossfade.addEventListener("click", () => {
      state.crossfade = !state.crossfade;
      saveState();
      el.btnCrossfade.textContent = `クロスフェード: ${state.crossfade ? "ON" : "OFF"}`;
      el.btnCrossfade.classList.toggle("active", state.crossfade);
    });
    el.btnCrossfade.textContent = `クロスフェード: ${state.crossfade ? "ON" : "OFF"}`;
    el.btnCrossfade.classList.toggle("active", state.crossfade);
  }

  if (el.btnSilenceSkip) {
    el.btnSilenceSkip.addEventListener("click", () => {
      state.silenceSkip = !state.silenceSkip;
      silenceTimer = 0;
      saveState();
      el.btnSilenceSkip.textContent = `無音スキップ: ${state.silenceSkip ? "ON" : "OFF"}`;
      el.btnSilenceSkip.classList.toggle("active", state.silenceSkip);
    });
    el.btnSilenceSkip.textContent = `無音スキップ: ${state.silenceSkip ? "ON" : "OFF"}`;
    el.btnSilenceSkip.classList.toggle("active", state.silenceSkip);
  }

  if (el.pannerSlider) {
    el.pannerSlider.addEventListener("input", e => {
      state.panValue = Math.max(-1, Math.min(1, snapToDefault(Number(e.target.value), 0, 0.08)));
      e.target.value = state.panValue;
      if (pannerNode) pannerNode.pan.value = state.panValue;
      if (el.pannerValText) {
        if (state.panValue === 0) el.pannerValText.textContent = "中央";
        else if (state.panValue < 0) el.pannerValText.textContent = `左 (${Math.abs(Math.round(state.panValue * 100))}%)`;
        else el.pannerValText.textContent = `右 (${Math.round(state.panValue * 100)}%)`;
      }
    });
  }

  if (el.btnThemeSystem) el.btnThemeSystem.addEventListener("click", () => { state.themeMode = "system"; saveState(); applyTheme(); });
  if (el.btnThemeDark) el.btnThemeDark.addEventListener("click", () => { state.themeMode = "dark"; saveState(); applyTheme(); });
  if (el.btnThemeLight) el.btnThemeLight.addEventListener("click", () => { state.themeMode = "light"; saveState(); applyTheme(); });
  if (el.btnThemeCustom) el.btnThemeCustom.addEventListener("click", () => { state.themeMode = "custom"; saveState(); applyTheme(); renderColorPickers(); });

  let sleepTimerPendingSongName = null;

  function setSleepTimer(minutes) {
    if (sleepTimerId) clearTimeout(sleepTimerId);
    if (sleepIntervalId) clearInterval(sleepIntervalId);
    sleepTimerId = null;
    sleepIntervalId = null;
    sleepTimerPendingStop = false;
    sleepTimerPendingSongName = null;

    if (minutes === "off" || minutes <= 0) {
      sleepTimerEnd = null;
      if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
      toast("スリープタイマーを解除しました");
      return;
    }

    const ms = minutes * 60 * 1000;
    sleepTimerEnd = Date.now() + ms;

    const updateTimerText = () => {
      const remain = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
      if (remain <= 0) {
        if (el.timerStatus) el.timerStatus.textContent = "現在の曲の終了待ち";
        if (sleepIntervalId) clearInterval(sleepIntervalId);
        sleepIntervalId = null;
        return;
      }
      const m = Math.floor(remain / 60);
      const s = remain % 60;
      if (el.timerStatus) el.timerStatus.textContent = `自動停止まで: ${m}分${s}秒`;
    };

    updateTimerText();
    sleepIntervalId = setInterval(updateTimerText, 1000);

    sleepTimerId = setTimeout(() => {
      sleepTimerId = null;
      if (!audio.paused && state.currentSong) {
        sleepTimerPendingStop = true;
        sleepTimerPendingSongName = state.currentSong?.name || null;
        if (el.timerStatus) el.timerStatus.textContent = "現在の曲の終了待ち";
        toast("タイマー時間になりました。現在の曲の終了後に停止します");
        return;
      }
      setPlaybackIntent(false);
      audio.pause();
      releaseWakeLock();
      if (sleepIntervalId) clearInterval(sleepIntervalId);
      sleepIntervalId = null;
      sleepTimerEnd = null;
      toast("スリープタイマーにより再生を停止しました");
      if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
    }, ms);

    toast(`${minutes}分後に自動停止します`);
  }

  document.querySelectorAll("[data-timer]").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.timer;
      if (t === "off") setSleepTimer("off");
      else setSleepTimer(Number(t));
    });
  });

  if (el.btnSetCustomTimer && el.customTimerInput) {
    const applyCustomTimer = () => {
      const v = Number(el.customTimerInput.value);
      if (v > 0) setSleepTimer(v);
    };
    el.btnSetCustomTimer.addEventListener("click", applyCustomTimer);
    el.customTimerInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyCustomTimer();
      }
    });
  }

  let waveViewYaw = 0;
  let waveViewPitch = 0;
  let waveViewDragging = false;
  let waveViewPointerId = null;
  let waveViewLastX = 0;
  let waveViewLastY = 0;
  let visualizerFrameTime = 16.67;

  // 3D波形は「時間 × 周波数」の1枚の面として扱い、カメラだけが面の中心を回る。
  // 高さ（俯角）は固定し、手動操作では水平方向の周回だけを変更する。
  function applyWaveView(point, width, height) {
    const cx = width * 0.5;
    const cy = height * 0.56;
    const x = point.x - cx;
    const z = point.depth || 0;
    const y = point.y;
    const yaw = waveViewYaw;
    const cameraElevation = 0.62;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const horizontal = x * cosY + z * sinY;
    const depth = -x * sinY + z * cosY;
    const cosE = Math.cos(cameraElevation);
    const sinE = Math.sin(cameraElevation);
    const fitScale = Number.isFinite(point.fitScale) ? point.fitScale : 1;
    return {
      x: cx + horizontal * fitScale,
      y: cy + (-y * cosE + depth * sinE) * fitScale,
      age: point.age
    };
  }

  function resetWaveView() {
    waveViewYaw = 0;
    waveViewPitch = 0;
    requestWaveStaticFrame();
  }

  function updateVisualizerDetailUI() {
    const cfg = state.visualizerSettings || {};
    if (el.visualizerLowPerformance) el.visualizerLowPerformance.checked = !!cfg.lowPerformanceMode;
    if (el.visualizerShowFps) el.visualizerShowFps.checked = !!cfg.showFps;
    if (el.visualizerShowLoad) el.visualizerShowLoad.checked = !!cfg.showLoad;
    if (el.visualizerFps) el.visualizerFps.hidden = !cfg.showFps;
    if (el.visualizerLoad) el.visualizerLoad.hidden = !cfg.showLoad;
  }

  function saveVisualizerSettings() {
    saveState();
    updateVisualizerDetailUI();
  }

  if (el.visualizerLowPerformance) el.visualizerLowPerformance.addEventListener("change", e => {
    state.visualizerSettings.lowPerformanceMode = !!e.target.checked;
    saveVisualizerSettings();
  });
  if (el.visualizerShowFps) el.visualizerShowFps.addEventListener("change", e => {
    state.visualizerSettings.showFps = !!e.target.checked;
    saveVisualizerSettings();
  });
  if (el.visualizerShowLoad) el.visualizerShowLoad.addEventListener("change", e => {
    state.visualizerSettings.showLoad = !!e.target.checked;
    saveVisualizerSettings();
  });
  updateVisualizerDetailUI();

  function setupWaveViewGesture() {
    if (!el.wave || el.wave._viewGestureBound) return;
    el.wave._viewGestureBound = true;
    el.wave.style.touchAction = "none";
    el.wave.addEventListener("pointerdown", e => {
      if (state.waveMode !== "3d") return;
      waveViewDragging = true;
      waveViewPointerId = e.pointerId;
      waveViewLastX = e.clientX;
      waveViewLastY = e.clientY;
      try { el.wave.setPointerCapture(e.pointerId); } catch {}
    });
    el.wave.addEventListener("pointermove", e => {
      if (!waveViewDragging || e.pointerId !== waveViewPointerId) return;
      e.preventDefault();
      waveViewYaw += (e.clientX - waveViewLastX) * 0.004;
      waveViewPitch = 0;
      waveViewLastX = e.clientX;
      waveViewLastY = e.clientY;
      requestWaveStaticFrame();
    });
    const end = e => {
      if (e.pointerId !== waveViewPointerId) return;
      waveViewDragging = false;
      try { el.wave.releasePointerCapture(e.pointerId); } catch {}
    };
    el.wave.addEventListener("pointerup", end);
    el.wave.addEventListener("pointercancel", end);
  }

  setupWaveViewGesture();
  const waveResetBtn = document.getElementById("btnWaveViewReset");
  if (waveResetBtn) waveResetBtn.addEventListener("click", resetWaveView);



  function updateWaveParticleCount(value) {
    const n = Math.max(0, Math.min(1200, Math.round(Number(value) || 0)));
    state.waveParticleCount = n;
    if (!state.visualizerModeSettings) state.visualizerModeSettings = {};
    if (!state.visualizerModeSettings[state.waveMode]) state.visualizerModeSettings[state.waveMode] = {};
    state.visualizerModeSettings[state.waveMode].particleCount = n;
    if (el.waveParticleCount) el.waveParticleCount.value = n;
    if (el.waveParticleCountText) el.waveParticleCountText.textContent = String(n);
    saveState();
    requestWaveStaticFrame();
  }

  if (el.waveParticleCount) {
    el.waveParticleCount.value = state.waveParticleCount;
    el.waveParticleCount.addEventListener("input", e => updateWaveParticleCount(e.target.value));
  }
  if (el.waveParticleCountText) el.waveParticleCountText.textContent = String(state.waveParticleCount);

  // --- 描画ループ & 連続無音判定 ---
  function drawWave() {
    const pageVisible = document.visibilityState === "visible";
    const isPlaying = !audio.paused && pageVisible;
    if (!pageVisible) {
      isWaveAnimating = false;
      return;
    }

    const now = performance.now();
    if (isPlaying || waveDecayActive) {
      requestAnimationFrame(drawWave);
    } else {
      isWaveAnimating = false;
    }
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const visualizerCfg = state.visualizerSettings || {};
    const lowPerformance = !!visualizerCfg.lowPerformanceMode;
    if (lowPerformance) {
      const lastLowPerfFrame = drawWave._lastLowPerfFrame || 0;
      if (now - lastLowPerfFrame < 33) return;
      drawWave._lastLowPerfFrame = now;
    }
    if (visualizerCfg.showFps || visualizerCfg.showLoad) {
      visualizerFrameTime = visualizerFrameTime * 0.8 + Math.max(1, dt * 1000) * 0.2;
      if (visualizerCfg.showFps && el.visualizerFps) el.visualizerFps.textContent = "FPS: " + Math.max(1, Math.round(1000 / visualizerFrameTime));
      if (visualizerCfg.showLoad && el.visualizerLoad) {
        const load = Math.max(0, Math.min(100, Math.round((visualizerFrameTime / 16.67) * 100)));
        el.visualizerLoad.textContent = "描画負荷: " + (load < 45 ? "低" : load < 80 ? "中" : "高");
      }
    }

    if (!el.wave) return;
    const canvas = el.wave;
    const ctx = canvas.getContext("2d");
    const dpr = lowPerformance ? 1 : Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    if (!width || !height) return;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    updateSpatialAudio(isPlaying ? dt : 0);

    if (!analyser || !analyserData) {
      if (state.waveMode === "2d") {
        const meterW = Math.min(18, Math.max(12, width * 0.022));
        const trackTop = 18;
        const trackBottom = height - 18;
        const trackH = Math.max(1, trackBottom - trackTop);
        const drawStaticMeter = (x, label) => {
          ctx.fillStyle = "rgba(255,255,255,.08)";
          ctx.fillRect(x, trackTop, meterW, trackH);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x + meterW / 2, Math.max(11, trackTop - 5));
        };
        drawStaticMeter(0, "L");
        drawStaticMeter(width - meterW, "R");
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("L", 8, Math.max(12, height * 0.28));
        ctx.fillText("R", 8, Math.min(height - 8, height * 0.76));
      }
      return;
    }

    if (analyser && analyserData) {
      const dataLen = analyserData.length;
      if (!waveSmoothData || waveSmoothData.length !== dataLen) waveSmoothData = new Float32Array(dataLen);
      if (isPlaying) {
        analyser.getByteFrequencyData(analyserData);
      } else {
        analyserData.fill(0);
      }

      const smoothing = isPlaying ? 0.24 : 0.16;
      for (let i = 0; i < dataLen; i++) {
        const target = (analyserData[i] || 0) / 255;
        waveSmoothData[i] += (target - waveSmoothData[i]) * smoothing;
      }

      if (state.silenceSkip && isPlaying) {
        let sum = 0;
        for (let i = 0; i < analyserData.length; i++) sum += analyserData[i];
        const avg = sum / analyserData.length;
        const cur = audio.currentTime, dur = audio.duration;
        if (avg < 2 && cur > 2 && dur - cur > 3) {
          silenceTimer += dt;
          if (silenceTimer >= 2.0) {
            audio.currentTime += 0.5;
            silenceTimer = 0;
          }
        } else {
          silenceTimer = 0;
        }
      } else if (isPlaying) {
        silenceTimer = 0;
      }

      // 波形表示:
      // 2d = 現在のスペクトラム表示
      // a1  = 時間波形（中央基準）
      // a2  = L/Rを上下に分けた時間波形
      // a3  = 中央から左右へ広がる対称スペクトラム
      // a4  = 各帯域の変化量を強調するスペクトラム
      // 3d  = 現在の3Dスペクトラム表示
      // a5  = 音の空間
      // a6  = 音域連動背景
      // a7  = 粒子ビジュアライザー
      // a8  = 曲変更トランジション
      if (state.waveMode === "2d") {
        const meterW = Math.min(18, Math.max(12, width * 0.022));
        const meterGap = 8;
        const waveLeft = meterW + meterGap;
        const waveRight = width - meterW - meterGap;
        const waveWidth = Math.max(1, waveRight - waveLeft);
        const bars = Math.min(72, dataLen);
        const step = dataLen / bars;
        const barGap = 2;
        const barWidth = Math.max(1, waveWidth / bars - barGap);
        for (let i = 0; i < bars; i++) {
          const begin = Math.floor(i * step);
          const finish = Math.max(begin + 1, Math.floor((i + 1) * step));
          let level = 0;
          for (let j = begin; j < finish && j < dataLen; j++) level = Math.max(level, waveSmoothData[j]);
          const x = waveLeft + i * (waveWidth / bars);
          const barHeight = Math.max(1, height * level);
          const y = height - barHeight;
          const hue = (i / Math.max(1, bars - 1)) * 280 + 120;
          ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.8)`;
          ctx.fillRect(x, y, barWidth, barHeight);
          ctx.fillStyle = `hsla(${hue}, 100%, 75%, 0.25)`;
          ctx.fillRect(x, Math.max(0, y - 4), barWidth, 3);
        }
        const calcRms = (data) => {
          if (!data || !data.length) return 0;
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const sample = (data[i] - 128) / 128;
            sum += sample * sample;
          }
          // フルスケール正弦波でも常時MAXになりにくい表示スケール。
          return Math.min(1, Math.sqrt(sum / data.length) * 1.25);
        };
        let leftTarget = 0, rightTarget = 0;
        if (isPlaying && leftLevelAnalyser && rightLevelAnalyser && leftLevelData && rightLevelData) {
          leftLevelAnalyser.getByteTimeDomainData(leftLevelData);
          rightLevelAnalyser.getByteTimeDomainData(rightLevelData);
          leftTarget = calcRms(leftLevelData);
          rightTarget = calcRms(rightLevelData);
        }
        const meterSmoothing = isPlaying ? 0.105 : 1;
        leftDisplayLevel += (leftTarget - leftDisplayLevel) * meterSmoothing;
        rightDisplayLevel += (rightTarget - rightDisplayLevel) * meterSmoothing;

        const drawLevelMeter = (x, level, label) => {
          const trackTop = 18;
          const trackBottom = height - 18;
          const trackH = Math.max(1, trackBottom - trackTop);
          const fillH = trackH * Math.min(1, Math.max(0, level));
          const meterGradient = ctx.createLinearGradient(0, trackBottom, 0, trackTop);
          meterGradient.addColorStop(0, "#1DB954");
          meterGradient.addColorStop(0.58, "#d7df28");
          meterGradient.addColorStop(1, "#ff3b30");
          ctx.fillStyle = "rgba(255,255,255,.08)";
          ctx.fillRect(x, trackTop, meterW, trackH);
          ctx.fillStyle = meterGradient;
          ctx.fillRect(x, trackBottom - fillH, meterW, fillH);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x + meterW / 2, Math.max(11, trackTop - 5));
        };
        drawLevelMeter(0, leftDisplayLevel, "L");
        drawLevelMeter(width - meterW, rightDisplayLevel, "R");
      } else if (state.waveMode === "a1") {

        if (analyser && waveTimeData) {
          if (!waveTimeTargetData || waveTimeTargetData.length !== waveTimeData.length) {
            waveTimeTargetData = new Uint8Array(waveTimeData.length);
            waveTimeTargetData.fill(128);
          }
          if (isPlaying) {
            analyser.getByteTimeDomainData(waveTimeTargetData);
            for (let i = 0; i < waveTimeData.length; i++) {
              waveTimeData[i] += (waveTimeTargetData[i] - waveTimeData[i]) * 0.18;
            }
          } else {
            for (let i = 0; i < waveTimeData.length; i++) {
              waveTimeData[i] += (128 - waveTimeData[i]) * WAVE_TIME_SMOOTHING;
            }
          }

          const centerY = height * 0.5;
          const amplitudeScale = height * 0.40;
          const visualGain = 1.75;

          // 薄い目盛りで振幅の位置を把握しやすくする。
          ctx.save();
          ctx.strokeStyle = "rgba(150,190,210,0.075)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 1; i < 4; i++) {
            const y = (height / 4) * i;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
          }
          for (let i = 1; i < 12; i++) {
            const x = (width / 12) * i;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
          }
          ctx.stroke();

          // 波形の内側を淡く塗り、輪郭と振幅を見分けやすくする。
          const waveFill = ctx.createLinearGradient(0, centerY - amplitudeScale, 0, centerY + amplitudeScale);
          waveFill.addColorStop(0, "rgba(80,220,255,0.22)");
          waveFill.addColorStop(0.5, "rgba(70,170,220,0.035)");
          waveFill.addColorStop(1, "rgba(120,120,255,0.18)");
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          for (let i = 0; i < waveTimeData.length; i++) {
            const x = (i / Math.max(1, waveTimeData.length - 1)) * width;
            const sample = (waveTimeData[i] - 128) / 128;
            const value = Math.max(-1, Math.min(1, sample * visualGain));
            ctx.lineTo(x, centerY - value * amplitudeScale);
          }
          ctx.lineTo(width, centerY);
          ctx.closePath();
          ctx.fillStyle = waveFill;
          ctx.fill();

          // 外側の光と芯の線を重ねて、細い画面でも輪郭を残す。
          ctx.beginPath();
          for (let i = 0; i < waveTimeData.length; i++) {
            const x = (i / Math.max(1, waveTimeData.length - 1)) * width;
            const sample = (waveTimeData[i] - 128) / 128;
            const value = Math.max(-1, Math.min(1, sample * visualGain));
            const y = centerY - value * amplitudeScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.strokeStyle = "rgba(75,205,255,0.32)";
          ctx.lineWidth = 5;
          ctx.shadowBlur = lowPerformance ? 0 : 9;
          ctx.shadowColor = "rgba(70,190,255,0.42)";
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(205,250,255,0.96)";
          ctx.lineWidth = 1.7;
          ctx.stroke();

          ctx.strokeStyle = "rgba(255,255,255,0.22)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
          ctx.restore();
        }
      } else if (state.waveMode === "a2") {

        const bars = Math.min(56, dataLen, waveLeftOutputAnalyser?.frequencyBinCount || 56);
        const gap = Math.max(2, Math.min(4, width / Math.max(1, bars) * 0.16));
        const waveLeft = width * 0.035;
        const waveWidth = width * 0.93;
        const barWidth = Math.max(1, waveWidth / Math.max(1, bars) - gap);
        const baseY = height * 0.88;
        const maxBarHeight = height * 0.68;

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          if (!waveLeftOutputAnalyser._a2Smooth || waveLeftOutputAnalyser._a2Smooth.length !== bars) {
            waveLeftOutputAnalyser._a2Smooth = new Float32Array(bars);
            drawWave._a2Peaks = new Float32Array(bars);
          }
          const smooth = waveLeftOutputAnalyser._a2Smooth;
          const peaks = drawWave._a2Peaks || (drawWave._a2Peaks = new Float32Array(bars));

          for (let i = 0; i < bars; i++) {
            const startBin = Math.floor(Math.pow(i / bars, 1.38) * waveLeftOutputData.length);
            const endBin = Math.min(
              waveLeftOutputData.length,
              Math.max(startBin + 1, Math.floor(Math.pow((i + 1) / bars, 1.38) * waveLeftOutputData.length))
            );
            let level = 0;
            for (let k = startBin; k < endBin; k++) {
              const left = (waveLeftOutputData[k] || 0) / 255;
              const right = (waveRightOutputData[k] || 0) / 255;
              level = Math.max(level, (left + right) * 0.5);
            }

            const target = isPlaying ? Math.min(1, level * 1.75) : 0;
            smooth[i] += (target - smooth[i]) * (isPlaying ? 0.24 : 0.13);
            peaks[i] = Math.max(smooth[i], (peaks[i] || 0) - dt * 0.48);

            const barHeight = Math.max(1.5, smooth[i] * maxBarHeight);
            const x = waveLeft + i * (waveWidth / bars);
            const hue = 178 + (i / Math.max(1, bars - 1)) * 112;
            const gradient = ctx.createLinearGradient(0, baseY - barHeight, 0, baseY);
            gradient.addColorStop(0, "hsla(" + hue + ",95%,76%,0.98)");
            gradient.addColorStop(0.48, "hsla(" + hue + ",88%,57%,0.88)");
            gradient.addColorStop(1, "hsla(" + (hue + 20) + ",82%,38%,0.72)");

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, baseY - barHeight, barWidth, barHeight, Math.min(5, barWidth * 0.45));
            ctx.fill();

            const peakY = baseY - peaks[i] * maxBarHeight;
            ctx.fillStyle = "rgba(225,250,255,0.72)";
            ctx.fillRect(x, peakY - 1, barWidth, 1.5);
          }
        }

        // 底辺と控えめな目盛りを追加。
        ctx.save();
        ctx.strokeStyle = "rgba(180,220,235,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(waveLeft, baseY);
        ctx.lineTo(waveLeft + waveWidth, baseY);
        for (let i = 1; i < 5; i++) {
          const x = waveLeft + (waveWidth / 5) * i;
          ctx.moveTo(x, baseY + 3);
          ctx.lineTo(x, baseY + 8);
        }
        ctx.stroke();
        ctx.fillStyle = "rgba(220,240,250,0.72)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("L / R", waveLeft, Math.max(12, baseY - maxBarHeight - 7));
        ctx.restore();
      } else if (state.waveMode === "a3") {

        // 左右チャンネルを中央線の上下へ分け、周波数帯ごとの違いを表示する。
        const bars = Math.min(36, waveLeftOutputAnalyser?.frequencyBinCount || 36);
        const centerY = height * 0.5;
        const sideWidth = width * 0.92;
        const leftX = width * 0.04;
        const gap = Math.max(1.5, sideWidth / bars * 0.12);
        const barWidth = Math.max(1, sideWidth / bars - gap);
        const maxBarHeight = height * 0.34;

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          if (!waveLeftOutputAnalyser._a3Smooth || waveLeftOutputAnalyser._a3Smooth.length !== bars) {
            waveLeftOutputAnalyser._a3Smooth = new Float32Array(bars);
            waveRightOutputAnalyser._a3Smooth = new Float32Array(bars);
          }
          const leftSmooth = waveLeftOutputAnalyser._a3Smooth;
          const rightSmooth = waveRightOutputAnalyser._a3Smooth;

          for (let i = 0; i < bars; i++) {
            const startBin = Math.floor(Math.pow(i / bars, 1.35) * waveLeftOutputData.length);
            const endBin = Math.min(
              waveLeftOutputData.length,
              Math.max(startBin + 1, Math.floor(Math.pow((i + 1) / bars, 1.35) * waveLeftOutputData.length))
            );
            let leftLevel = 0;
            let rightLevel = 0;
            for (let k = startBin; k < endBin; k++) {
              leftLevel = Math.max(leftLevel, (waveLeftOutputData[k] || 0) / 255);
              rightLevel = Math.max(rightLevel, (waveRightOutputData[k] || 0) / 255);
            }

            const smoothing = isPlaying ? 0.25 : 0.14;
            const leftTarget = isPlaying ? Math.min(1, leftLevel * 1.55) : 0;
            const rightTarget = isPlaying ? Math.min(1, rightLevel * 1.55) : 0;
            leftSmooth[i] += (leftTarget - leftSmooth[i]) * smoothing;
            rightSmooth[i] += (rightTarget - rightSmooth[i]) * smoothing;

            const x = leftX + i * (sideWidth / bars);
            const leftHeight = Math.max(1, leftSmooth[i] * maxBarHeight);
            const rightHeight = Math.max(1, rightSmooth[i] * maxBarHeight);

            const leftGradient = ctx.createLinearGradient(0, centerY - leftHeight, 0, centerY);
            leftGradient.addColorStop(0, "rgba(105,235,255,0.96)");
            leftGradient.addColorStop(1, "rgba(40,150,220,0.55)");
            ctx.fillStyle = leftGradient;
            ctx.beginPath();
            ctx.roundRect(x, centerY - leftHeight, barWidth, leftHeight, Math.min(4, barWidth * 0.4));
            ctx.fill();

            const rightGradient = ctx.createLinearGradient(0, centerY, 0, centerY + rightHeight);
            rightGradient.addColorStop(0, "rgba(180,145,255,0.78)");
            rightGradient.addColorStop(1, "rgba(105,105,245,0.96)");
            ctx.fillStyle = rightGradient;
            ctx.beginPath();
            ctx.roundRect(x, centerY, barWidth, rightHeight, Math.min(4, barWidth * 0.4));
            ctx.fill();
          }
        }

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.23)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        for (let i = 1; i < 5; i++) {
          const x = (width / 5) * i;
          ctx.moveTo(x, centerY - 3);
          ctx.lineTo(x, centerY + 3);
        }
        ctx.stroke();
        ctx.restore();
      } else if (state.waveMode === "a4") {

        const bars = Math.min(72, dataLen);
        const step = dataLen / bars;
        const waveLeft = width * 0.045;
        const waveWidth = width * 0.91;
        const gap = Math.max(1.5, Math.min(3, waveWidth / bars * 0.14));
        const barWidth = Math.max(1, waveWidth / bars - gap);
        const baseY = height * 0.90;
        const maxBarHeight = height * 0.76;

        if (!waveBandBaseline || waveBandBaseline.length !== bars) {
          waveBandBaseline = new Float32Array(bars);
        }
        if (!drawWave._a4Peaks || drawWave._a4Peaks.length !== bars) {
          drawWave._a4Peaks = new Float32Array(bars);
        }

        for (let i = 0; i < bars; i++) {
          const begin = Math.floor(i * step);
          const finish = Math.max(begin + 1, Math.floor((i + 1) * step));
          let level = 0;
          for (let j = begin; j < finish && j < dataLen; j++) {
            level = Math.max(level, waveSmoothData[j] || 0);
          }

          const previous = waveBandBaseline[i];
          waveBandBaseline[i] += (level - waveBandBaseline[i]) * (isPlaying ? 0.022 : 0.09);
          const change = Math.abs(level - previous);
          const target = Math.min(1, Math.sqrt(change) * 3.0);
          const displayLevel = drawWave._a4Peaks[i] =
            Math.max(target, (drawWave._a4Peaks[i] || 0) - dt * 0.72);

          const barHeight = Math.max(1.5, displayLevel * maxBarHeight);
          const x = waveLeft + i * (waveWidth / bars);
          const hue = 185 + (i / Math.max(1, bars - 1)) * 100;
          const gradient = ctx.createLinearGradient(0, baseY - barHeight, 0, baseY);
          gradient.addColorStop(0, "hsla(" + hue + ",100%,78%,0.95)");
          gradient.addColorStop(1, "hsla(" + (hue + 18) + ",85%,43%,0.72)");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, baseY - barHeight, barWidth, barHeight, Math.min(4, barWidth * 0.45));
          ctx.fill();
        }

        // 変化の基準線と、弱い音でも見失いにくい下地。
        ctx.save();
        ctx.fillStyle = "rgba(100,190,220,0.07)";
        ctx.fillRect(waveLeft, baseY, waveWidth, 2);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(waveLeft, baseY);
        ctx.lineTo(waveLeft + waveWidth, baseY);
        ctx.stroke();
        ctx.restore();
      } else if (state.waveMode === "a5") {

        // 左右の出力レベルをまとめ、直近の音量変化を連続したラインとして流す。
        const pointCount = Math.max(96, Math.min(200, Math.floor(width / 4)));
        const centerY = height * 0.76;
        const amplitudeScale = height * 0.58;

        if (!drawWave._waveA5History || drawWave._waveA5History.length !== pointCount) {
          drawWave._waveA5History = new Float32Array(pointCount);
        }
        const history = drawWave._waveA5History;

        let level = 0;
        if (isPlaying && leftLevelAnalyser && rightLevelAnalyser && leftLevelData && rightLevelData) {
          leftLevelAnalyser.getByteTimeDomainData(leftLevelData);
          rightLevelAnalyser.getByteTimeDomainData(rightLevelData);
          let leftSum = 0;
          let rightSum = 0;
          for (let i = 0; i < leftLevelData.length; i++) {
            const sample = (leftLevelData[i] - 128) / 128;
            leftSum += sample * sample;
          }
          for (let i = 0; i < rightLevelData.length; i++) {
            const sample = (rightLevelData[i] - 128) / 128;
            rightSum += sample * sample;
          }
          const leftRms = Math.sqrt(leftSum / Math.max(1, leftLevelData.length));
          const rightRms = Math.sqrt(rightSum / Math.max(1, rightLevelData.length));
          level = Math.min(1, ((leftRms + rightRms) * 0.5) * 2.35);
        }

        history.copyWithin(0, 1);
        const incoming = isPlaying ? Math.min(1, level) : 0;
        history[history.length - 1] += (incoming - history[history.length - 1]) * (isPlaying ? 0.34 : 0.16);

        // 目盛りと下側の薄い面で、音量の推移を読み取りやすくする。
        ctx.save();
        ctx.strokeStyle = "rgba(150,200,220,0.075)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 5; i++) {
          const y = (height / 5) * i;
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
        }
        ctx.stroke();

        const area = ctx.createLinearGradient(0, centerY - amplitudeScale, 0, centerY);
        area.addColorStop(0, "rgba(80,220,255,0.28)");
        area.addColorStop(1, "rgba(80,150,240,0.015)");
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i < history.length; i++) {
          const x = (i / Math.max(1, history.length - 1)) * width;
          const y = centerY - history[i] * amplitudeScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, centerY);
        ctx.closePath();
        ctx.fillStyle = area;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = (i / Math.max(1, history.length - 1)) * width;
          const y = centerY - history[i] * amplitudeScale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(110,225,255,0.28)";
        ctx.lineWidth = 5;
        ctx.shadowBlur = lowPerformance ? 0 : 10;
        ctx.shadowColor = "rgba(65,190,255,0.4)";
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(215,250,255,0.95)";
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.strokeStyle = "rgba(255,255,255,0.17)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        ctx.fillStyle = "rgba(220,245,255,0.75)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("音量", 8, Math.max(12, centerY - amplitudeScale - 7));
        ctx.restore();
      } else if (state.waveMode === "a6") {

        // 低・中・高域をそれぞれ異なる軌道へ割り当て、音の質感を立体的なリングで表現。
        const bandEnergy = (from, to) => {
          let sum = 0;
          let count = 0;
          const start = Math.floor(dataLen * from);
          const end = Math.max(start + 1, Math.floor(dataLen * to));
          for (let i = start; i < end && i < dataLen; i++) {
            sum += waveSmoothData[i] || 0;
            count++;
          }
          return count ? sum / count : 0;
        };
        const enhance = value => Math.min(1, Math.pow(Math.max(0, value), 0.64) * 1.12);
        const low = enhance(bandEnergy(0.01, 0.10));
        const mid = enhance(bandEnergy(0.10, 0.42));
        const high = enhance(bandEnergy(0.42, 0.92));
        const total = Math.min(1, low * 1.55 + mid * 1.28 + high);
        const cx = width * 0.5;
        const cy = height * 0.51;
        const baseRadius = Math.min(width, height) * 0.115;

        const background = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.7);
        background.addColorStop(0, "hsla(190,90%,55%," + (0.045 + total * 0.10) + ")");
        background.addColorStop(0.55, "hsla(245,80%,55%," + (0.025 + mid * 0.07) + ")");
        background.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, width, height);

        const rings = [
          { energy: low, hue: 34, radius: baseRadius * (1.25 + low * 2.7), wobble: height * 0.095, speed: 0.72, tilt: 0.34 },
          { energy: mid, hue: 184, radius: baseRadius * (2.05 + mid * 2.8), wobble: height * 0.082, speed: -0.48, tilt: -0.24 },
          { energy: high, hue: 278, radius: baseRadius * (2.8 + high * 2.45), wobble: height * 0.07, speed: 0.88, tilt: 0.17 }
        ];
        const points = lowPerformance ? 56 : 112;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        rings.forEach((ring, ringIndex) => {
          const phase = now * 0.001 * ring.speed;
          const pulse = 0.5 + 0.5 * Math.sin(now * (0.0011 + ringIndex * 0.00035) + ringIndex * 1.6);
          const strength = Math.min(1, ring.energy * 1.5);
          ctx.beginPath();
          for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            const detail = Math.sin(angle * (3 + ringIndex) + phase * 2.1) * ring.wobble * (0.25 + ring.energy * 1.45);
            const bassPulse = ring.energy * Math.sin(angle * 2 - phase) * Math.min(width, height) * 0.035;
            const rx = ring.radius + detail + bassPulse;
            const ry = ring.radius * (0.48 + ring.energy * 0.20) + detail * 0.42;
            const x = cx + Math.cos(angle + phase) * rx;
            const y = cy + Math.sin(angle + phase * 0.68) * ry + Math.sin(angle * 2 + phase) * ring.tilt * ring.energy * 12;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.strokeStyle = "hsla(" + ring.hue + ",92%,72%," + (0.24 + strength * 0.42 + pulse * 0.12) + ")";
          ctx.lineWidth = 1.1 + strength * 2.0;
          ctx.shadowBlur = lowPerformance ? 0 : 8 + strength * 10;
          ctx.shadowColor = "hsla(" + ring.hue + ",95%,65%,0.48)";
          ctx.stroke();
          ctx.shadowBlur = 0;
        });

        const coreRadius = baseRadius * (0.55 + total * 1.5);
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
        core.addColorStop(0, "rgba(220,250,255," + (0.20 + total * 0.30) + ")");
        core.addColorStop(0.55, "hsla(195,95%,66%," + (0.10 + total * 0.18) + ")");
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        const dots = lowPerformance ? 8 : 16;
        for (let i = 0; i < dots; i++) {
          const angle = (i / dots) * Math.PI * 2 + now * 0.00038 * (i % 2 ? -1 : 1);
          const orbit = baseRadius * (3.4 + low * 2.2 + high * 0.8);
          const ripple = Math.sin(angle * 3 + now * 0.0018) * high * 10;
          const x = cx + Math.cos(angle) * (orbit + ripple);
          const y = cy + Math.sin(angle) * (orbit * 0.52 + ripple * 0.32);
          const size = 0.9 + high * 1.9 + mid * 1.1;
          ctx.fillStyle = "hsla(" + (190 + i * 8) + ",95%,76%," + (0.25 + total * 0.48) + ")";
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (state.waveMode === "a7") {

        // 水面を横切る波紋を重ね、低音・中音・高音で揺れ方を変える。
        const bandEnergy = (from, to) => {
          let sum = 0;
          let count = 0;
          const start = Math.floor(dataLen * from);
          const end = Math.max(start + 1, Math.floor(dataLen * to));
          for (let i = start; i < end && i < dataLen; i++) {
            sum += waveSmoothData[i] || 0;
            count++;
          }
          return count ? sum / count : 0;
        };
        const low = bandEnergy(0.01, 0.10);
        const mid = bandEnergy(0.10, 0.42);
        const high = bandEnergy(0.42, 0.92);
        const total = Math.min(1, low * 1.55 + mid * 1.15 + high * 0.9);

        if (isPlaying) {
          drawWave._wave7Flow = (drawWave._wave7Flow || 0) + dt * (26 + total * 44);
        }
        const flow = drawWave._wave7Flow || 0;
        const surface = ctx.createLinearGradient(0, 0, width, height);
        surface.addColorStop(0, "rgba(5,20,32,0.28)");
        surface.addColorStop(0.48, "rgba(8,36,48,0.18)");
        surface.addColorStop(1, "rgba(18,15,42,0.30)");
        ctx.fillStyle = surface;
        ctx.fillRect(0, 0, width, height);

        const rows = lowPerformance ? 12 : Math.max(18, Math.min(28, Math.floor(height / 16)));
        const points = lowPerformance ? 40 : 76;
        const spacing = height / rows;
        for (let row = -1; row <= rows + 1; row++) {
          const yBase = ((row * spacing + flow) % (height + spacing * 2)) - spacing;
          const amplitude = height * (0.006 + total * 0.047);
          const frequency = 1.25 + low * 2.1 + high * 1.5;
          const phase = row * 0.64 + flow * 0.014;
          ctx.beginPath();
          for (let p = 0; p <= points; p++) {
            const nx = p / points;
            const x = nx * width;
            const wave =
              Math.sin(nx * Math.PI * 2 * frequency + phase) * amplitude +
              Math.sin(nx * Math.PI * 2 * (frequency * 2.15) - phase * 0.72) * amplitude * (0.18 + high * 0.25);
            const y = yBase + wave;
            if (p === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          const alpha = 0.075 + total * 0.27;
          ctx.strokeStyle = "hsla(" + (185 + high * 48) + ",85%," + (55 + mid * 15) + "%," + alpha + ")";
          ctx.lineWidth = 0.7 + total * 1.25;
          ctx.stroke();
        }

        // 音量に合わせて中央から広がる円形の波紋。
        const rippleCount = lowPerformance ? 2 : 4;
        for (let i = 0; i < rippleCount; i++) {
          const radius = (Math.min(width, height) * (0.12 + i * 0.10) + (flow * (0.22 + i * 0.04)) % (Math.min(width, height) * 0.14));
          ctx.beginPath();
          ctx.ellipse(width * 0.5, height * 0.5, radius * (1.25 + mid * 0.18), radius * (0.42 + low * 0.18), 0, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(115,215,235," + (0.06 + total * 0.14) + ")";
          ctx.lineWidth = 1 + total * 0.8;
          ctx.stroke();
        }
      } else if (state.waveMode === "a8") {

        // L/Rそれぞれの音量履歴を、現在から過去へ流れる2本のトレースとして表示。
        if (!drawWave._wave8History) {
          drawWave._wave8History = [];
          drawWave._wave8SampleElapsed = 0;
          drawWave._wave8LastTime = -1;
        }
        const history = drawWave._wave8History;
        const sampleInterval = 0.025;
        drawWave._wave8SampleElapsed = (drawWave._wave8SampleElapsed || 0) + dt;

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && isPlaying) {
          if (!waveLeftOutputAnalyser._wave8TimeData) {
            waveLeftOutputAnalyser._wave8TimeData = new Uint8Array(waveLeftOutputAnalyser.fftSize);
            waveRightOutputAnalyser._wave8TimeData = new Uint8Array(waveRightOutputAnalyser.fftSize);
          }
          waveLeftOutputAnalyser.getByteTimeDomainData(waveLeftOutputAnalyser._wave8TimeData);
          waveRightOutputAnalyser.getByteTimeDomainData(waveRightOutputAnalyser._wave8TimeData);

          if (drawWave._wave8SampleElapsed >= sampleInterval) {
            drawWave._wave8SampleElapsed %= sampleInterval;
            const rms = data => {
              let sum = 0;
              for (let i = 0; i < data.length; i++) {
                const value = (data[i] - 128) / 128;
                sum += value * value;
              }
              return Math.min(1, Math.sqrt(sum / Math.max(1, data.length)) * 2.4);
            };
            history.unshift({
              left: rms(waveLeftOutputAnalyser._wave8TimeData),
              right: rms(waveRightOutputAnalyser._wave8TimeData)
            });
            const maxHistory = Math.max(80, Math.ceil(4.5 / sampleInterval));
            if (history.length > maxHistory) history.length = maxHistory;
          }
        } else {
          drawWave._wave8SampleElapsed = 0;
        }

        const count = history.length;
        const topBase = height * 0.27;
        const bottomBase = height * 0.75;
        const amplitude = height * 0.19;

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.09)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 5; i++) {
          const x = (width / 5) * i;
          ctx.moveTo(x, 8);
          ctx.lineTo(x, height - 8);
        }
        ctx.moveTo(0, topBase);
        ctx.lineTo(width, topBase);
        ctx.moveTo(0, bottomBase);
        ctx.lineTo(width, bottomBase);
        ctx.stroke();

        const drawTrace = (key, baseY, direction, color, fillColor) => {
          if (count < 2) return;
          const area = ctx.createLinearGradient(0, baseY - amplitude, 0, baseY + amplitude);
          area.addColorStop(0, fillColor);
          area.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.moveTo(0, baseY);
          for (let i = 0; i < count; i++) {
            const age = i / Math.max(1, count - 1);
            const x = age * width;
            const level = history[i][key] || 0;
            const y = baseY + direction * level * amplitude;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(width, baseY);
          ctx.closePath();
          ctx.fillStyle = area;
          ctx.fill();

          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const age = i / Math.max(1, count - 1);
            const x = age * width;
            const level = history[i][key] || 0;
            const y = baseY + direction * level * amplitude;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.shadowBlur = lowPerformance ? 0 : 8;
          ctx.shadowColor = color;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(240,250,255,0.88)";
          ctx.lineWidth = 1.25;
          ctx.stroke();
        };

        drawTrace("right", topBase, -1, "rgba(255,145,170,0.9)", "rgba(255,110,150,0.22)");
        drawTrace("left", bottomBase, 1, "rgba(90,205,255,0.92)", "rgba(70,170,255,0.20)");

        ctx.fillStyle = "rgba(240,248,255,0.76)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("R", 8, Math.max(12, topBase - amplitude - 7));
        ctx.fillText("L", 8, Math.min(height - 6, bottomBase + amplitude + 14));
        ctx.textAlign = "right";
        ctx.fillText("現在", Math.min(width - 8, width * 0.04 + 32), height - 8);
        ctx.fillText("過去", width - 8, height - 8);
        ctx.restore();
      } else {
        // 3D波形：時間を奥行きではなく固定された横方向へ流し、音量だけを高さとして持ち上げる。
        // 「現在 → 過去」の時間方向は常に左から右。カメラの動きや音量で時間軸そのものは変化しない。
        const SAMPLE_INTERVAL = 0.04;
        const HISTORY_SECONDS = 6.0;
        const BANDS_3D = 64;

        if (!drawWave._wave3DHistory || drawWave._wave3DMode !== state.waveMode) {
          drawWave._wave3DHistory = [];
          drawWave._wave3DSampleElapsed = 0;
          drawWave._wave3DLastAudioTime = -1;
          drawWave._wave3DLastSampleTime = -1;
          drawWave._wave3DPauseFade = 1;
          drawWave._wave3DTrackKey = null;
          drawWave._wave3DMode = state.waveMode;
        }

        if (isPlaying && analyserData?.length) {
          const audioTime = Number(audio.currentTime) || 0;
          const trackKey = state.currentSong?.name || audio.src || "";
          const previousTrackKey = drawWave._wave3DTrackKey;
          const trackChanged = previousTrackKey !== null && previousTrackKey !== trackKey;
          drawWave._wave3DTrackKey = trackKey;

          if (trackChanged) {
            // 曲変更では履歴を消さず、そのまま次の波形を後ろへつなぐ。
            drawWave._wave3DSampleElapsed = 0;
            drawWave._wave3DLastAudioTime = audioTime;
            drawWave._wave3DLastSampleTime = -1;
          } else if (
            drawWave._wave3DLastAudioTime >= 0 &&
            (audioTime < drawWave._wave3DLastAudioTime ||
             Math.abs(audioTime - drawWave._wave3DLastAudioTime) > 0.4)
          ) {
            // 同じ曲のシークなど、時間が不連続になった場合だけ履歴をリセットする。
            drawWave._wave3DHistory = [];
            drawWave._wave3DSampleElapsed = 0;
            drawWave._wave3DLastSampleTime = -1;
          }

          if (
            drawWave._wave3DLastSampleTime < 0 ||
            audioTime - drawWave._wave3DLastSampleTime >= SAMPLE_INTERVAL
          ) {
            const bands = new Float32Array(BANDS_3D);
            const maxBin = analyserData.length - 1;

            for (let b = 0; b < BANDS_3D; b++) {
              const lo = Math.floor(Math.pow(b / BANDS_3D, 1.42) * maxBin);
              const hi = Math.max(
                lo + 1,
                Math.floor(Math.pow((b + 1) / BANDS_3D, 1.42) * maxBin)
              );

              let sum = 0;
              let count = 0;
              for (let k = lo; k <= hi && k <= maxBin; k++) {
                const value = (analyserData[k] || 0) / 255;
                sum += value * value;
                count++;
              }

              bands[b] = count
                ? Math.min(1, Math.sqrt(sum / count) * 2.15)
                : 0;
            }

            drawWave._wave3DHistory.unshift({ time: audioTime, bands });
            drawWave._wave3DLastSampleTime = audioTime;

            while (
              drawWave._wave3DHistory.length > 1 &&
              audioTime - drawWave._wave3DHistory[drawWave._wave3DHistory.length - 1].time > HISTORY_SECONDS
            ) {
              drawWave._wave3DHistory.pop();
            }
            if (drawWave._wave3DHistory.length > 256) {
              drawWave._wave3DHistory.length = 256;
            }
          }

          drawWave._wave3DLastAudioTime = audioTime;
        } else {
          drawWave._wave3DSampleElapsed = 0;
          drawWave._wave3DLastSampleTime = -1;
        }

        const currentAudioTime = Number(audio.currentTime) || 0;
        const hasHistory = drawWave._wave3DHistory.length > 0;
        const pauseFade = isPlaying
          ? 1
          : hasHistory
            ? Math.max(0, (drawWave._wave3DPauseFade ?? 1) - dt * 1.8)
            : 1;

        if (!isPlaying && hasHistory) drawWave._wave3DPauseFade = pauseFade;

        // 再生していないときも3D表示そのものは残す。
        // 実音声を解析できない状態では、中央に緩やかな基準波形を表示する。
        const staticBands = (() => {
          const bands = new Float32Array(BANDS_3D);
          for (let b = 0; b < BANDS_3D; b++) {
            const x = b / Math.max(1, BANDS_3D - 1);
            bands[b] = 0.055
              + 0.025 * Math.sin(x * Math.PI * 2.4)
              + 0.018 * Math.sin(x * Math.PI * 5.8 + 0.7);
          }
          return bands;
        })();

        // 現在の解析値を補間して、先頭だけが段差状にならないようにする。
        const liveBands = isPlaying && waveSmoothData?.length
          ? (() => {
              const bands = new Float32Array(BANDS_3D);
              const maxBin = waveSmoothData.length - 1;
              for (let b = 0; b < BANDS_3D; b++) {
                const lo = Math.floor(Math.pow(b / BANDS_3D, 1.42) * maxBin);
                const hi = Math.max(
                  lo + 1,
                  Math.floor(Math.pow((b + 1) / BANDS_3D, 1.42) * maxBin)
                );
                let level = 0;
                for (let k = lo; k <= hi && k <= maxBin; k++) {
                  level = Math.max(level, waveSmoothData[k] || 0);
                }
                bands[b] = Math.min(1, level * 2.15);
              }
              return bands;
            })()
          : null;

        const rows = hasHistory
          ? drawWave._wave3DHistory
          : [{ time: currentAudioTime, bands: staticBands }];
        const displayBands = liveBands || staticBands;

        const timeLeft = width * 0.06;
        const timeRight = width * 0.94;
        const baseY = height * 0.82;
        const maxHeight = height * 0.66;
        const freqDepth = width * 0.48;
        const floorDepth = height * 0.18;

        // 視点操作そのものは変更せず、投影後の全体だけを画面内へ収める。
        // ワイド画面では奥行きの回転による横/縦方向の広がりが大きくなるため、
        // 理論上の最大範囲から縮小率を決め、波の山を描画時に上限クリップしない。
        const cameraElevation = 0.62;
        const halfTimeSpan = (timeRight - timeLeft) * 0.5;
        const halfFreqDepth = freqDepth * 0.5;
        const horizontalExtent = Math.hypot(halfTimeSpan, halfFreqDepth);
        const verticalExtent = maxHeight * Math.cos(cameraElevation) + halfFreqDepth * Math.sin(cameraElevation);
        const waveFitScale = Math.min(
          1,
          (width * 0.46) / Math.max(1, horizontalExtent),
          (height * 0.44) / Math.max(1, verticalExtent)
        );

        // 奥行き方向の床グリッド。波形そのものとは独立した固定の基準面。
        const project3DPoint = (age, freqRatio, amplitude) => {
          const timeX = timeLeft + age * (timeRight - timeLeft);
          const depth = (freqRatio - 0.5) * freqDepth;
          const heightValue = Math.max(0, Math.min(1, amplitude)) * maxHeight;

          return applyWaveView({
            x: timeX,
            y: heightValue,
            depth,
            age,
            fitScale: waveFitScale
          }, width, height);
        };

        if (rows.length) {
          // 床の奥行きを先に描画して、メッシュが空間内に浮いているように見せる。
          ctx.save();
          ctx.globalAlpha = 0.34 * pauseFade;
          ctx.lineWidth = 1;

          for (let g = 0; g <= 8; g++) {
            const ratio = g / 8;
            const p1 = project3DPoint(0, ratio, 0);
            const p2 = project3DPoint(1, ratio, 0);
            ctx.strokeStyle = g === 4
              ? "rgba(255,255,255,0.16)"
              : "rgba(255,255,255,0.055)";
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y + floorDepth);
            ctx.lineTo(p2.x, p2.y + floorDepth);
            ctx.stroke();
          }

          for (let t = 0; t <= 10; t++) {
            const age = t / 10;
            const p1 = project3DPoint(age, 0, 0);
            const p2 = project3DPoint(age, 1, 0);
            ctx.strokeStyle = t === 0
              ? "rgba(255,255,255,0.18)"
              : "rgba(255,255,255,0.045)";
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y + floorDepth);
            ctx.lineTo(p2.x, p2.y + floorDepth);
            ctx.stroke();
          }

          ctx.restore();

          // 各時間断面を面として塗り、線だけでは出ない立体感を作る。
          // 現在に近いほど明るく、過去へ行くほど透明になる。
          ctx.save();
          for (let t = rows.length - 1; t > 0; t--) {
            const row = rows[t];
            const nextRow = rows[t - 1];
            const age = Math.min(1, Math.max(0, (currentAudioTime - row.time) / HISTORY_SECONDS));
            const nextAge = Math.min(1, Math.max(0, (currentAudioTime - nextRow.time) / HISTORY_SECONDS));
            const fade = (0.10 + 0.58 * (1 - age)) * pauseFade;

            for (let b = 0; b < BANDS_3D - 1; b++) {
              const freqRatio = b / (BANDS_3D - 1);
              const nextFreqRatio = (b + 1) / (BANDS_3D - 1);

              const p00 = project3DPoint(age, freqRatio, row.bands[b]);
              const p10 = project3DPoint(age, nextFreqRatio, row.bands[b + 1]);
              const p01 = project3DPoint(nextAge, freqRatio, nextRow.bands[b]);
              const p11 = project3DPoint(nextAge, nextFreqRatio, nextRow.bands[b + 1]);

              const energy = Math.max(
                row.bands[b] || 0,
                row.bands[b + 1] || 0,
                nextRow.bands[b] || 0,
                nextRow.bands[b + 1] || 0
              );
              const hue = 178 + freqRatio * 118;
              const lightness = 43 + energy * 20;

              ctx.fillStyle = "hsla(" + hue.toFixed(1) + ", 88%, " + lightness.toFixed(1) + "%, " + (fade * (0.26 + energy * 0.42)).toFixed(3) + ")";
              ctx.beginPath();
              ctx.moveTo(p00.x, p00.y);
              ctx.lineTo(p10.x, p10.y);
              ctx.lineTo(p11.x, p11.y);
              ctx.lineTo(p01.x, p01.y);
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.restore();

          // 時間方向のリボン。時間軸を固定したまま、音量による高さの変化だけを連続線で見せる。
          ctx.save();
          ctx.globalAlpha = pauseFade;
          for (let b = 0; b < BANDS_3D; b += 2) {
            ctx.beginPath();
            for (let t = rows.length - 1; t >= 0; t--) {
              const row = rows[t];
              const age = Math.min(1, Math.max(0, (currentAudioTime - row.time) / HISTORY_SECONDS));
              const freqRatio = b / (BANDS_3D - 1);
              const point = project3DPoint(age, freqRatio, row.bands[b]);
              if (t === rows.length - 1) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }
            const hue = 178 + (b / (BANDS_3D - 1)) * 118;
            ctx.strokeStyle = "hsla(" + hue.toFixed(1) + ", 94%, 72%, 0.42)";
            ctx.lineWidth = b % 8 === 0 ? 1.35 : 0.72;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
          }
          ctx.restore();

          // 周波数方向の稜線。現在位置ほど太くして「波の壁」を強調する。
          ctx.save();
          ctx.globalAlpha = pauseFade;
          for (let t = rows.length - 1; t >= 0; t--) {
            const row = rows[t];
            const age = Math.min(1, Math.max(0, (currentAudioTime - row.time) / HISTORY_SECONDS));
            const fade = 0.12 + 0.88 * (1 - age);

            ctx.beginPath();
            for (let b = 0; b < BANDS_3D; b++) {
              const freqRatio = b / (BANDS_3D - 1);
              const point = project3DPoint(age, freqRatio, row.bands[b]);
              if (b === 0) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }

            const hue = 178 + (1 - age) * 118;
            ctx.strokeStyle = "hsla(" + hue.toFixed(1) + ", 100%, 76%, " + (fade * 0.74).toFixed(3) + ")";
            ctx.lineWidth = age < 0.08 ? 2.8 : 0.9;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
          }
          ctx.restore();

          // 現在の断面だけは毎フレーム描画。音量が上がるほど、カメラから見て明確に上へ持ち上がる。
          if (displayBands) {
            ctx.save();
            ctx.globalAlpha = pauseFade;
            ctx.beginPath();
            for (let b = 0; b < BANDS_3D; b++) {
              const freqRatio = b / (BANDS_3D - 1);
              const point = project3DPoint(0, freqRatio, displayBands[b]);
              if (b === 0) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }
            ctx.strokeStyle = "rgba(225,255,250,0.98)";
            ctx.lineWidth = 2.8;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.shadowBlur = lowPerformance ? 0 : 14;
            ctx.shadowColor = "rgba(65, 235, 205, 0.42)";
            ctx.stroke();
            ctx.restore();
          }

          // 現在位置の固定マーカー。時間方向の基準が常に同じ位置で分かる。
          const currentBase = project3DPoint(0, 0.5, 0);
          ctx.save();
          ctx.globalAlpha = 0.5 * pauseFade;
          ctx.strokeStyle = "rgba(255,255,255,0.32)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(currentBase.x, currentBase.y + floorDepth);
          ctx.lineTo(currentBase.x, currentBase.y - maxHeight * 0.72);
          ctx.stroke();
          ctx.restore();
        }

        if (!isPlaying) {
          const restAlpha = 0.16 + 0.62 * (1 - pauseFade);
          ctx.save();
          ctx.globalAlpha = restAlpha;
          ctx.strokeStyle = "rgba(170,220,255,0.82)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(timeLeft, baseY);
          ctx.lineTo(timeRight, baseY);
          ctx.stroke();
          ctx.restore();

          if (pauseFade <= 0) {
            waveDecayActive = false;
          }
        }
      }
    }

    if (!["2d", "a2", "a8"].includes(state.waveMode)) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 3;
      ctx.fillText("L", 8, Math.max(12, height * 0.28));
      ctx.fillText("R", 8, Math.min(height - 8, height * 0.76));
      ctx.restore();
    }
  }

  function startWaveAnimation(force = false) {
    if (!isWaveAnimating && document.visibilityState === "visible" && (!audio.paused || force)) {
      isWaveAnimating = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(drawWave);
    }
  }

  function requestWaveStaticFrame() {
    if (document.visibilityState !== "visible" || !el.wave || isWaveAnimating) return;
    isWaveAnimating = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(drawWave);
  }

  function openSidebar() {
    state.menuOpen = true;
    if (el.sidebar) el.sidebar.classList.add("open");
    if (el.overlay) el.overlay.classList.add("open");
    document.body.classList.add("menu-open");
  }

  function closeSidebar() {
    state.menuOpen = false;
    if (el.sidebar) el.sidebar.classList.remove("open", "settingsBottomSheet");
    if (el.overlay) el.overlay.classList.remove("open");
    document.body.classList.remove("menu-open");
    resetSidebarView();
  }

  function resetSidebarView() {
    if (el.mainMenuList) el.mainMenuList.style.display = "flex";
    if (menuCategoryView) menuCategoryView.hidden = true;
    if (menuCategoryHome) menuCategoryHome.hidden = false;
    if (menuCategoryTitle) menuCategoryTitle.textContent = "";
    if (menuCategoryCards) menuCategoryCards.innerHTML = "";
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
    if (el.btnSideBack) el.btnSideBack.style.display = "none";
    if (el.sideTitle) {
      el.sideTitle.textContent = "メニュー";
      el.sideTitle.onclick = null;
      el.sideTitle.style.cursor = "";
    }
  }
  if (el.btnMenu) el.btnMenu.addEventListener("click", openSidebar);
  if (el.btnCloseMenu) el.btnCloseMenu.addEventListener("click", closeSidebar);
  if (el.overlay) el.overlay.addEventListener("click", closeSidebar);


  if (el.btnSideBack) {
    el.btnSideBack.addEventListener("click", resetSidebarView);
  }


  const settingsHelpText = {
    optionsSection:"再生速度・ピッチ・シャッフルなど、再生動作に関する設定です。",
    waveSection:"波形の表示モードや3D表示を変更します。3D視点はここから初期位置へ戻せます。",
    visualizerDetailSection:"ビジュアライザーの表示負荷やFPS確認用の詳細設定です。",
    eqSection:"5バンドのイコライザーとプリセットを調整します。",
    speakerSection:"出力先、複数スピーカー、左右信号、遅延を設定します。",
    playlistSection:"プレイリストの作成・曲順・再生設定を管理します。",
    queueSection:"次に再生する曲の順番を確認・変更します。",
    timerSection:"再生を自動停止するスリープタイマーを設定します。",
    statsSection:"再生回数、再生時間、履歴などを確認します。",
    themeSection:"アプリの外観テーマを設定します。"
  };
  function showSectionHelp(id){
    const title = document.querySelector('[data-settings-section="'+id+'"] strong')?.textContent || "設定";
    showInSiteConfirm(title+" の説明", settingsHelpText[id] || "この設定の詳細を表示します。", null, "閉じる");
  }
  function addSettingsControls(){
    document.querySelectorAll(".panelSection[id]").forEach(sec => {
      const title = sec.querySelector(".sectionTitle");
      if(!title || sec.id === "homeSection") return;
      if (!title.querySelector(".sectionHelpBtn")) {
        const wrap=document.createElement("span"); wrap.style.cssText="float:right;display:flex;gap:5px;";
        const help=document.createElement("button"); help.type="button"; help.className="btn small ghost sectionHelpBtn"; help.textContent="?";
        help.title="この設定の説明";
        help.addEventListener("click",e=>{e.stopPropagation();showSectionHelp(sec.id);});
        wrap.appendChild(help);
        title.appendChild(wrap);
      }
    });
  }
  addSettingsControls();

  if (el.settingsSearch) {
    el.settingsSearch.addEventListener("input", e => {
      const q=(e.target.value||"").trim().toLowerCase();
      document.querySelectorAll(".settingsCard").forEach(card=>{
        card.hidden = !!q && !card.textContent.toLowerCase().includes(q);
      });
    });
  }

  const SETTINGS_CATEGORIES = {
    playback: {
      icon: "▶️",
      title: "再生",
      items: [
        ["optionsSection", "🎛️", "再生設定", "速度・ピッチ・再生機能・立体音響"],
        ["eqSection", "🎚️", "音質調整", "イコライザー・周波数帯を調整"],
        ["timerSection", "⏱️", "スリープタイマー", "再生を自動停止する時間を設定"]
      ]
    },
    audio: {
      icon: "🔊",
      title: "音声",
      items: [
        ["speakerSection", "🔊", "出力設定", "スピーカー・出力先・左右音量など"],
        ["inputSection", "🎤", "入力設定", "マイク・モニター・ハウリング防止など"],
        ["delaySection", "⏱️", "遅延", "スピーカーの遅延測定・自動補正"]
      ]
    },
    display: {
      icon: "🖥️",
      title: "表示",
      items: [
        ["waveSection", "〰️", "波形", "3D・2D・案1〜案8から表示方法を選択"],
        ["visualizerDetailSection", "📈", "ビジュアライザー詳細", "モード別設定・FPS・描画負荷"],
        ["layoutSection", "▦", "ホームレイアウト", "デフォルト・案1〜案5から配置を選択"],
        ["themeSection", "🎨", "テーマ", "システム・ダーク・ライト・カスタムを選択"]
      ]
    },
    history: {
      icon: "📊",
      title: "履歴",
      items: [
        ["statsSection", "📊", "再生履歴・統計", "再生回数・よく聴く曲・月間統計など"]
      ]
    },
    other: {
      icon: "⚙️",
      title: "その他",
      items: [
        ["queueSection", "⏭️", "再生キュー", "次に再生する曲の確認・並べ替え"]
      ]
    }
  };

  const settingsCategoryHome = document.getElementById("settingsCategoryHome");
  const settingsCategoryView = document.getElementById("settingsCategoryView");
  const settingsCategoryCards = document.getElementById("settingsCategoryCards");
  const settingsCategoryTitle = document.getElementById("settingsCategoryTitle");
  const btnSettingsCategoryBack = document.getElementById("btnSettingsCategoryBack");

  const menuSettingsMirror = document.getElementById("menuSettingsMirror");
  const menuCategoryHome = document.getElementById("menuCategoryHome");
  const menuCategoryView = document.getElementById("menuCategoryView");
  const menuCategoryTitle = document.getElementById("menuCategoryTitle");
  const menuCategoryCards = document.getElementById("menuCategoryCards");
  const btnMenuCategoryBack = document.getElementById("btnMenuCategoryBack");

  function renderSettingsStructure() {
    if (settingsCategoryHome) {
      settingsCategoryHome.innerHTML = "";
      Object.entries(SETTINGS_CATEGORIES).forEach(([key, category]) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "settingsCategoryCard";
        card.dataset.settingsCategory = key;
        card.innerHTML = `
          <span class="settingsIcon">${category.icon}</span>
          <span class="settingsCardText"><strong>${category.title}</strong><small>${category.items.map(item => item[2]).join("・")}</small></span>
          <span class="settingsArrow">›</span>
        `;
        settingsCategoryHome.appendChild(card);
      });
    }

    if (menuCategoryHome) {
      menuCategoryHome.innerHTML = "";
      Object.entries(MENU_CATEGORIES).forEach(([key, category]) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "menuQuickCategoryCard";
        card.dataset.menuCategory = key;
        card.innerHTML = `
          <span class="settingsIcon">${category.icon}</span>
          <span class="settingsCardText"><strong>${category.title}</strong></span>
          <span class="settingsArrow">›</span>
        `;
        menuCategoryHome.appendChild(card);
      });

      const settingsCard = document.createElement("button");
      settingsCard.type = "button";
      settingsCard.className = "menuQuickCategoryCard";
      settingsCard.innerHTML = `
        <span class="settingsIcon">⚙️</span>
        <span class="settingsCardText"><strong>詳細設定</strong><small>再生・音声・表示などの仕組みを変更</small></span>
        <span class="settingsArrow">›</span>
      `;
      settingsCard.addEventListener("click", openSettingsFromMenu);
      menuCategoryHome.appendChild(settingsCard);
    }
  }

  function openMenuDetail(secId, title) {
    if (el.mainMenuList) el.mainMenuList.style.display = "none";
    if (menuCategoryHome) menuCategoryHome.hidden = true;
    if (menuCategoryView) menuCategoryView.hidden = true;
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
    const target = document.getElementById(secId);
    if (target) target.classList.add("active");
    if (el.btnSideBack) el.btnSideBack.style.display = "inline-block";
    if (el.sideTitle) el.sideTitle.textContent = "←メニュー";
  }

  const MENU_CATEGORIES = {
    playback: {
      icon: "▶️",
      title: "再生操作",
      
      items: [
        ["click", "btnPlay", "▶", "再生 / 一時停止"],
        ["click", "btnPrev", "◀◀", "前の曲"],
        ["click", "btnNext", "▶▶", "次の曲"],
        ["click", "btnRewind10", "↶", "10秒戻す"],
        ["click", "btnForward10", "↷", "10秒進める"],
        ["click", "btnMainShuffle", "🔀", "シャッフル"],
        ["click", "btnMainRepeat", "🔁", "リピート"],
        ["section", "optionsSection", "🎚️", "速度・ピッチ", ]
      ]
    },
    library: {
      icon: "♫",
      title: "曲操作",
      
      items: [
        ["click", "btnAddMusic", "＋", "音楽 / ZIP / フォルダを追加"],
        ["section", "queueSection", "⏭️", "再生キュー", ],
        ["section", "playlistSection", "📋", "プレイリスト", ],
        ["click", "btnFav", "☆", "現在の曲をお気に入りに追加 / 解除"]
      ]
    },
    audio: {
      icon: "🔊",
      title: "出力操作",
      
      items: [
        ["section", "speakerSection", "🔊", "スピーカー", ],
        ["click", "btnMicMonitor", "🎤", "マイクモニター", ],
        ["section", "inputSection", "🎙️", "マイク", ]
      ]
    },
    display: {
      icon: "〰️",
      title: "表示操作",
      
      items: [
        ["section", "waveSection", "〰️", "波形", ],
        ["section", "visualizerDetailSection", "📈", "ビジュアライザー", ],
        ["click", "btnWaveViewReset", "↺", "3D視点をリセット"]
      ]
    }
  };

  function openSettingsFromMenu() {
    const settingsTab = document.querySelector('.navTab[data-target="settings"]');
    if (settingsTab) settingsTab.click();
    closeSidebar();
  }

  function openMenuAction(targetId) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.click();
  }

  function showMenuCategory(key) {
    const category = MENU_CATEGORIES[key];
    if (!category || !menuCategoryHome || !menuCategoryView || !menuCategoryCards) return;
    menuCategoryHome.hidden = true;
    menuCategoryView.hidden = false;
    menuCategoryTitle.textContent = category.title;
    menuCategoryCards.innerHTML = "";

    category.items.forEach(item => {
      const type = item[0];
      const targetId = item[1];
      const icon = item[2];
      const title = item[3];
      const description = item[4] || "";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "menuQuickActionCard";
      card.innerHTML = `
        <span class="settingsIcon">${icon}</span>
        <span class="settingsCardText"><strong>${title}</strong>${description ? `<small>${description}</small>` : ""}</span>
        <span class="settingsArrow">${type === "click" ? "" : "›"}</span>
      `;

      card.addEventListener("click", () => {
        if (type === "click") {
          openMenuAction(targetId);
          return;
        }
        openMenuDetail(targetId, title);
      });
      menuCategoryCards.appendChild(card);
    });
  }

  let activeSettingsDetail = null;
  const settingsDetailOverlay = document.getElementById("settingsDetailOverlay");
  const settingsDetailPanelBody = document.getElementById("settingsDetailPanelBody");
  const settingsDetailPanelTitle = document.getElementById("settingsDetailPanelTitle");
  const btnSettingsDetailBack = document.getElementById("btnSettingsDetailBack");
  const btnCloseSettingsDetail = document.getElementById("btnCloseSettingsDetail");
  const settingsDetailBackdrop = document.getElementById("settingsDetailBackdrop");

  function restoreSettingsDetail() {
    if (!activeSettingsDetail) return;
    const { target, parent, nextSibling } = activeSettingsDetail;
    target.classList.remove("active");
    if (parent) parent.insertBefore(target, nextSibling && nextSibling.parentNode === parent ? nextSibling : null);
    activeSettingsDetail = null;
    if (settingsDetailOverlay) {
      settingsDetailOverlay.classList.remove("open");
      settingsDetailOverlay.hidden = true;
    }
    if (settingsDetailPanelTitle) settingsDetailPanelTitle.textContent = "設定";
    if (settingsCategoryTitle) settingsCategoryTitle.hidden = false;
    if (settingsCategoryCards) settingsCategoryCards.hidden = false;
    if (btnSettingsCategoryBack) {
      btnSettingsCategoryBack.hidden = false;
      btnSettingsCategoryBack.textContent = "← 設定";
    }
  }

  function openSettingsDetail(secId, title) {
    const target = document.getElementById(secId);
    if (!target || !settingsCategoryView || !settingsCategoryCards || !settingsDetailOverlay || !settingsDetailPanelBody) return;

    // 詳細は既存の設定一覧や左メニュー内ではなく、独立したボトムシートに表示する。
    restoreSettingsDetail();
    activeSettingsDetail = {
      target,
      parent: target.parentNode,
      nextSibling: target.nextSibling
    };
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
    settingsCategoryCards.hidden = true;
    if (settingsCategoryTitle) settingsCategoryTitle.hidden = true;
    if (btnSettingsCategoryBack) btnSettingsCategoryBack.hidden = true;
    if (settingsDetailPanelTitle) settingsDetailPanelTitle.textContent = title || "設定";
    if (btnSettingsDetailBack) btnSettingsDetailBack.textContent = "←";
    target.classList.add("active");
    settingsDetailPanelBody.appendChild(target);
    settingsDetailOverlay.hidden = false;
    settingsDetailOverlay.classList.remove("open");
    void settingsDetailOverlay.offsetWidth;
    requestAnimationFrame(() => settingsDetailOverlay.classList.add("open"));
  }

  if (btnSettingsDetailBack) btnSettingsDetailBack.addEventListener("click", restoreSettingsDetail);
  if (btnCloseSettingsDetail) btnCloseSettingsDetail.addEventListener("click", restoreSettingsDetail);
  if (settingsDetailBackdrop) settingsDetailBackdrop.addEventListener("click", restoreSettingsDetail);

  function showSettingsCategory(key) {
    const category = SETTINGS_CATEGORIES[key];
    if (!category || !settingsCategoryHome || !settingsCategoryView || !settingsCategoryCards) return;

    settingsCategoryHome.hidden = true;
    settingsCategoryView.hidden = false;
    settingsCategoryTitle.textContent = category.title;
    if (el.settingsSearch) el.settingsSearch.value = "";

    settingsCategoryCards.innerHTML = "";
    category.items.forEach(([secId, icon, title, description]) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "settingsCard";
      card.dataset.settingsSection = secId;
      card.innerHTML = `
        <span class="settingsIcon">${icon}</span>
        <span class="settingsCardText"><strong>${title}</strong><small>${description}</small></span>
        <span class="settingsArrow">›</span>
      `;
      card.addEventListener("click", () => openSettingsDetail(secId, title));
      settingsCategoryCards.appendChild(card);
    });
  }

  renderSettingsStructure();

  document.querySelectorAll("[data-settings-category]").forEach(card => {
    card.addEventListener("click", () => showSettingsCategory(card.dataset.settingsCategory));
  });

  document.querySelectorAll("[data-menu-category]").forEach(card => {
    card.addEventListener("click", () => showMenuCategory(card.dataset.menuCategory));
  });

  if (btnMenuCategoryBack) {
    btnMenuCategoryBack.addEventListener("click", () => {
      if (menuCategoryView) menuCategoryView.hidden = true;
      if (menuCategoryHome) menuCategoryHome.hidden = false;
      if (menuCategoryTitle) menuCategoryTitle.textContent = "";
      if (menuCategoryCards) menuCategoryCards.innerHTML = "";
    });
  }

  if (btnSettingsCategoryBack) {
    btnSettingsCategoryBack.addEventListener("click", () => {
      if (activeSettingsDetail) {
        restoreSettingsDetail();
        return;
      }
      if (settingsCategoryView) settingsCategoryView.hidden = true;
      if (settingsCategoryHome) settingsCategoryHome.hidden = false;
      if (el.settingsSearch) el.settingsSearch.value = "";
      if (settingsCategoryTitle) {
        settingsCategoryTitle.textContent = "";
        settingsCategoryTitle.hidden = false;
      }
      if (settingsCategoryCards) {
        settingsCategoryCards.innerHTML = "";
        settingsCategoryCards.hidden = false;
      }
      btnSettingsCategoryBack.hidden = false;
      btnSettingsCategoryBack.textContent = "← 設定";
    });
  }

  const settingsAddMusic = document.getElementById("btnSettingsAddMusic");
  if (settingsAddMusic) {
    settingsAddMusic.addEventListener("click", () => {
      const sourceBtn = document.getElementById("btnAddMusic");
      if (sourceBtn) sourceBtn.click();
    });
  }

  const settingsResetFiles = document.getElementById("btnSettingsResetFiles");
  if (settingsResetFiles) {
    settingsResetFiles.addEventListener("click", () => {
      const sourceBtn = document.getElementById("btnResetFiles");
      if (sourceBtn) sourceBtn.click();
    });
  }

  if (el.btnSettingsResetSettings) {
    el.btnSettingsResetSettings.addEventListener("click", () => {
      if (el.btnResetSettings) el.btnResetSettings.click();
    });
  }

  const HOME_LAYOUTS = ["default", "1", "2", "3", "4", "5"];

  function normalizeHomeLayout(value) {
    const mode = String(value || "default");
    return HOME_LAYOUTS.includes(mode) ? mode : "default";
  }

  function applyHomeLayout(value, persist = true) {
    const home = document.getElementById("homeElements");
    const settingsButtons = document.querySelectorAll("[data-home-layout]");
    const mode = normalizeHomeLayout(value);

    if (!home) return mode;

    HOME_LAYOUTS.forEach(name => {
      home.classList.remove(name === "default" ? "home-layout-default" : "home-layout-" + name);
    });
    home.classList.add(mode === "default" ? "home-layout-default" : "home-layout-" + mode);

    settingsButtons.forEach(button => {
      const active = button.dataset.homeLayout === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    state.homeLayout = mode;
    if (persist) {
      try { localStorage.setItem(STORAGE.homeLayout, mode); } catch {}
    }
    return mode;
  }

  function setupHomeLayoutSettings() {
    const container = document.getElementById("homeLayoutSettingsBtns");
    if (!container) return;

    container.querySelectorAll("[data-home-layout]").forEach(button => {
      button.addEventListener("click", () => {
        const mode = normalizeHomeLayout(button.dataset.homeLayout);
        applyHomeLayout(mode, true);
        const label = mode === "default" ? "デフォルト" : "レイアウト" + mode;
        toast("ホームレイアウトを「" + label + "」に変更しました");
      });
    });

    applyHomeLayout(state.homeLayout, false);
  }

  setupHomeLayoutSettings();

  document.querySelectorAll(".navTab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".navTab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.target;

      const homeEl = document.getElementById("homeElements");
      const ytEl = document.getElementById("youtubeElements");
      const plEl = document.getElementById("playlistElements");
      const setEl = document.getElementById("settingsTabContainer");

      if (homeEl) homeEl.style.display = target === "home" ? "block" : "none";
      if (ytEl) ytEl.style.display = target === "youtube" ? "flex" : "none";
      if (plEl) plEl.style.display = target === "playlist" ? "flex" : "none";
      if (setEl) setEl.style.display = target === "settings" ? "block" : "none";
    });
  });

  if (el.shell) {
    el.shell.addEventListener("dragover", e => {
      e.preventDefault();
      el.shell.classList.add("dragover");
    });
    el.shell.addEventListener("dragleave", () => el.shell.classList.remove("dragover"));
    el.shell.addEventListener("drop", e => {
      e.preventDefault();
      el.shell.classList.remove("dragover");
      if (e.dataTransfer.files) loadFiles(e.dataTransfer.files);
    });
  }

  window.addEventListener("keydown", e => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

    const isModalOpen = el.shortcutModal?.classList.contains("show") ||
                        el.plAlertModal?.classList.contains("show") ||
                        el.plSelectSheet?.classList.contains("show") ||
                        el.playlistTrackSheet?.classList.contains("show");

    if (e.key === "Escape") {
      if (isModalOpen) {
        hideShortcutModal();
        hidePlAlertModal();
        closePlSelectSheet();
        if (el.playlistTrackSheet?.classList.contains("show")) closePlaylistTrackSheet();
      } else if (state.menuOpen) {
        closeSidebar();
      }
      return;
    }

    if (isModalOpen) return;

    const mediaKeyMap = {
      MediaTrackNext: () => nextTrack(),
      AudioTrackNext: () => nextTrack(),
      MediaTrackPrevious: () => prevTrack(),
      AudioTrackPrevious: () => prevTrack(),
      MediaPlayPause: () => playPause(),
      MediaPlay: () => { if (audio.paused) playPause(); },
      MediaPause: () => { if (!audio.paused) playPause(); },
      MediaStop: () => { setPlaybackIntent(false); audio.pause(); audio.currentTime = 0; updatePlayPauseUI(); }
    };
    if (mediaKeyMap[e.code]) {
      e.preventDefault();
      mediaKeyMap[e.code]();
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      playPause();
    } else if (e.code === "ArrowUp") {
      e.preventDefault();
      updateVolumeUI(currentVolumeTarget + 0.05);
    } else if (e.code === "ArrowDown") {
      e.preventDefault();
      updateVolumeUI(currentVolumeTarget - 0.05);
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      prevTrack();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      nextTrack();
    } else if (e.key === "m" || e.key === "M") {
      if (el.btnMuteToggle) el.btnMuteToggle.click();
    } else if (e.key === "f" || e.key === "F") {
      if (el.btnFav) el.btnFav.click();
    } else if (e.key === "?") {
      showShortcutModal();
    }
  });

  let appLoadingDisplayedProgress = Math.max(0, Number(document.getElementById("appLoadingPercent")?.textContent?.replace("%", "")) || 0);
  let appLoadingTargetProgress = appLoadingDisplayedProgress;
  let appLoadingProgressTimer = null;

  function updateAppLoadingProgress(percent, message) {
    if (typeof window.__musicPlayerUpdateStartupProgress === "function") {
      window.__musicPlayerUpdateStartupProgress(percent, message);
      return;
    }
    appLoadingTargetProgress = Math.max(appLoadingDisplayedProgress, Math.min(100, Math.round(percent)));
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (messageText && message) messageText.textContent = message;

    if (fill) fill.style.width = appLoadingDisplayedProgress + "%";
    if (percentText) percentText.textContent = appLoadingDisplayedProgress + "%";

    if (appLoadingProgressTimer === null) {
      const step = () => {
        if (appLoadingDisplayedProgress < appLoadingTargetProgress) {
          appLoadingDisplayedProgress = Math.min(
            appLoadingTargetProgress,
            appLoadingDisplayedProgress + 1
          );
          if (fill) fill.style.width = appLoadingDisplayedProgress + "%";
          if (percentText) percentText.textContent = appLoadingDisplayedProgress + "%";
        }
        if (appLoadingDisplayedProgress < appLoadingTargetProgress) {
          appLoadingProgressTimer = setTimeout(() => {
            appLoadingProgressTimer = null;
            step();
          }, 12);
        } else {
          appLoadingProgressTimer = null;
        }
      };
      step();
    }
  }

  function revealAppAfterHomeReady() {
    updateAppLoadingProgress(100, "ホーム画面を表示します...");
    const finishWhenProgressIsReady = () => {
      const screen = document.getElementById("appLoadingScreen");
      if (!screen) return;
      const shown = Number(document.getElementById("appLoadingPercent")?.textContent?.replace("%", "")) || 0;
      if (shown < 100) {
        requestAnimationFrame(finishWhenProgressIsReady);
        return;
      }
      document.body.classList.remove("app-loading");
      screen.remove();
    };
    requestAnimationFrame(finishWhenProgressIsReady);
  }

  (async () => {
    let homeRevealed = false;
    try {
      updateAppLoadingProgress(20, "ホーム画面を準備しています...");

      applyTheme();
      if (!state.currentSong && typeof updateArtwork === "function") {
        updateArtwork(null);
      }
      renderColorPickers();
      setDMode(state.dMode);
      setWaveMode(state.waveMode);
      if (el.playbackRate) el.playbackRate.value = Math.min(2.0, Math.max(0.0, currentRate));
      if (el.customRateInput) el.customRateInput.value = currentRate.toFixed(2);
      if (el.pitchShift) el.pitchShift.value = state.pitchSemitones;
      updateVolumeUI(currentVolumeTarget);
      applyPitchAndRate();
      setupMediaSessionRemoteControls();

      updateAppLoadingProgress(65, "波形と操作画面を準備しています...");
      requestWaveStaticFrame();

      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      updateAppLoadingProgress(90, "ホーム画面の表示準備が完了しました");

      revealAppAfterHomeReady();
      homeRevealed = true;

      await new Promise(resolve => requestAnimationFrame(resolve));
      await initDB();
      await reloadPlaylistFromDB();
      restoreLastPlaybackMemory();
      renderEqualizer();
    } catch (error) {
      console.error("Music Player startup initialization failed:", error);
      updateAppLoadingProgress(100, "ホーム画面を表示します...");
    } finally {
      if (!homeRevealed) {
        revealAppAfterHomeReady();
      }
    }
  })();
