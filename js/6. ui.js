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
    if (sleepTimerPendingStop) {
      sleepTimerPendingStop = false;
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

  function setSleepTimer(minutes) {
    if (sleepTimerId) clearTimeout(sleepTimerId);
    if (sleepIntervalId) clearInterval(sleepIntervalId);
    sleepTimerId = null;
    sleepIntervalId = null;
    sleepTimerPendingStop = false;

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

          // 案1は常に画面中央を基準にする。無音時も中央線上に留める。
          const centerY = height * 0.5;
          const amplitudeScale = height * 0.78;
          const visualGain = 1.9;

          ctx.beginPath();
          for (let i = 0; i < waveTimeData.length; i++) {
            const x = (i / Math.max(1, waveTimeData.length - 1)) * width;
            const sample = (waveTimeData[i] - 128) / 128;
            const amplifiedSample = Math.max(-1, Math.min(1, sample * visualGain));
            const y = centerY - amplifiedSample * amplitudeScale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "rgba(95, 214, 255, 0.92)";
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();

          ctx.strokeStyle = "rgba(255,255,255,0.14)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
        }
      } else if (state.waveMode === "a2") {
        // 案2: 左右いっぱいに周波数バーを並べ、実際の出力レベルで上下させる。
        const bars = Math.min(64, waveLeftOutputAnalyser?.frequencyBinCount || 64);
        const gap = Math.max(1, width * 0.006);
        const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
        const maxBarHeight = height * 0.86;
        const baseY = height * 0.92;

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          if (!waveLeftOutputAnalyser._a2Smooth || waveLeftOutputAnalyser._a2Smooth.length !== bars) {
            waveLeftOutputAnalyser._a2Smooth = new Float32Array(bars);
          }

          const smooth = waveLeftOutputAnalyser._a2Smooth;

          for (let i = 0; i < bars; i++) {
            const startBin = Math.floor(Math.pow(i / bars, 1.35) * waveLeftOutputData.length);
            const endBin = Math.min(
              waveLeftOutputData.length,
              Math.max(startBin + 1, Math.floor(Math.pow((i + 1) / bars, 1.35) * waveLeftOutputData.length))
            );

            let level = 0;
            for (let k = startBin; k < endBin; k++) {
              const left = (waveLeftOutputData[k] || 0) / 255;
              const right = (waveRightOutputData[k] || 0) / 255;
              level = Math.max(level, (left + right) * 0.5);
            }

            const target = Math.min(1, level * 1.8);
            smooth[i] += (target - smooth[i]) * (isPlaying ? 0.22 : 0.12);

            const barHeight = Math.max(1, smooth[i] * maxBarHeight);
            const x = i * (barWidth + gap);

            ctx.fillStyle = "rgba(95, 214, 255, 0.88)";
            ctx.fillRect(x, baseY - barHeight, barWidth, barHeight);
          }

          ctx.strokeStyle = "rgba(255,255,255,0.14)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, baseY);
          ctx.lineTo(width, baseY);
          ctx.stroke();

          ctx.fillStyle = "rgba(255,255,255,0.72)";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("L / R", 8, Math.max(12, baseY - maxBarHeight - 6));
        }
      } else if (state.waveMode === "a3") {
        // 案3: 左右それぞれの波形を残し、バーの見た目と反応は2D波形に合わせる。
        const sideBars = Math.min(36, Math.floor((waveLeftOutputAnalyser?.frequencyBinCount || 36)));
        const centerX = width * 0.5;
        const maxBarHeight = height * 0.86;
        const halfWidth = width * 0.46;
        const barGap = 2;
        const barWidth = Math.max(1, halfWidth / Math.max(1, sideBars) - barGap);
        const stepX = halfWidth / Math.max(1, sideBars);

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          if (!waveLeftOutputAnalyser._spectrumSmooth || waveLeftOutputAnalyser._spectrumSmooth.length !== sideBars) {
            waveLeftOutputAnalyser._spectrumSmooth = new Float32Array(sideBars);
            waveRightOutputAnalyser._spectrumSmooth = new Float32Array(sideBars);
          }

          const leftSmooth = waveLeftOutputAnalyser._spectrumSmooth;
          const rightSmooth = waveRightOutputAnalyser._spectrumSmooth;

          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          const getBandLevel = (data, bandIndex) => {
            const startBin = Math.floor((bandIndex / sideBars) * data.length);
            const endBin = Math.min(
              data.length,
              Math.max(startBin + 1, Math.floor(((bandIndex + 1) / sideBars) * data.length))
            );
            let level = 0;
            for (let i = startBin; i < endBin; i++) {
              level = Math.max(level, (data[i] || 0) / 255);
            }
            return level;
          };

          for (let i = 0; i < sideBars; i++) {
            const leftTarget = isPlaying ? Math.min(1, getBandLevel(waveLeftOutputData, i) * 1.25) : 0;
            const rightTarget = isPlaying ? Math.min(1, getBandLevel(waveRightOutputData, i) * 1.25) : 0;
            const smoothing = isPlaying ? 0.24 : 0.16;

            leftSmooth[i] += (leftTarget - leftSmooth[i]) * smoothing;
            rightSmooth[i] += (rightTarget - rightSmooth[i]) * smoothing;

            const leftHeight = Math.max(1, maxBarHeight * leftSmooth[i]);
            const rightHeight = Math.max(1, maxBarHeight * rightSmooth[i]);

            const distance = (i + 1) * stepX;
            const leftX = centerX - distance;
            const rightX = centerX + distance - barWidth;

            const hue = (i / Math.max(1, sideBars - 1)) * 280 + 120;
            ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.8)`;

            ctx.fillRect(leftX, height - leftHeight, barWidth, leftHeight);
            ctx.fillRect(rightX, height - rightHeight, barWidth, rightHeight);

            ctx.fillStyle = `hsla(${hue}, 100%, 75%, 0.25)`;
            ctx.fillRect(leftX, Math.max(0, height - leftHeight - 4), barWidth, 3);
            ctx.fillRect(rightX, Math.max(0, height - rightHeight - 4), barWidth, 3);
          }
        }

        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 1);
        ctx.lineTo(width, height - 1);
        ctx.stroke();
      } else if (state.waveMode === "a4") {
        const bars = Math.min(72, dataLen);
        const step = dataLen / bars;
        const barGap = 2;
        const waveLeft = width * 0.04;
        const waveWidth = width * 0.92;
        const barWidth = Math.max(1, waveWidth / bars - barGap);

        if (!waveBandBaseline || waveBandBaseline.length !== bars) {
          waveBandBaseline = new Float32Array(bars);
        }

        for (let i = 0; i < bars; i++) {
          const begin = Math.floor(i * step);
          const finish = Math.max(begin + 1, Math.floor((i + 1) * step));
          let level = 0;
          for (let j = begin; j < finish && j < dataLen; j++) {
            level = Math.max(level, waveSmoothData[j]);
          }

          const previous = waveBandBaseline[i];
          const baselineFollow = isPlaying ? 0.018 : 0.08;
          waveBandBaseline[i] += (level - waveBandBaseline[i]) * baselineFollow;

          const change = Math.abs(level - previous);
          const displayLevel = Math.min(1, Math.sqrt(change) * 2.6);
          const barHeight = Math.max(1, height * displayLevel);
          const x = waveLeft + i * (waveWidth / bars);
          const y = height - barHeight;
          const hue = (i / Math.max(1, bars - 1)) * 280 + 120;

          ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.82)`;
          ctx.fillRect(x, y, barWidth, barHeight);
        }

        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(waveLeft, height - 1);
        ctx.lineTo(waveLeft + waveWidth, height - 1);
        ctx.stroke();
      } else if (state.waveMode === "a5") {
        // 案5: 心電図のように、音量を上下の振幅として左から右へ流す。
        const pointCount = Math.max(80, Math.min(180, Math.floor(width / 5)));
        const centerY = height * 0.5;
        const amplitudeScale = height * 0.42;

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
          level = Math.min(1, ((leftRms + rightRms) * 0.5) * 2.4);
        }

        // 新しい音量を右端へ追加し、古い波形を左へ送る。
        const incoming = Math.min(1, level);
        history.copyWithin(0, 1);
        history[history.length - 1] += (incoming - history[history.length - 1]) * (isPlaying ? 0.32 : 0.18);

        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = (i / Math.max(1, history.length - 1)) * width;
          const y = centerY - history[i] * amplitudeScale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = "hsla(195, 90%, 62%, 0.92)";
        ctx.lineWidth = 2.2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        // 中央線を薄く表示し、無音時は中央へ戻ることが分かるようにする。
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.68)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("音量", 8, Math.max(12, centerY - amplitudeScale - 6));
      } else if (state.waveMode === "a6") {
        // 案6: 低・中・高域を3つの動くリングとして表示し、背景の色変化だけで終わらせない。
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

        // 小さい音量差も見えるよう、低いレベルを持ち上げてから表示に使う。
        const enhance = value => Math.min(1, Math.pow(Math.max(0, value), 0.62) * 1.08);
        const low = enhance(bandEnergy(0.01, 0.10));
        const mid = enhance(bandEnergy(0.10, 0.42));
        const high = enhance(bandEnergy(0.42, 0.92));
        const total = Math.min(1, low * 1.65 + mid * 1.3 + high * 1.0);
        const cx = width * 0.5;
        const cy = height * 0.52;
        const baseRadius = Math.min(width, height) * 0.13;

        const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.82);
        bg.addColorStop(0, `hsla(205, 90%, 58%, ${0.06 + total * 0.14})`);
        bg.addColorStop(0.5, `hsla(265, 85%, 58%, ${0.035 + mid * 0.10})`);
        bg.addColorStop(1, `hsla(320, 85%, 58%, ${0.015 + high * 0.07})`);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        const rings = [
          { energy: low, hue: 35, radius: baseRadius * (1.35 + low * 2.7), wobble: height * 0.12, speed: 0.75, tilt: 0.38 },
          { energy: mid, hue: 185, radius: baseRadius * (2.15 + mid * 3.0), wobble: height * 0.10, speed: -0.52, tilt: -0.25 },
          { energy: high, hue: 285, radius: baseRadius * (2.95 + high * 2.6), wobble: height * 0.08, speed: 0.95, tilt: 0.16 }
        ];

        rings.forEach((ring, ringIndex) => {
          const points = 96;
          const phase = now * 0.001 * ring.speed;
          const brightnessWave = 0.5 + 0.5 * Math.sin(now * (0.0010 + ringIndex * 0.00045) * (ringIndex % 2 ? 1.35 : 1) + ringIndex * 1.9);
          const energyBrightness = Math.min(1, ring.energy * 1.45);
          const ringAlpha = 0.12 + energyBrightness * 0.42 + brightnessWave * (0.12 + ring.energy * 0.22);
          const glowAmount = 5 + energyBrightness * 14 + brightnessWave * (7 + ringIndex * 3);
          ctx.beginPath();
          for (let i = 0; i <= points; i++) {
            const t = (i / points) * Math.PI * 2;
            const wave = Math.sin(t * (3 + ringIndex) + phase * 2.2) * ring.wobble * (0.28 + ring.energy * 1.55);
            const pulse = ring.energy * Math.sin(t * 2 - phase * 1.4) * Math.min(width, height) * 0.045;
            const rx = ring.radius + wave + pulse;
            const ry = ring.radius * (0.48 + ring.energy * 0.22) + wave * 0.42;
            const x = cx + Math.cos(t + phase) * rx;
            const y = cy + Math.sin(t + phase * 0.7) * ry + Math.sin(t * 2 + phase) * ring.tilt * ring.energy * 14;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${ring.hue}, 88%, ${55 + brightnessWave * 18}%, ${ringAlpha})`;
          ctx.lineWidth = 1.0 + ring.energy * 2.4 + brightnessWave * (0.5 + ringIndex * 0.25);
          ctx.shadowBlur = glowAmount;
          ctx.shadowColor = `hsla(${ring.hue}, 90%, 62%, 0.45)`;
          ctx.stroke();
          ctx.shadowBlur = 0;
        });

        // 中央の反応体。全帯域の強さに合わせて膨張・収縮する。
        const coreRadius = baseRadius * (0.55 + total * 1.45);
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
        core.addColorStop(0, `hsla(195, 95%, 72%, ${0.10 + total * 0.28})`);
        core.addColorStop(0.7, `hsla(270, 90%, 64%, ${0.04 + total * 0.12})`);
        core.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
        ctx.fill();

        // 低音が強いほど大きく、高音が強いほど細かく見える短い光点。
        const dots = 18;
        for (let i = 0; i < dots; i++) {
          const t = (i / dots) * Math.PI * 2 + now * 0.0004 * (i % 2 ? -1 : 1);
          const orbit = baseRadius * (3.5 + low * 2.5 + high * 0.8);
          const wobble = Math.sin(t * 3 + now * 0.002) * high * 12;
          const x = cx + Math.cos(t) * (orbit + wobble);
          const y = cy + Math.sin(t) * (orbit * 0.52 + wobble * 0.35);
          const size = 0.8 + high * 2.4 + mid * 1.4;
          ctx.fillStyle = `hsla(${210 + i * 7}, 90%, 70%, ${0.20 + total * 0.55})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (state.waveMode === "a7") {
        // 案7: 平面の水面を真上から見て、音で波が奥へ流れていくように表示する。
        const bandCount = Math.max(18, Math.min(34, Math.floor(height / 16)));
        const centerX = width * 0.5;
        const bandSpacing = height / bandCount;

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
        const total = Math.min(1, low * 1.6 + mid * 1.15 + high * 0.9);

        if (isPlaying) {
          drawWave._wave7Flow = (drawWave._wave7Flow || 0) + dt * (34 + total * 48);
        }

        const flow = drawWave._wave7Flow || 0;

        // 水面そのもの。遠近法を使わず、画面全体を同じ平面として描く。
        const surface = ctx.createLinearGradient(0, 0, 0, height);
        surface.addColorStop(0, "rgba(8,18,24,0.20)");
        surface.addColorStop(0.5, "rgba(8,24,30,0.12)");
        surface.addColorStop(1, "rgba(8,18,24,0.20)");
        ctx.fillStyle = surface;
        ctx.fillRect(0, 0, width, height);

        // 波の帯が上から下へ流れる。音が大きいほど波の上下動が大きくなる。
        for (let row = -2; row < bandCount + 3; row++) {
          const yBase = ((row * bandSpacing + flow) % (height + bandSpacing * 3)) - bandSpacing * 1.5;
          const waveAmplitude = height * (0.008 + total * 0.055);
          const frequency = 1.5 + low * 2.2 + high * 1.8;
          const phase = row * 0.72 + flow * 0.018;

          ctx.beginPath();
          const points = 96;
          for (let p = 0; p <= points; p++) {
            const x = (p / points) * width;
            const nx = p / points;
            const wave =
              Math.sin(nx * Math.PI * 2 * frequency + phase) * waveAmplitude +
              Math.sin(nx * Math.PI * 2 * (frequency * 2.1) - phase * 0.7) * waveAmplitude * (0.22 + high * 0.28);
            const y = yBase + wave;
            if (p === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }

          const alpha = 0.10 + total * 0.30;
          ctx.strokeStyle = `hsla(${190 + high * 55}, 82%, ${55 + mid * 18}%, ${alpha})`;
          ctx.lineWidth = 0.8 + total * 1.5;
          ctx.stroke();
        }

        // 音の変化が小さいときも水面の細かな揺れが見えるようにする。
        const detailAmplitude = height * (0.004 + total * 0.022);
        ctx.beginPath();
        const detailPoints = 128;
        for (let p = 0; p <= detailPoints; p++) {
          const x = (p / detailPoints) * width;
          const nx = p / detailPoints;
          const y =
            height * 0.5 +
            Math.sin(nx * Math.PI * 2 * (3.2 + high * 3) + flow * 0.028) * detailAmplitude +
            Math.sin(nx * Math.PI * 2 * 7 - flow * 0.019) * detailAmplitude * 0.35;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(180,225,235,${0.08 + total * 0.18})`;
        ctx.lineWidth = 0.8 + total;
        ctx.stroke();
      } else if (state.waveMode === "a8") {
        // 案8: 心電図風。上=R、下=L、左=現在に近い、右=過去。
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

            const rms = (data) => {
              let sum = 0;
              for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
              }
              return Math.min(1, Math.sqrt(sum / Math.max(1, data.length)) * 2.4);
            };

            const leftLevel = rms(waveLeftOutputAnalyser._wave8TimeData);
            const rightLevel = rms(waveRightOutputAnalyser._wave8TimeData);

            history.unshift({
              left: leftLevel,
              right: rightLevel
            });

            const maxHistory = Math.max(80, Math.ceil(4.5 / sampleInterval));
            if (history.length > maxHistory) history.length = maxHistory;
          }
        } else {
          drawWave._wave8SampleElapsed = 0;
        }

        const centerX = width * 0.5;
        const topBase = height * 0.26;
        const bottomBase = height * 0.76;
        const amplitude = height * 0.23;
        const count = history.length;

        // 中央線を境にR/Lを完全に分離。
        ctx.strokeStyle = "rgba(255,255,255,0.10)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, topBase);
        ctx.lineTo(width, topBase);
        ctx.moveTo(0, bottomBase);
        ctx.lineTo(width, bottomBase);
        ctx.stroke();

        if (count > 1) {
          // 左=現在、右=過去。新しいサンプルほど左に配置する。
          const drawTrace = (key, baseY, direction) => {
            ctx.beginPath();
            for (let i = count - 1; i >= 0; i--) {
              const age = (count - 1 - i) / Math.max(1, count - 1);
              const x = age * width;
              const level = history[i][key] || 0;
              const jitter =
                Math.sin(i * 0.71 + now * 0.003) * level * height * 0.018 +
                Math.sin(i * 1.37 - now * 0.002) * level * height * 0.010;
              const y = baseY + direction * level * amplitude + jitter;
              if (i === count - 1) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = key === "right"
              ? "rgba(255, 145, 145, 0.88)"
              : "rgba(120, 205, 255, 0.88)";
            ctx.lineWidth = 2;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
          };

          drawTrace("right", topBase, -1);
          drawTrace("left", bottomBase, 1);

          // 現在位置を示す細い縦線。
          ctx.strokeStyle = "rgba(255,255,255,0.18)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(1, 0);
          ctx.lineTo(1, height);
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(255,255,255,0.68)";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("R", 8, Math.max(12, topBase - amplitude - 8));
        ctx.fillText("L", 8, Math.min(height - 6, bottomBase + amplitude + 14));
        ctx.textAlign = "right";
        ctx.fillText("現在", Math.min(width - 8, width * 0.04 + 34), height - 8);
        ctx.fillText("過去", width - 8, height - 8);
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
              const hue = 190 + freqRatio * 105;
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
            const hue = 190 + (b / (BANDS_3D - 1)) * 105;
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

            const hue = 190 + (1 - age) * 105;
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
            ctx.strokeStyle = "rgba(245,250,255,0.96)";
            ctx.lineWidth = 2.8;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.shadowBlur = 10;
            ctx.shadowColor = "rgba(120, 210, 255, 0.32)";
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
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
    if (el.btnSideBack) el.btnSideBack.style.display = "none";
    if (el.sideTitle) el.sideTitle.textContent = "メニュー";
  }

  if (el.btnMenu) el.btnMenu.addEventListener("click", openSidebar);
  if (el.btnCloseMenu) el.btnCloseMenu.addEventListener("click", closeSidebar);
  if (el.overlay) el.overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".menuItem").forEach(item => {
    item.addEventListener("click", () => {
      const secId = item.dataset.section;
      if (!secId) return;
      if (el.mainMenuList) el.mainMenuList.style.display = "none";
      document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
      const target = document.getElementById(secId);
      if (target) target.classList.add("active");
      if (el.btnSideBack) el.btnSideBack.style.display = "inline-block";
      if (el.sideTitle) el.sideTitle.textContent = item.childNodes[0].textContent.trim();
    });
  });

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
      title: "再生",
      items: [
        ["optionsSection", "🎛️", "再生設定", "速度・ピッチ・再生機能・立体音響"],
        ["eqSection", "🎚️", "音質調整", "イコライザー・周波数帯を調整"],
        ["timerSection", "⏱️", "スリープタイマー", "再生を自動停止する時間を設定"]
      ]
    },
    audio: {
      title: "音声",
      items: [
        ["speakerSection", "🔊", "出力設定", "スピーカー・出力先・左右音量など"],
        ["inputSection", "🎤", "入力設定", "マイク・モニター・ハウリング防止など"],
        ["delaySection", "⏱️", "遅延", "スピーカーの遅延測定・自動補正"]
      ]
    },
    display: {
      title: "表示",
      items: [
        ["waveSection", "〰️", "波形", "3D・2D・案1〜案8から表示方法を選択"],
        ["visualizerDetailSection", "📈", "ビジュアライザー詳細", "モード別設定・FPS・描画負荷"],
        ["layoutSection", "▦", "ホームレイアウト", "デフォルト・案1〜案5から配置を選択"],
        ["themeSection", "🎨", "テーマ", "システム・ダーク・ライト・カスタムを選択"]
      ]
    },
    history: {
      title: "履歴",
      items: [
        ["statsSection", "📊", "再生履歴・統計", "再生回数・よく聴く曲・月間統計など"]
      ]
    },
    other: {
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

  function openSettingsDetail(secId, title) {
    if (el.sidebar) el.sidebar.classList.add("settingsBottomSheet");
    openSidebar();

    if (el.mainMenuList) el.mainMenuList.style.display = "none";
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));

    const target = document.getElementById(secId);
    if (target) target.classList.add("active");

    if (el.btnSideBack) el.btnSideBack.style.display = "none";
    if (el.sideTitle) el.sideTitle.textContent = title || "設定";
  }

  function showSettingsCategory(key) {
    const category = SETTINGS_CATEGORIES[key];
    if (!category || !settingsCategoryHome || !settingsCategoryView || !settingsCategoryCards) return;

    settingsCategoryHome.hidden = true;
    settingsCategoryView.hidden = false;
    settingsCategoryTitle.textContent = category.title;

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

  document.querySelectorAll("[data-settings-category]").forEach(card => {
    card.addEventListener("click", () => showSettingsCategory(card.dataset.settingsCategory));
  });

  if (btnSettingsCategoryBack) {
    btnSettingsCategoryBack.addEventListener("click", () => {
      if (settingsCategoryView) settingsCategoryView.hidden = true;
      if (settingsCategoryHome) settingsCategoryHome.hidden = false;
      if (settingsCategoryTitle) settingsCategoryTitle.textContent = "";
      if (settingsCategoryCards) settingsCategoryCards.innerHTML = "";
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
        const label = mode === "default" ? "デフォルト" : "案" + mode;
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
      const plEl = document.getElementById("playlistElements");
      const setEl = document.getElementById("settingsTabContainer");

      if (homeEl) homeEl.style.display = target === "home" ? "block" : "none";
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

  let appLoadingDisplayedProgress = 0;
  let appLoadingTargetProgress = 0;
  let appLoadingProgressTimer = null;

  function updateAppLoadingProgress(percent, message) {
    appLoadingTargetProgress = Math.max(0, Math.min(100, Math.round(percent)));
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
    requestAnimationFrame(() => {
      document.body.classList.remove("app-loading");
      document.getElementById("appLoadingScreen")?.remove();
    });
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
