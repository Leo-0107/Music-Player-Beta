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
      const v = drawWave._visualizerV3 || (drawWave._visualizerV3 = { history: [], lastSample: 0, peaks: null, shocks: [], lastBass: 0 });
      const t = now * 0.001, cx = width * 0.5, cy = height * 0.5, short = Math.min(width, height);
      const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
      if (analyser && waveTimeData) {
        if (isPlaying) analyser.getByteTimeDomainData(waveTimeData);
        else for (let i = 0; i < waveTimeData.length; i++) waveTimeData[i] += (128 - waveTimeData[i]) * 0.16;
      }
      if (waveLeftOutputAnalyser && waveLeftOutputData) {
        if (isPlaying) waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
        else for (let i = 0; i < waveLeftOutputData.length; i++) waveLeftOutputData[i] *= 0.86;
      }
      if (waveRightOutputAnalyser && waveRightOutputData) {
        if (isPlaying) waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);
        else for (let i = 0; i < waveRightOutputData.length; i++) waveRightOutputData[i] *= 0.86;
      }
      if (leftLevelAnalyser && leftLevelData) {
        if (isPlaying) leftLevelAnalyser.getByteTimeDomainData(leftLevelData);
        else for (let i = 0; i < leftLevelData.length; i++) leftLevelData[i] += (128 - leftLevelData[i]) * 0.16;
      }
      if (rightLevelAnalyser && rightLevelData) {
        if (isPlaying) rightLevelAnalyser.getByteTimeDomainData(rightLevelData);
        else for (let i = 0; i < rightLevelData.length; i++) rightLevelData[i] += (128 - rightLevelData[i]) * 0.16;
      }

      const lf = waveLeftOutputData && waveLeftOutputData.length ? waveLeftOutputData : analyserData;
      const rf = waveRightOutputData && waveRightOutputData.length ? waveRightOutputData : lf;
      const avg = (data, from, to) => {
        if (!data || !data.length) return 0;
        const lo = clamp(Math.floor(from * data.length), 0, data.length - 1);
        const hi = clamp(Math.ceil(to * data.length), lo + 1, data.length);
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += (data[i] || 0) / 255;
        return sum / (hi - lo);
      };
      const spec = (i, n, channel) => {
        const data = channel === "L" ? lf : channel === "R" ? rf : null;
        if (data) return avg(data, i / n, (i + 1) / n);
        return (avg(lf, i / n, (i + 1) / n) + avg(rf, i / n, (i + 1) / n)) * 0.5;
      };
      const sample = (data, p) => {
        if (!data || !data.length) return 0;
        return ((data[clamp(Math.floor(p * (data.length - 1)), 0, data.length - 1)] || 128) - 128) / 128;
      };
      const low = avg(lf, 0, 0.18) * 0.5 + avg(rf, 0, 0.18) * 0.5;
      const middle = avg(lf, 0.18, 0.58) * 0.5 + avg(rf, 0.18, 0.58) * 0.5;
      const high = avg(lf, 0.58, 1) * 0.5 + avg(rf, 0.58, 1) * 0.5;
      const energy = (low + middle + high) / 3;
      if (isPlaying && now - v.lastSample > (lowPerformance ? 130 : 68)) {
        const row = new Float32Array(lowPerformance ? 32 : 56);
        for (let i = 0; i < row.length; i++) row[i] = spec(i, row.length);
        v.history.unshift(row);
        if (v.history.length > (lowPerformance ? 20 : 36)) v.history.length = lowPerformance ? 20 : 36;
        v.lastSample = now;
      }

      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#050914"); bg.addColorStop(0.52, "#0a1221"); bg.addColorStop(1, "#110b1e");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
      const tag = text => {
        ctx.save(); ctx.font = "600 9px system-ui,sans-serif"; ctx.textAlign = "left";
        ctx.fillStyle = "rgba(205,228,248,.55)"; ctx.fillText(text, 10, 16); ctx.restore();
      };
      const trace = (data, center, amp, color, fill, widthPx) => {
        if (!data || !data.length) return;
        const n = lowPerformance ? 64 : 120;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p = i / (n - 1);
          const y = center - sample(data, p) * amp;
          if (!i) ctx.moveTo(p * width, y); else ctx.lineTo(p * width, y);
        }
        if (fill) {
          ctx.lineTo(width, center); ctx.lineTo(0, center); ctx.closePath();
          ctx.fillStyle = fill; ctx.fill();
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const p = i / (n - 1), y = center - sample(data, p) * amp;
            if (!i) ctx.moveTo(p * width, y); else ctx.lineTo(p * width, y);
          }
        }
        ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
      };

      switch (state.waveMode) {
        case "a1": {
          const amp = height * (0.22 + energy * 0.2);
          const layers = [{ y: -height * .14, s: .55, h: 190 }, { y: 0, s: 1, h: 278 }, { y: height * .14, s: .62, h: 35 }];
          ctx.save(); ctx.globalCompositeOperation = "screen";
          for (let l = 0; l < layers.length; l++) {
            const q = layers[l], grad = ctx.createLinearGradient(0, 0, width, 0);
            grad.addColorStop(0, "hsla(" + q.h + ",100%,65%,.08)");
            grad.addColorStop(.5, "hsla(" + (q.h + 30) + ",100%,72%,.72)");
            grad.addColorStop(1, "hsla(" + (q.h + 70) + ",100%,65%,.06)");
            ctx.beginPath();
            const n = lowPerformance ? 70 : 128;
            for (let i = 0; i < n; i++) {
              const p = i / (n - 1), ripple = Math.sin(p * 13 + t * 1.5 + l) * amp * .1;
              const y = cy + q.y - sample(waveTimeData, p) * amp * q.s - ripple * (.5 + spec(Math.floor(p * 60), 60));
              if (!i) ctx.moveTo(p * width, y); else ctx.lineTo(p * width, y);
            }
            ctx.strokeStyle = grad; ctx.lineWidth = (l === 1 ? 4 : 2) + energy * 2;
            ctx.shadowBlur = lowPerformance ? 0 : 16; ctx.shadowColor = "hsla(" + q.h + ",100%,65%,.8)"; ctx.stroke();
          }
          ctx.restore(); tag("AURORA STREAM"); break;
        }
        case "a2": {
          const n = lowPerformance ? 28 : 48, gap = Math.max(2, width / n * .17), bw = width / n - gap, base = height * .88;
          if (!v.peaks || v.peaks.length !== n) v.peaks = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const value = spec(i, n);
            v.peaks[i] = Math.max(value, v.peaks[i] - dt * .38);
            const h = Math.max(2, value * height * .7), x = i * width / n + gap * .5, hue = 174 + i / n * 155;
            const g = ctx.createLinearGradient(0, base - h, 0, base);
            g.addColorStop(0, "hsla(" + hue + ",100%,82%,1)");
            g.addColorStop(.5, "hsla(" + hue + ",95%,54%,.96)");
            g.addColorStop(1, "hsla(" + (hue + 22) + ",90%,28%,.92)");
            ctx.fillStyle = g; ctx.fillRect(x, base - h, bw, h);
            ctx.fillStyle = "hsla(" + hue + ",100%,86%,.9)";
            ctx.fillRect(x, base - v.peaks[i] * height * .7 - 2, bw, 2);
          }
          tag("CHROMA EQUALIZER"); break;
        }
        case "a3": {
          const top = height * .28, bottom = height * .72, amp = height * .29;
          ctx.strokeStyle = "rgba(205,225,245,.16)"; ctx.setLineDash([3, 6]);
          [top, bottom].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); });
          ctx.setLineDash([]);
          trace(leftLevelData, top, amp, "rgba(90,225,255,.98)", "rgba(30,190,255,.12)", 2);
          trace(rightLevelData, bottom, amp, "rgba(220,145,255,.98)", "rgba(190,90,255,.12)", 2);
          tag("LEFT CHANNEL"); ctx.save(); ctx.font = "600 9px system-ui,sans-serif"; ctx.fillStyle = "rgba(205,228,248,.55)"; ctx.fillText("RIGHT CHANNEL", 10, height - 8); ctx.restore();
          break;
        }
        case "a4": {
          const rows = v.history, rowH = height / Math.max(1, lowPerformance ? 20 : 36), cols = rows.length ? rows[0].length : 32;
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r], y = height - (r + 1) * rowH;
            for (let c = 0; c < row.length; c++) {
              const x = c * width / cols, value = row[c], hue = 228 - value * 205 + c / cols * 22;
              ctx.fillStyle = "hsla(" + hue + ",94%," + (12 + value * 54) + "%," + (.2 + value * .8) + ")";
              ctx.fillRect(x, y, width / cols + .6, rowH + .5);
            }
          }
          tag("SPECTRUM TIMELINE  •  NEWEST AT BOTTOM"); break;
        }
        case "a5": {
          const count = lowPerformance ? 64 : 112, inner = short * .12;
          ctx.save(); ctx.translate(cx, cy);
          for (let ring = 0; ring < 4; ring++) {
            ctx.beginPath(); ctx.arc(0, 0, inner + ring * short * .065, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(185,215,245," + (.1 + ring * .025) + ")"; ctx.lineWidth = 1; ctx.stroke();
          }
          for (let i = 0; i < count; i++) {
            const p = i / count, value = spec(i, count), angle = p * Math.PI * 2 - Math.PI / 2;
            const r1 = inner + short * .06, r2 = r1 + 4 + value * short * .3, hue = 180 + p * 160;
            ctx.beginPath(); ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
            ctx.lineTo(Math.cos(angle) * r2, Math.sin(angle) * r2);
            ctx.strokeStyle = "hsla(" + hue + ",100%," + (56 + value * 25) + "%," + (.35 + value * .65) + ")";
            ctx.lineWidth = 1 + value * 2.2; ctx.lineCap = "round"; ctx.stroke();
          }
          const core = ctx.createRadialGradient(0, 0, 1, 0, 0, inner * 1.25);
          core.addColorStop(0, "rgba(255,255,255,.95)"); core.addColorStop(.3, "rgba(80,230,255,.72)"); core.addColorStop(1, "rgba(60,90,230,0)");
          ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, inner * 1.25, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); tag("PRISM COMPASS"); break;
        }
        case "a6": {
          const orbit = short * .22, coreR = short * (.055 + low * .04);
          ctx.save(); ctx.translate(cx, cy);
          const core = ctx.createRadialGradient(-coreR * .3, -coreR * .3, 1, 0, 0, coreR * 1.8);
          core.addColorStop(0, "#fff"); core.addColorStop(.25, "rgba(115,245,255,.95)"); core.addColorStop(.65, "rgba(65,120,255,.5)"); core.addColorStop(1, "rgba(60,70,255,0)");
          ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, coreR * 1.8, 0, Math.PI * 2); ctx.fill();
          for (let k = 0; k < 3; k++) {
            const rx = orbit + k * short * .06, ry = orbit * (.35 + k * .1), rot = t * (k % 2 ? -.2 : .16) + k * 1.1;
            ctx.save(); ctx.rotate(rot);
            ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "hsla(" + (185 + k * 48) + ",100%,72%," + (.65 - k * .12) + ")"; ctx.lineWidth = 1.5 + middle; ctx.stroke();
            const a = t * (1 + k * .25) + k * 2.1;
            ctx.beginPath(); ctx.arc(Math.cos(a) * rx, Math.sin(a) * ry, 3 + high * 3, 0, Math.PI * 2);
            ctx.fillStyle = "hsla(" + (190 + k * 48) + ",100%,82%,.98)"; ctx.fill();
            ctx.restore();
          }
          ctx.restore(); tag("ATOMIC RESONANCE"); break;
        }
        case "a7": {
          if (isPlaying && low > .22 && low - v.lastBass > .055) v.shocks.push({ r: short * .035, life: 1, strength: low });
          v.lastBass = low;
          for (let i = v.shocks.length - 1; i >= 0; i--) {
            const q = v.shocks[i]; q.r += dt * short * (.48 + q.strength * .5); q.life -= dt * .5;
            if (q.life <= 0 || q.r > short * .9) v.shocks.splice(i, 1);
          }
          ctx.save(); ctx.translate(cx, cy);
          for (let i = 0; i < v.shocks.length; i++) {
            const q = v.shocks[i]; ctx.beginPath(); ctx.arc(0, 0, q.r, 0, Math.PI * 2);
            ctx.strokeStyle = "hsla(" + (185 + q.strength * 70) + ",100%,72%," + q.life * .8 + ")";
            ctx.lineWidth = 1 + q.life * 3; ctx.shadowBlur = lowPerformance ? 0 : 12; ctx.stroke();
          }
          const count = Math.min(Math.max(0, Number(state.waveParticleCount) || 0), lowPerformance ? 220 : 900);
          for (let i = 0; i < count; i++) {
            const seed = i * .61803398875, phase = (t * (.035 + i % 7 * .004) + seed) % 1;
            const angle = seed * Math.PI * 2 + t * (.07 + i % 5 * .012);
            const radius = short * (.05 + phase * .43) * (1 + low * .22);
            const size = 1 + i % 3 * .5 + energy;
            ctx.fillStyle = "hsla(" + (185 + i % 120) + ",100%,78%," + (.25 + phase * .6) + ")";
            ctx.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, size, size);
          }
          ctx.restore(); tag("STARDUST BURST"); break;
        }
        case "a8": {
          const left = leftLevelData || waveTimeData, right = rightLevelData || waveTimeData;
          ctx.strokeStyle = "rgba(190,220,245,.16)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx, 12); ctx.lineTo(cx, height - 12); ctx.moveTo(12, cy); ctx.lineTo(width - 12, cy); ctx.stroke();
          const n = lowPerformance ? 72 : 136, sx = width * .4, sy = height * .4;
          ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const p = i / (n - 1), x = sample(left, p) * sx, y = -sample(right, p) * sy;
            if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(90,190,255,.2)";
          ctx.lineWidth = 7; ctx.shadowBlur = lowPerformance ? 0 : 15; ctx.shadowColor = "rgba(90,190,255,.7)"; ctx.stroke();
          ctx.shadowBlur = 0;
          const g = ctx.createLinearGradient(-sx, sy, sx, -sy);
          g.addColorStop(0, "#55e6d4"); g.addColorStop(.5, "#e0a2ff"); g.addColorStop(1, "#fff0a2");
          ctx.strokeStyle = g; ctx.lineWidth = 1.8; ctx.stroke(); ctx.restore();
          tag("STEREO PHASE  /  L × R"); break;
        }
        case "3d":
        default: {
          const rows = v.history, rowCount = lowPerformance ? 10 : 17, colCount = lowPerformance ? 18 : 30, points = [];
          for (let r = 0; r < rowCount; r++) {
            const ri = Math.min(rows.length - 1, Math.floor(r * Math.max(1, rows.length - 1) / Math.max(1, rowCount - 1)));
            const row = rows[ri] || null, line = [];
            for (let c = 0; c < colCount; c++) {
              const value = row ? row[Math.min(row.length - 1, Math.floor(c * (row.length - 1) / Math.max(1, colCount - 1)))] : 0;
              const x = (c / (colCount - 1) - .5) * width * .84;
              const depth = (r / (rowCount - 1) - .5) * height * .68;
              line.push(applyWaveView({ x: cx + x, y: value * height * .34, depth: depth, fitScale: 1 }, width, height));
            }
            points.push(line);
          }
          for (let r = rowCount - 2; r >= 0; r--) {
            for (let c = 0; c < colCount - 1; c++) {
              const p1 = points[r][c], p2 = points[r][c + 1], p3 = points[r + 1][c + 1], p4 = points[r + 1][c];
              const value = rows.length && rows[r] ? rows[r][Math.min(rows[r].length - 1, c)] : 0;
              const hue = 184 + value * 112;
              ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
              ctx.fillStyle = "hsla(" + hue + ",92%," + (18 + value * 34) + "%,.82)"; ctx.fill();
              ctx.strokeStyle = "hsla(" + (hue + 10) + ",100%,75%,.5)"; ctx.lineWidth = lowPerformance ? .7 : .9; ctx.stroke();
            }
          }
          for (let r = 0; r < rowCount; r += 2) {
            ctx.beginPath();
            for (let c = 0; c < colCount; c++) { const p = points[r][c]; if (!c) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
            ctx.strokeStyle = "rgba(185,230,255,.48)"; ctx.lineWidth = .8; ctx.stroke();
          }
          tag("3D SPECTRUM TERRAIN"); break;
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
