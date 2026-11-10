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
      const v = drawWave._visualizerV4 || (drawWave._visualizerV4 = {
        history: [], lastSample: 0, peaks: null, particles: [], lastBass: 0,
        phase: 0, trails: [], spectrogram: [], burst: 0
      });
      const t = now * 0.001, cx = width * 0.5, cy = height * 0.5;
      const short = Math.min(width, height);
      const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
      const TAU = Math.PI * 2;
      const count = lowPerformance ? 36 : 72;

      if (analyser && waveTimeData) {
        if (isPlaying) analyser.getByteTimeDomainData(waveTimeData);
        else for (let i = 0; i < waveTimeData.length; i++) waveTimeData[i] += (128 - waveTimeData[i]) * 0.12;
      }
      if (waveLeftOutputAnalyser && waveLeftOutputData) {
        if (isPlaying) waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
        else for (let i = 0; i < waveLeftOutputData.length; i++) waveLeftOutputData[i] *= 0.9;
      }
      if (waveRightOutputAnalyser && waveRightOutputData) {
        if (isPlaying) waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);
        else for (let i = 0; i < waveRightOutputData.length; i++) waveRightOutputData[i] *= 0.9;
      }
      if (leftLevelAnalyser && leftLevelData) {
        if (isPlaying) leftLevelAnalyser.getByteTimeDomainData(leftLevelData);
        else for (let i = 0; i < leftLevelData.length; i++) leftLevelData[i] += (128 - leftLevelData[i]) * 0.12;
      }
      if (rightLevelAnalyser && rightLevelData) {
        if (isPlaying) rightLevelAnalyser.getByteTimeDomainData(rightLevelData);
        else for (let i = 0; i < rightLevelData.length; i++) rightLevelData[i] += (128 - rightLevelData[i]) * 0.12;
      }

      const lf = waveLeftOutputData?.length ? waveLeftOutputData : analyserData;
      const rf = waveRightOutputData?.length ? waveRightOutputData : lf;
      const freq = analyserData?.length ? analyserData : lf;
      const avg = (data, from, to) => {
        if (!data?.length) return 0;
        const lo = clamp(Math.floor(from * data.length), 0, data.length - 1);
        const hi = clamp(Math.ceil(to * data.length), lo + 1, data.length);
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += (Number(data[i]) || 0) / 255;
        return sum / (hi - lo);
      };
      const band = (p, channel) => {
        const data = channel === "L" ? lf : channel === "R" ? rf : freq;
        return avg(data, p, Math.min(1, p + 1 / Math.max(1, count)));
      };
      const sample = (data, p) => {
        if (!data?.length) return 0;
        const i = clamp(Math.floor(p * (data.length - 1)), 0, data.length - 1);
        return ((Number(data[i]) || 128) - 128) / 128;
      };
      const low = (avg(lf, 0, .16) + avg(rf, 0, .16)) * .5;
      const mid = (avg(lf, .16, .58) + avg(rf, .16, .58)) * .5;
      const high = (avg(lf, .58, 1) + avg(rf, .58, 1)) * .5;
      const energy = clamp((low + mid + high) / 3, 0, 1);
      const glow = lowPerformance ? 0 : 1;
      const drawBackground = (top, bottom) => {
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, top); g.addColorStop(1, bottom);
        ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
      };
      const label = (s, color = "rgba(210,235,245,.34)") => {
        ctx.save(); ctx.font = "600 8px system-ui,sans-serif";
        ctx.textAlign = "left"; ctx.fillStyle = color; ctx.fillText(s, 10, 15); ctx.restore();
      };
      const glowLine = (path, color, lineWidth, blur = 12) => {
        ctx.save(); ctx.beginPath(); path();
        ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.shadowBlur = glow ? blur : 0; ctx.shadowColor = color; ctx.stroke(); ctx.restore();
      };
      const spectrumValue = (i, n, channel) => band(i / n, channel);
      const pushHistory = () => {
        if (!isPlaying || now - v.lastSample < (lowPerformance ? 110 : 48)) return;
        const bins = lowPerformance ? 48 : 96;
        const row = new Float32Array(bins);
        for (let i = 0; i < bins; i++) row[i] = avg(freq, i / bins, (i + 1) / bins);
        v.history.unshift(row);
        if (v.history.length > (lowPerformance ? 48 : 96)) v.history.length = lowPerformance ? 48 : 96;
        const stereo = new Float32Array(bins * 2);
        for (let i = 0; i < bins; i++) {
          stereo[i] = avg(lf, i / bins, (i + 1) / bins);
          stereo[bins + i] = avg(rf, i / bins, (i + 1) / bins);
        }
        v.spectrogram.unshift(stereo);
        if (v.spectrogram.length > (lowPerformance ? 52 : 110)) v.spectrogram.length = lowPerformance ? 52 : 110;
        v.lastSample = now;
      };
      pushHistory();

      switch (state.waveMode) {
        case "3d": {
          drawBackground("#02060c", "#03010a");
          const rows = v.history, rowCount = lowPerformance ? 13 : 25, colCount = lowPerformance ? 24 : 48;
          const points = [];
          for (let r = 0; r < rowCount; r++) {
            const ri = Math.min(rows.length - 1, Math.floor(r * Math.max(1, rows.length - 1) / (rowCount - 1)));
            const row = rows[ri], line = [];
            for (let c = 0; c < colCount; c++) {
              const val = row ? row[Math.min(row.length - 1, Math.floor(c * (row.length - 1) / (colCount - 1)))] : 0;
              const x = (c / (colCount - 1) - .5) * width * .88;
              const depth = (r / (rowCount - 1) - .5) * height * .8;
              const y = val * height * .46;
              line.push(applyWaveView({x:cx + x,y,depth,fitScale:1},width,height));
            }
            points.push(line);
          }
          for (let r = rowCount - 2; r >= 0; r--) {
            for (let c = 0; c < colCount - 1; c++) {
              const a=points[r][c], b=points[r][c+1], d=points[r+1][c], e=points[r+1][c+1];
              const val=rows[r]?.[Math.min(rows[r].length-1,Math.floor(c/(colCount-1)*rows[r].length))] || 0;
              const hue=175 + val*145 + c/colCount*25;
              ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.lineTo(e.x,e.y); ctx.lineTo(d.x,d.y); ctx.closePath();
              ctx.fillStyle="hsla("+hue+",100%,"+(12+val*23)+"%,.38)"; ctx.fill();
              ctx.strokeStyle="hsla("+hue+",100%,"+(48+val*35)+"%,"+(.2+val*.62)+")";
              ctx.lineWidth=lowPerformance?.65:1; ctx.stroke();
            }
          }
          for(let r=0;r<rowCount;r++){
            ctx.beginPath();
            for(let c=0;c<colCount;c++){const p=points[r][c]; if(!c)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
            ctx.strokeStyle="rgba(40,245,190,"+(.16+r/rowCount*.28)+")"; ctx.lineWidth=lowPerformance?.7:1; ctx.stroke();
          }
          for(let c=0;c<colCount;c+=2){
            ctx.beginPath();
            for(let r=0;r<rowCount;r++){const p=points[r][c];if(!r)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
            ctx.strokeStyle="rgba(60,130,255,.24)";ctx.lineWidth=.7;ctx.stroke();
          }
          label("3D SPECTROGRAM  /  TIME × FREQUENCY"); break;
        }

        case "a1": {
          drawBackground("#020916","#02030b");
          const baseY=height*.76, rings=lowPerformance?10:17, maxR=Math.min(width*.47,height*.65);
          const floor=ctx.createLinearGradient(0,baseY-maxR,0,height);
          floor.addColorStop(0,"rgba(5,18,45,0)");floor.addColorStop(1,"rgba(5,20,42,.72)");
          ctx.fillStyle=floor;ctx.fillRect(0,baseY-maxR,width,height-baseY+maxR);
          for(let r=rings;r>=1;r--){
            const p=r/rings, radius=maxR*p, amp=(.8+energy*1.9)*(1-p*.35);
            ctx.beginPath();ctx.ellipse(cx,baseY,radius,radius*.24,0,0,TAU);
            const hue=178+p*115;
            ctx.strokeStyle="hsla("+hue+",100%,"+(52+energy*20)+"%,"+(0.2+(1-p)*.62)+")";
            ctx.lineWidth=1.1+energy*1.2;ctx.shadowBlur=glow?10:0;ctx.shadowColor="hsla("+hue+",100%,65%,.8)";ctx.stroke();ctx.shadowBlur=0;
          }
          const bars=lowPerformance?56:112;
          for(let i=0;i<bars;i++){
            const p=i/bars, val=spectrumValue(i,bars), x=(p-.5)*width*.84;
            const h=val*height*(.24+energy*.24);
            const grad=ctx.createLinearGradient(0,baseY-h,0,baseY);
            grad.addColorStop(0,"rgba(120,255,255,.98)");grad.addColorStop(1,"rgba(150,70,255,.08)");
            ctx.fillStyle=grad;ctx.fillRect(cx+x-1,baseY-h,Math.max(1,width/bars*.55),h);
          }
          const core=ctx.createRadialGradient(cx,baseY,1,cx,baseY,short*.12);
          core.addColorStop(0,"#fff");core.addColorStop(.12,"#b8ffff");core.addColorStop(.38,"rgba(50,220,255,.75)");core.addColorStop(1,"rgba(50,80,255,0)");
          ctx.fillStyle=core;ctx.beginPath();ctx.arc(cx,baseY,short*.12,0,TAU);ctx.fill();
          label("RESONANCE RINGS  /  LOW TO HIGH"); break;
        }

        case "a2": {
          drawBackground("#03040f","#07001b");
          const inner=short*.19, rings=lowPerformance?2:3, bars=lowPerformance?72:144;
          for(let ring=0;ring<rings;ring++){
            const r0=inner+ring*short*.075, r1=r0+short*.052;
            for(let i=0;i<bars;i++){
              const val=spectrumValue(i,bars), angle=i/bars*TAU-Math.PI/2;
              const pulse=val*(short*.07)+short*.012;
              const r=r1+pulse;
              const hue=(i/bars)*300+20;
              ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);
              ctx.fillStyle="hsla("+hue+",100%,"+(54+val*24)+"%,"+(.5+val*.5)+")";
              ctx.shadowBlur=glow?8+val*9:0;ctx.shadowColor="hsla("+hue+",100%,65%,.9)";
              const w=Math.max(2,short*.008);
              ctx.fillRect(-w/2,-r,w,Math.max(2,r-r0));ctx.restore();
            }
          }
          const core=ctx.createRadialGradient(cx-short*.025,cy-short*.03,2,cx,cy,inner*.92);
          core.addColorStop(0,"#1b36ff");core.addColorStop(.62,"#0626d6");core.addColorStop(1,"rgba(0,20,100,.8)");
          ctx.fillStyle=core;ctx.beginPath();ctx.arc(cx,cy,inner*.88,0,TAU);ctx.fill();
          ctx.strokeStyle="rgba(100,150,255,.2)";ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,inner*.9,0,TAU);ctx.stroke();
          label("CHROMATIC RADIAL EQUALIZER"); break;
        }

        case "a3": {
          drawBackground("#03141c","#020b17");
          const radius=short*.24, points=lowPerformance?180:360;
          ctx.save();ctx.translate(cx,cy);
          for(let ring=0;ring<4;ring++){
            ctx.beginPath();ctx.ellipse(0,0,radius*(.72+ring*.13),radius*(.9+ring*.12),t*(ring%2?-.025:.02),0,TAU);
            ctx.strokeStyle="rgba(70,230,220,"+(0.2-ring*.035)+")";ctx.lineWidth=1;ctx.stroke();
          }
          const contour=[];
          for(let i=0;i<points;i++){
            const a=i/points*TAU, val=spectrumValue(i,points), wobble=1+val*.42+Math.sin(a*7+t*1.4)*.025;
            contour.push({x:Math.cos(a)*radius*wobble,y:Math.sin(a)*radius*1.18*wobble,val,a});
          }
          ctx.beginPath();contour.forEach((p,i)=>{if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.closePath();
          const orb=ctx.createRadialGradient(-radius*.28,-radius*.3,2,0,0,radius*1.5);
          orb.addColorStop(0,"rgba(125,255,235,.28)");orb.addColorStop(.55,"rgba(25,170,165,.13)");orb.addColorStop(1,"rgba(0,40,65,.02)");
          ctx.fillStyle=orb;ctx.fill();
          ctx.strokeStyle="rgba(80,255,226,.8)";ctx.lineWidth=1.2;ctx.shadowBlur=glow?15:0;ctx.shadowColor="#42ffe0";ctx.stroke();ctx.shadowBlur=0;
          const particles=lowPerformance?220:420;
          for(let i=0;i<particles;i++){
            const a=i*2.399963+t*(i%2?.08:-.06), seed=(Math.sin(i*127.1)*43758.5)%1;
            const r=radius*(.08+Math.abs(seed)*.96), val=spectrumValue(i%count,count);
            const x=Math.cos(a)*r*(.65+val*.5),y=Math.sin(a)*r*1.12;
            const size=.5+(i%4)*.45+val*1.2;
            ctx.fillStyle="hsla("+(165+(i%70))+",100%,"+(62+val*28)+"%,"+(.25+val*.65)+")";
            ctx.fillRect(x,y,size,size);
          }
          for(let i=0;i<40;i++){
            const a=i/40*TAU, r=radius*(1.38+(i%4)*.035);
            ctx.strokeStyle="rgba(80,230,220,.42)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*(r+5+(i%3)*3),Math.sin(a)*(r+5+(i%3)*3));ctx.stroke();
          }
          ctx.restore();label("PARTICLE FIELD  /  STEREO ENERGY");break;
        }

        case "a4": {
          drawBackground("#080502","#100803");
          const rows=v.spectrogram, rowCount=lowPerformance?44:88, cols=rows[0]?rows[0].length/2:48;
          const gap=height*.035, paneH=(height-gap)*.5;
          const heat=(value)=> {
            const q=clamp(value*1.55,0,1);
            if(q<.25)return [35+q*500,8+q*110,0];
            if(q<.58)return [160+q*160,65+q*90,0];
            if(q<.82)return [255,155+(q-.58)*360,10];
            return [255,242+(q-.82)*70,110+(q-.82)*145];
          };
          for(let pane=0;pane<2;pane++){
            const top=pane*(paneH+gap);
            ctx.fillStyle="rgba(0,0,0,.42)";ctx.fillRect(0,top,width,paneH);
            for(let r=0;r<rowCount;r++){
              const row=rows[Math.min(rows.length-1,Math.floor(r/rowCount*Math.max(1,rows.length)))];
              if(!row)continue;
              for(let c=0;c<cols;c++){
                const val=row[pane*cols+c]||0, rgb=heat(val), x=c*width/cols, y=top+paneH-(r+1)*paneH/rowCount;
                const alpha=.12+val*.9;
                ctx.fillStyle="rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+alpha+")";
                ctx.fillRect(x,y,width/cols+.55,paneH/rowCount+.5);
              }
            }
            ctx.strokeStyle="rgba(255,190,90,.16)";ctx.lineWidth=1;ctx.strokeRect(.5,top+.5,width-1,paneH-1);
            ctx.fillStyle="rgba(255,210,150,.4)";ctx.font="8px system-ui";ctx.fillText(pane===0?"LEFT  /  SPECTRUM HISTORY":"RIGHT  /  SPECTRUM HISTORY",8,top+11);
          }
          label("DUAL SPECTROGRAM  /  AMBER INTENSITY");break;
        }

        case "a5": {
          drawBackground("#020715","#02030c");
          const lanes=[
            {data:leftLevelData||waveTimeData,color:"#36dfff",amp:.34,phase:0},
            {data:rightLevelData||waveTimeData,color:"#f052d2",amp:.25,phase:1.7}
          ];
          for(let layer=4;layer>=0;layer--){
            for(const lane of lanes){
              const offset=(layer-2)*height*.055;
              glowLine(()=>{
                for(let i=0;i<count*2;i++){
                  const p=i/(count*2-1), x=p*width;
                  const s=sample(lane.data,p);
                  const harmonic=Math.sin(p*TAU*2.4+t*1.8+lane.phase)*(.06+mid*.1);
                  const y=cy+offset-(s*height*lane.amp*(1+layer*.055)+harmonic*height);
                  if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
                }
              },lane.color,layer===2?2.4:1.1,layer===2?20:8);
            }
          }
          for(let i=0;i<18;i++){
            const x=(i/17)*width, val=spectrumValue(i,18);
            ctx.strokeStyle="rgba(90,190,255,"+(.08+val*.18)+")";ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(x,cy-height*.43);ctx.lineTo(x,cy+height*.43);ctx.stroke();
          }
          label("NEON STEREO WAVE  /  L + R");break;
        }

        case "a6": {
          drawBackground("#100607","#050208");
          const radius=short*.29, strands=lowPerformance?38:76, steps=lowPerformance?28:52;
          ctx.save();ctx.translate(cx,cy);
          for(let ring=0;ring<5;ring++){
            ctx.beginPath();ctx.ellipse(0,0,radius*(.78+ring*.1),radius*(.72+ring*.08),ring*.19,0,TAU);
            ctx.strokeStyle="rgba(255,95,48,"+(0.08+energy*.08)+")";ctx.lineWidth=1;ctx.stroke();
          }
          for(let s=0;s<strands;s++){
            const seed=s*2.399963, phase=t*(.18+(s%7)*.025)+seed;
            ctx.beginPath();
            for(let j=0;j<steps;j++){
              const p=j/(steps-1), a=phase+p*TAU*(2+(s%5)), wave=sample(freq,p);
              const r=radius*(.08+p*.82)*(1+wave*.35+Math.sin(a*3+t)*.055);
              const x=Math.cos(a)*r, y=Math.sin(a)*r*(.72+mid*.2);
              if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y);
            }
            const hue=12+(s%24)*1.2;
            ctx.strokeStyle="hsla("+hue+",100%,"+(52+(s%4)*7)+"%,"+(.12+energy*.24)+")";
            ctx.lineWidth=.7+(s%4)*.35;ctx.shadowBlur=glow?8:0;ctx.shadowColor="#ff6b31";ctx.stroke();
          }
          const core=ctx.createRadialGradient(0,0,2,0,0,radius*.75);
          core.addColorStop(0,"rgba(255,230,180,.95)");core.addColorStop(.12,"rgba(255,130,65,.72)");core.addColorStop(.55,"rgba(200,45,25,.16)");core.addColorStop(1,"rgba(90,10,20,0)");
          ctx.fillStyle=core;ctx.beginPath();ctx.arc(0,0,radius*.75,0,TAU);ctx.fill();
          ctx.restore();
          ctx.strokeStyle="rgba(255,120,90,.22)";ctx.lineWidth=1;
          ctx.beginPath();ctx.moveTo(width*.08,cy);ctx.lineTo(width*.92,cy);ctx.moveTo(cx,height*.1);ctx.lineTo(cx,height*.9);ctx.stroke();
          label("EMBER ORBIT  /  FREQUENCY PARTICLES");break;
        }

        case "a7": {
          drawBackground("#04101b","#020610");
          const n=lowPerformance?24:42, baseY=height*.78, baseW=width*.76, depth=height*.55;
          ctx.save();
          const floor=ctx.createLinearGradient(0,baseY,0,height);
          floor.addColorStop(0,"rgba(10,65,90,.2)");floor.addColorStop(1,"rgba(0,5,15,0)");
          ctx.fillStyle=floor;ctx.fillRect(0,baseY,width,height-baseY);
          for(let k=0;k<7;k++){
            const y=baseY+(k/6)*height*.2;
            ctx.strokeStyle="rgba(55,210,220,"+(0.22-k*.025)+")";ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(width*.06,y);ctx.lineTo(width*.94,y);ctx.stroke();
          }
          for(let i=0;i<=12;i++){
            const x=width*.12+i/12*width*.76;
            ctx.strokeStyle="rgba(45,185,210,.22)";ctx.beginPath();ctx.moveTo(cx+(x-cx)*.35,baseY-depth*.8);ctx.lineTo(x,height);ctx.stroke();
          }
          for(let i=0;i<n;i++){
            const val=spectrumValue(i,n), p=i/(n-1), x=width*.12+p*baseW;
            const barW=baseW/n*.62, h=height*(.05+val*.5);
            const perspective=.55+p*.45, top=baseY-h*perspective;
            const hue=185+p*170;
            const g=ctx.createLinearGradient(x,top,x,baseY);
            g.addColorStop(0,"hsla("+hue+",100%,80%,1)");
            g.addColorStop(.5,"hsla("+hue+",100%,55%,.98)");
            g.addColorStop(1,"hsla("+hue+",100%,25%,.78)");
            ctx.fillStyle=g;ctx.shadowBlur=glow?10:0;ctx.shadowColor="hsla("+hue+",100%,65%,.7)";
            ctx.fillRect(x,top,barW,h*perspective);ctx.shadowBlur=0;
            ctx.fillStyle="hsla("+hue+",100%,70%,.12)";ctx.fillRect(x,baseY,barW,height*.15);
          }
          ctx.restore();label("PERSPECTIVE SPECTRUM  /  RGB BARS");break;
        }

        case "a8": {
          drawBackground("#080d1c","#030817");
          const lanes=[
            {data:leftLevelData||waveTimeData,y:height*.29,color:"#ffd52a",name:"L"},
            {data:rightLevelData||waveTimeData,y:height*.73,color:"#ffd52a",name:"R"}
          ];
          for(const lane of lanes){
            ctx.fillStyle="rgba(255,255,255,.025)";ctx.fillRect(0,lane.y-height*.18,width,height*.36);
            ctx.strokeStyle="rgba(150,180,210,.12)";ctx.lineWidth=1;
            ctx.beginPath();ctx.moveTo(0,lane.y);ctx.lineTo(width,lane.y);ctx.stroke();
            glowLine(()=>{
              for(let i=0;i<count*2;i++){
                const p=i/(count*2-1), x=p*width, s=sample(lane.data,p);
                const envelope=.25+Math.abs(s)*.75;
                const y=lane.y-s*height*(.09+energy*.12)*envelope;
                if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
              }
            },lane.color,1.35,7);
            ctx.fillStyle="rgba(255,220,75,.55)";ctx.font="600 9px system-ui";ctx.fillText(lane.name,8,lane.y-height*.12);
          }
          const centerX=width*.5, impulse=clamp(low*.85+mid*.25,0,1);
          const spikeW=Math.max(12,width*.065);
          const green=ctx.createLinearGradient(centerX-spikeW,0,centerX+spikeW,0);
          green.addColorStop(0,"rgba(255,215,35,0)");green.addColorStop(.5,"rgba(120,255,45,.8)");green.addColorStop(1,"rgba(255,215,35,0)");
          ctx.fillStyle=green;ctx.fillRect(centerX-spikeW,height*.1,spikeW*2,height*.8);
          for(const lane of lanes){
            const s=sample(lane.data,.5);
            ctx.beginPath();ctx.moveTo(centerX-spikeW,lane.y);ctx.lineTo(centerX,lane.y-s*height*.13);ctx.lineTo(centerX+spikeW,lane.y);
            ctx.strokeStyle="rgba(100,255,70,.9)";ctx.lineWidth=2;ctx.stroke();
          }
          label("DUAL CHANNEL OSCILLOSCOPE");break;
        }

        default: {
          drawBackground("#02060c","#03010a");
          const rows=v.history, rowCount=lowPerformance?13:25, colCount=lowPerformance?24:48;
          for(let r=0;r<rowCount;r++){
            const row=rows[Math.min(rows.length-1,Math.floor(r/rowCount*Math.max(1,rows.length)))];
            if(!row)continue;
            ctx.beginPath();
            for(let c=0;c<colCount;c++){
              const x=c/(colCount-1)*width, y=height*.85-row[c/(colCount-1)* (row.length-1)|0]*height*.5-r*height*.012;
              if(!c)ctx.moveTo(x,y);else ctx.lineTo(x,y);
            }
            ctx.strokeStyle="rgba(50,240,190,.4)";ctx.lineWidth=1;ctx.stroke();
          }
          break;
        }
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
        ["waveSection", "〰️", "波形", "3D・2Dを含む全10種類の波形表示から選択"],
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

  function updateAppLoadingProgress(percent, message, immediate = false) {
    if (typeof window.__musicPlayerUpdateStartupProgress === "function") {
      window.__musicPlayerUpdateStartupProgress(percent, message, immediate);
      return;
    }
    appLoadingTargetProgress = Math.max(appLoadingDisplayedProgress, Math.min(100, Math.round(percent)));
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (messageText && message) messageText.textContent = message;

    if (immediate) {
      if (appLoadingProgressTimer !== null) clearTimeout(appLoadingProgressTimer);
      appLoadingProgressTimer = null;
      appLoadingDisplayedProgress = appLoadingTargetProgress;
      if (fill) fill.style.width = appLoadingDisplayedProgress + "%";
      if (percentText) percentText.textContent = appLoadingDisplayedProgress + "%";
      return;
    }

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
          }, 4);
        } else {
          appLoadingProgressTimer = null;
        }
      };
      step();
    }
  }

  function revealAppAfterHomeReady() {
    updateAppLoadingProgress(100, "ホーム画面を表示します...", true);
    const screen = document.getElementById("appLoadingScreen");
    if (!screen) return;
    document.body.classList.remove("app-loading");
    screen.remove();
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
