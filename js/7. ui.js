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
    function drawNewWaveVisualizer(ctx, width, height, dt, isPlaying, lowPerformance, now) {
    const cache = drawWave._freshViz || (drawWave._freshViz = { history: [], terrain: [], lastHistory: 0, lastTerrain: 0, shocks: [], lastBass: 0 });
    const t = now * 0.001, cx = width * 0.5, cy = height * 0.52, side = Math.min(width, height);
    if (analyser && waveTimeData) {
      if (isPlaying) analyser.getByteTimeDomainData(waveTimeData);
      else for (let i = 0; i < waveTimeData.length; i++) waveTimeData[i] += (128 - waveTimeData[i]) * 0.12;
    }
    if (waveLeftOutputAnalyser && waveLeftOutputData) {
      if (isPlaying) waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
      else for (let i = 0; i < waveLeftOutputData.length; i++) waveLeftOutputData[i] *= 0.88;
    }
    if (waveRightOutputAnalyser && waveRightOutputData) {
      if (isPlaying) waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);
      else for (let i = 0; i < waveRightOutputData.length; i++) waveRightOutputData[i] *= 0.88;
    }
    if (leftLevelAnalyser && leftLevelData) {
      if (isPlaying) leftLevelAnalyser.getByteTimeDomainData(leftLevelData);
      else for (let i = 0; i < leftLevelData.length; i++) leftLevelData[i] += (128 - leftLevelData[i]) * 0.12;
    }
    if (rightLevelAnalyser && rightLevelData) {
      if (isPlaying) rightLevelAnalyser.getByteTimeDomainData(rightLevelData);
      else for (let i = 0; i < rightLevelData.length; i++) rightLevelData[i] += (128 - rightLevelData[i]) * 0.12;
    }
    const lf = waveLeftOutputData && waveLeftOutputData.length ? waveLeftOutputData : analyserData;
    const rf = waveRightOutputData && waveRightOutputData.length ? waveRightOutputData : lf;
    const band = (arr, a, b) => {
      if (!arr || !arr.length) return 0;
      const lo = Math.max(0, Math.min(arr.length - 1, Math.floor(a * arr.length)));
      const hi = Math.max(lo + 1, Math.min(arr.length, Math.ceil(b * arr.length)));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += (arr[i] || 0) / 255;
      return sum / Math.max(1, hi - lo);
    };
    const spec = (i, n) => Math.min(1, (band(lf, i / n, (i + 1) / n) + band(rf, i / n, (i + 1) / n)) * 0.95);
    const sample = (arr, p) => arr && arr.length ? ((arr[Math.max(0, Math.min(arr.length - 1, Math.floor(p * (arr.length - 1))))] || 128) - 128) / 128 : 0;
    const energy = (a, b) => {
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += spec(Math.floor(a + (b - a) * i / 10), 64);
      return sum / 10;
    };
    const bass = energy(0, 10), mid = energy(10, 34), treble = energy(34, 64), all = (bass + mid + treble) / 3;
    const historyCount = lowPerformance ? 18 : 30;
    if (isPlaying && now - cache.lastHistory > (lowPerformance ? 120 : 72)) {
      const row = new Float32Array(lowPerformance ? 32 : 48);
      for (let i = 0; i < row.length; i++) row[i] = spec(i, row.length);
      cache.history.unshift(row);
      if (cache.history.length > historyCount) cache.history.length = historyCount;
      cache.lastHistory = now;
    }
    if (isPlaying && now - cache.lastTerrain > (lowPerformance ? 150 : 90)) {
      const row = new Float32Array(lowPerformance ? 20 : 30);
      for (let i = 0; i < row.length; i++) row[i] = spec(i, row.length);
      cache.terrain.unshift(row);
      if (cache.terrain.length > (lowPerformance ? 14 : 22)) cache.terrain.length = lowPerformance ? 14 : 22;
      cache.lastTerrain = now;
    }
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#050a16"); bg.addColorStop(0.5, "#090d1b"); bg.addColorStop(1, "#10091b");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    const grid = (sx, sy, alpha) => {
      ctx.save(); ctx.strokeStyle = "rgba(112,170,210," + alpha + ")"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= width; x += sx) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = 0; y <= height; y += sy) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke(); ctx.restore();
    };
    const waveLine = (arr, y0, amp, hue, phase, thick) => {
      if (!arr || !arr.length) return;
      ctx.beginPath();
      const n = lowPerformance ? 80 : 140;
      for (let i = 0; i < n; i++) {
        const p = i / (n - 1), y = y0 - (sample(arr, p) * 0.82 + Math.sin(p * 25 + t * 1.6 + phase) * 0.05) * amp;
        if (!i) ctx.moveTo(p * width, y); else ctx.lineTo(p * width, y);
      }
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "hsla(" + hue + ",100%,70%,0.22)"; ctx.lineWidth = thick * 4;
      ctx.shadowBlur = lowPerformance ? 0 : 10; ctx.shadowColor = "hsla(" + hue + ",100%,60%,0.5)"; ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = "hsla(" + hue + ",95%,82%,0.96)"; ctx.lineWidth = thick; ctx.stroke();
    };

    switch (state.waveMode) {
      case "a1": {
        grid(Math.max(28, width / 16), Math.max(18, height / 7), 0.07);
        const amp = height * (0.3 + all * 0.16);
        waveLine(waveTimeData, cy, amp, 188, 0, 2.2);
        waveLine(waveTimeData, cy - height * 0.12, amp * 0.6, 278, 2, 1.2);
        waveLine(waveTimeData, cy + height * 0.12, amp * 0.6, 32, 4, 1.2);
        break;
      }
      case "a2": {
        grid(Math.max(34, width / 12), Math.max(24, height / 5), 0.04);
        const n = lowPerformance ? 28 : 44, base = height * 0.88, gap = width / n * 0.22, bw = width / n - gap;
        for (let i = 0; i < n; i++) {
          const v = spec(i, n), h = Math.max(2, v * height * 0.72), x = i * width / n + gap / 2, y = base - h, d = Math.max(2, bw * 0.22), hue = 178 + i / n * 120;
          ctx.fillStyle = "hsla(" + hue + ",90%,56%,0.95)"; ctx.fillRect(x, y, bw, h);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + d, y - d); ctx.lineTo(x + bw + d, y - d); ctx.lineTo(x + bw, y); ctx.closePath();
          ctx.fillStyle = "hsla(" + hue + ",100%,78%,0.9)"; ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + bw, y); ctx.lineTo(x + bw + d, y - d); ctx.lineTo(x + bw + d, base - d); ctx.lineTo(x + bw, base); ctx.closePath();
          ctx.fillStyle = "hsla(" + hue + ",88%,30%,0.94)"; ctx.fill();
        }
        break;
      }
      case "a3": {
        grid(Math.max(30, width / 14), Math.max(22, height / 6), 0.04);
        waveLine(leftLevelData, height * 0.29, height * 0.22, 188, 0.5, 2);
        waveLine(rightLevelData, height * 0.72, height * 0.22, 285, 2.4, 2);
        ctx.font = "bold 10px sans-serif"; ctx.textAlign = "left";
        ctx.fillStyle = "rgba(180,235,255,0.82)"; ctx.fillText("LEFT", 9, 14);
        ctx.fillStyle = "rgba(205,170,255,0.86)"; ctx.fillText("RIGHT", 9, height - 7);
        break;
      }
      case "a4": {
        const rows = cache.history, rowH = height / historyCount;
        for (let r = rows.length - 1; r >= 0; r--) {
          const row = rows[r], y = (rows.length - 1 - r) * rowH;
          for (let i = 0; i < row.length; i++) {
            const v = row[i], hue = 190 + i / row.length * 145 - v * 35;
            const h = Math.max(1, rowH * (0.24 + v * 0.9));
            ctx.fillStyle = "hsla(" + hue + ",92%," + (34 + v * 40) + "%," + (0.28 + v * 0.72) + ")";
            ctx.fillRect(i * width / row.length, y + (rowH - h) / 2, width / row.length + 0.6, h);
          }
        }
        break;
      }
      case "a5": {
        ctx.save(); ctx.translate(cx, cy);
        const layers = lowPerformance ? 3 : 5, n = lowPerformance ? 90 : 150;
        for (let l = 0; l < layers; l++) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const p = i / (n - 1), v = spec(Math.floor(p * 63), 64);
            const a = p * Math.PI * 5.5 + t * (0.28 + l * 0.08) + l * 1.3;
            const r = side * (0.08 + p * 0.3 + v * 0.11) + l * 2;
            const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.72;
            if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          const hue = 178 + l * 35;
          ctx.strokeStyle = "hsla(" + hue + ",100%,72%,0.8)"; ctx.lineWidth = l ? 1.2 : 2.2;
          ctx.shadowBlur = lowPerformance ? 0 : 8; ctx.shadowColor = "hsla(" + hue + ",100%,60%,0.4)"; ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "a6": {
        const r = side * (0.12 + bass * 0.12), pulse = 1 + bass * 0.24 + Math.sin(t * 2.2) * 0.025;
        ctx.save(); ctx.translate(cx, cy);
        const orb = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 1, 0, 0, r * 1.4);
        orb.addColorStop(0, "rgba(255,255,255,0.98)"); orb.addColorStop(0.2, "rgba(105,225,255,0.9)");
        orb.addColorStop(0.55, "rgba(50,115,255,0.35)"); orb.addColorStop(1, "rgba(35,20,100,0)");
        ctx.fillStyle = orb; ctx.beginPath(); ctx.arc(0, 0, r * 1.45 * pulse, 0, Math.PI * 2); ctx.fill();
        for (let j = 0; j < 4; j++) {
          const rr = r * (1.2 + j * 0.38) * pulse;
          ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * (0.56 + j * 0.08), t * (j % 2 ? -0.16 : 0.12), 0, Math.PI * 2);
          ctx.strokeStyle = "hsla(" + (180 + j * 34) + ",100%,72%," + (0.72 - j * 0.12) + ")";
          ctx.lineWidth = j ? 1.2 : 2.4; ctx.shadowBlur = lowPerformance ? 0 : 9; ctx.stroke();
        }
        const n = lowPerformance ? 48 : 88;
        for (let i = 0; i < n; i++) {
          const p = i / n, v = spec(i, n), a = p * Math.PI * 2 + t * 0.18, ri = r * 1.75, ro = ri + v * side * 0.18;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * ri, Math.sin(a) * ri); ctx.lineTo(Math.cos(a) * ro, Math.sin(a) * ro);
          ctx.strokeStyle = "hsla(" + (185 + p * 115) + ",95%,70%,0.9)"; ctx.lineWidth = 1.5 + v * 1.4; ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case "a7": {
        const pulse = Math.min(1, bass * 1.7 + all * 0.55);
        if (isPlaying && bass > 0.38 && bass - cache.lastBass > 0.075) cache.shocks.push({ r: 0, life: 1, strength: bass });
        cache.lastBass = bass;
        for (let i = cache.shocks.length - 1; i >= 0; i--) {
          const s = cache.shocks[i]; s.r += dt * side * (0.48 + s.strength * 0.6); s.life -= dt * 0.48;
          if (s.life <= 0) cache.shocks.splice(i, 1);
        }
        ctx.save(); ctx.translate(cx, cy);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.arc(0, 0, side * (0.12 + i * 0.11) + pulse * side * 0.04, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(90,185,255," + (0.12 + pulse * 0.12) + ")"; ctx.lineWidth = 1; ctx.stroke();
        }
        cache.shocks.forEach((s, i) => {
          ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2);
          ctx.strokeStyle = "hsla(" + (185 + i * 25) + ",100%,72%," + Math.max(0, s.life * 0.82) + ")";
          ctx.lineWidth = 1.5 + s.life * 2.5; ctx.shadowBlur = lowPerformance ? 0 : 10; ctx.stroke();
        });
        const particles = Math.min(lowPerformance ? 260 : 900, Math.max(0, Number(state.waveParticleCount) || 0));
        for (let i = 0; i < particles; i++) {
          const a = i * 2.399963 + t * (0.12 + (i % 7) * 0.015);
          const rr = side * (0.08 + ((i * 37) % 101) / 130), v = spec(i % 64, 64);
          ctx.fillStyle = "hsla(" + (180 + i % 90) + ",95%,72%," + (0.25 + v * 0.7) + ")";
          ctx.fillRect(Math.cos(a) * (rr + v * side * 0.07), Math.sin(a) * (rr + v * side * 0.07), 1.4 + v * 1.6, 1.4 + v * 1.6);
        }
        ctx.restore();
        break;
      }
      case "a8": {
        const n = lowPerformance ? 64 : 112, scale = side * 0.34;
        ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = i / (n - 1), x = sample(leftLevelData, p) * scale, y = -sample(rightLevelData, p) * scale;
          if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "rgba(255,110,210,0.24)"; ctx.lineWidth = 7; ctx.shadowBlur = lowPerformance ? 0 : 14; ctx.stroke();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(190,245,255,0.96)"; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, scale * 0.08, 0, Math.PI * 2); ctx.fillStyle = "white"; ctx.fill();
        ctx.restore();
        ctx.fillStyle = "rgba(190,225,255,0.72)"; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.fillText("L × R STEREO", 9, 15);
        break;
      }
      case "3d":
      default: {
        const rows = cache.terrain, cols = lowPerformance ? 20 : 30, depthRows = lowPerformance ? 14 : 22, vertices = [];
        for (let r = 0; r < depthRows; r++) {
          const row = rows[Math.min(rows.length - 1, Math.floor(r * Math.max(1, rows.length - 1) / Math.max(1, depthRows - 1)))] || null;
          const line = [];
          for (let c = 0; c < cols; c++) {
            const v = row ? row[Math.min(row.length - 1, Math.floor(c * (row.length - 1) / Math.max(1, cols - 1)))] : 0;
            const x = (c / (cols - 1) - 0.5) * width * 0.82, z = (r / (depthRows - 1) - 0.5) * height * 0.72;
            line.push(applyWaveView({ x: cx + x, y: v * height * 0.34, depth: z, fitScale: 1 }, width, height));
          }
          vertices.push(line);
        }
        ctx.save(); ctx.lineWidth = lowPerformance ? 0.8 : 1.05;
        for (let r = 0; r < vertices.length; r++) {
          ctx.beginPath();
          for (let c = 0; c < cols; c++) { const p = vertices[r][c]; if (!c) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
          const row = rows[Math.min(rows.length - 1, r)];
          const e = row ? row.reduce((sum, v) => sum + v, 0) / row.length : 0;
          ctx.strokeStyle = "hsla(" + (185 + e * 95) + ",100%," + (54 + e * 24) + "%," + (0.22 + r / vertices.length * 0.55) + ")"; ctx.stroke();
        }
        for (let c = 0; c < cols; c += lowPerformance ? 2 : 1) {
          ctx.beginPath();
          for (let r = 0; r < vertices.length; r++) { const p = vertices[r][c]; if (!r) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
          ctx.strokeStyle = "rgba(115,205,245,0.32)"; ctx.lineWidth = 0.8; ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = "rgba(210,240,255,0.74)"; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.fillText("FREQUENCY →", 9, height - 8);
        ctx.textAlign = "right"; ctx.fillText("TIME →", width - 9, height - 8);
        break;
      }
    }
    if (state.waveMode !== "a3" && state.waveMode !== "a8") {
      ctx.save(); ctx.font = "9px sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(180,220,245,0.58)";
      ctx.fillText("L", 8, Math.max(12, height * 0.24)); ctx.fillText("R", 8, Math.min(height - 8, height * 0.78)); ctx.restore();
    }
  }

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
          if (document.body.classList.contains("theme-light")) {
            ctx.strokeStyle = "rgba(255,255,255,.52)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, trackTop + 0.5, Math.max(0, meterW - 1), Math.max(0, trackH - 1));
          }
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
          meterGradient.addColorStop(0, "#35D977");
          meterGradient.addColorStop(0.58, "#d7df28");
          meterGradient.addColorStop(1, "#ff3b30");
          ctx.fillStyle = "rgba(255,255,255,.08)";
          ctx.fillRect(x, trackTop, meterW, trackH);
          if (document.body.classList.contains("theme-light")) {
            ctx.strokeStyle = "rgba(255,255,255,.52)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, trackTop + 0.5, Math.max(0, meterW - 1), Math.max(0, trackH - 1));
          }
          ctx.fillStyle = meterGradient;
          ctx.fillRect(x, trackBottom - fillH, meterW, fillH);
          ctx.fillStyle = "rgba(255,255,255,.72)";
          ctx.font = "9px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(label, x + meterW / 2, Math.max(11, trackTop - 5));
        };
        drawLevelMeter(0, leftDisplayLevel, "L");
        drawLevelMeter(width - meterW, rightDisplayLevel, "R");
      } else {
        drawNewWaveVisualizer(ctx, width, height, dt, isPlaying, lowPerformance, now);
      }
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
