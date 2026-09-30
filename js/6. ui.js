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
      drawWave._wave3DHistory = [];
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

    if (minutes === "off" || minutes <= 0) {
      if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
      toast("スリープタイマーを解除しました");
      return;
    }

    const ms = minutes * 60 * 1000;
    sleepTimerEnd = Date.now() + ms;

    const updateTimerText = () => {
      const remain = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
      if (remain <= 0) {
        if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
        clearInterval(sleepIntervalId);
        return;
      }
      const m = Math.floor(remain / 60);
      const s = remain % 60;
      if (el.timerStatus) el.timerStatus.textContent = `自動停止まで: ${m}分${s}秒`;
    };

    updateTimerText();
    sleepIntervalId = setInterval(updateTimerText, 1000);

    sleepTimerId = setTimeout(() => {
      setPlaybackIntent(false);
      audio.pause();
      releaseWakeLock();
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
    el.btnSetCustomTimer.addEventListener("click", () => {
      const v = Number(el.customTimerInput.value);
      if (v > 0) setSleepTimer(v);
    });
  }

  let waveViewYaw = 0;
  let waveViewPitch = 0;
  let waveViewDragging = false;
  let waveViewPointerId = null;
  let waveViewLastX = 0;
  let waveViewLastY = 0;
  let visualizerFrameTime = 16.67;

  function applyWaveView(point, width, height) {
    const cx = width * 0.5;
    const cy = height * 0.58;
    const x = point.x - cx;
    const y = point.y - cy;
    const yaw = waveViewYaw;
    const pitch = waveViewPitch;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const rotatedX = x * cosY - y * sinY * 0.32;
    const rotatedY = x * sinY * 0.32 + y * cosY;
    const cosP = Math.cos(pitch);
    return {
      x: cx + rotatedX,
      y: cy + rotatedY * cosP - x * Math.sin(pitch) * 0.12,
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
              waveTimeData[i] += (waveTimeTargetData[i] - waveTimeData[i]) * WAVE_TIME_SMOOTHING;
            }
          } else {
            for (let i = 0; i < waveTimeData.length; i++) {
              waveTimeData[i] += (128 - waveTimeData[i]) * WAVE_TIME_SMOOTHING;
            }
          }

          const centerY = height * 0.5;
          const amplitudeScale = height * 0.43;

          ctx.beginPath();
          for (let i = 0; i < waveTimeData.length; i++) {
            const x = (i / Math.max(1, waveTimeData.length - 1)) * width;
            const sample = (waveTimeData[i] - 128) / 128;
            const y = centerY - sample * amplitudeScale;
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
        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          if (!waveLeftOutputAnalyser._displayData || waveLeftOutputAnalyser._displayData.length !== waveLeftOutputAnalyser.fftSize) {
            waveLeftOutputAnalyser._displayData = new Float32Array(waveLeftOutputAnalyser.fftSize);
            waveRightOutputAnalyser._displayData = new Float32Array(waveRightOutputAnalyser.fftSize);
            waveLeftOutputAnalyser._displayData.fill(128);
            waveRightOutputAnalyser._displayData.fill(128);
          }

          const leftDisplay = waveLeftOutputAnalyser._displayData;
          const rightDisplay = waveRightOutputAnalyser._displayData;

          if (isPlaying) {
            waveLeftOutputAnalyser.getByteTimeDomainData(waveLeftOutputData);
            waveRightOutputAnalyser.getByteTimeDomainData(waveRightOutputData);
            for (let i = 0; i < leftDisplay.length; i++) {
              leftDisplay[i] += (waveLeftOutputData[i] - leftDisplay[i]) * 0.13;
              rightDisplay[i] += (waveRightOutputData[i] - rightDisplay[i]) * 0.13;
            }
          } else {
            for (let i = 0; i < leftDisplay.length; i++) {
              leftDisplay[i] += (128 - leftDisplay[i]) * 0.13;
              rightDisplay[i] += (128 - rightDisplay[i]) * 0.13;
            }
          }

          const drawChannelWave = (data, top, bottom, label) => {
            const centerY = (top + bottom) * 0.5;
            const amplitudeScale = (bottom - top) * 0.42;

            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
              const x = (i / Math.max(1, data.length - 1)) * width;
              const sample = (data[i] - 128) / 128;
              const y = centerY - sample * amplitudeScale;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = "rgba(95, 214, 255, 0.92)";
            ctx.lineWidth = 1.8;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            ctx.lineTo(width, centerY);
            ctx.stroke();

            ctx.fillStyle = "rgba(255,255,255,0.72)";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText(label, 8, Math.max(12, top + 12));
          };

          drawChannelWave(leftDisplay, 0, height * 0.5, "L");
          drawChannelWave(rightDisplay, height * 0.5, height, "R");
        }
      } else if (state.waveMode === "a3") {
        const sideBars = Math.min(32, waveLeftOutputAnalyser?.frequencyBinCount || 32);
        const centerX = width * 0.5;
        const baseY = height - 1;
        const maxBarHeight = height * 0.86;
        const sideWidth = width * 0.92;
        const stepX = sideWidth / Math.max(1, sideBars);
        const barWidth = Math.max(1.5, stepX * 0.72);

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          if (!waveLeftOutputAnalyser._spectrumSmooth || waveLeftOutputAnalyser._spectrumSmooth.length !== sideBars) {
            waveLeftOutputAnalyser._spectrumSmooth = new Float32Array(sideBars);
            waveRightOutputAnalyser._spectrumSmooth = new Float32Array(sideBars);
          }

          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          const leftSmooth = waveLeftOutputAnalyser._spectrumSmooth;
          const rightSmooth = waveRightOutputAnalyser._spectrumSmooth;

          const getBandLevel = (data, bandIndex) => {
            const start = Math.floor(Math.pow(bandIndex / sideBars, 1.35) * data.length);
            const end = Math.min(
              data.length,
              Math.max(start + 1, Math.floor(Math.pow((bandIndex + 1) / sideBars, 1.35) * data.length))
            );

            let level = 0;
            for (let i = start; i < end; i++) {
              level = Math.max(level, (data[i] || 0) / 255);
            }
            return level;
          };

          for (let i = 0; i < sideBars; i++) {
            // 2Dと同じく各帯域の現在値を0から表示し、前回の2倍感度は維持する。
            const leftTarget = Math.min(1, getBandLevel(waveLeftOutputData, i) * 2);
            const rightTarget = Math.min(1, getBandLevel(waveRightOutputData, i) * 2);

            leftSmooth[i] += (leftTarget - leftSmooth[i]) * 0.13;
            rightSmooth[i] += (rightTarget - rightSmooth[i]) * 0.13;

            const distanceIndex = i + 1;
            const xLeft = centerX - distanceIndex * stepX;
            const xRight = centerX + distanceIndex * stepX;

            const leftHeight = maxBarHeight * leftSmooth[i];
            const rightHeight = maxBarHeight * rightSmooth[i];

            const hue = (i / Math.max(1, sideBars - 1)) * 280 + 120;
            ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.82)`;

            if (leftHeight > 0.5) {
              ctx.fillRect(xLeft - barWidth * 0.5, baseY - leftHeight, barWidth, leftHeight);
            }
            if (rightHeight > 0.5) {
              ctx.fillRect(xRight - barWidth * 0.5, baseY - rightHeight, barWidth, rightHeight);
            }
          }
        }

        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        ctx.lineTo(width, baseY);
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
        // 案5: 現在の音を3軸で立体化。左右=周波数、前後=ステレオ定位、上下=強度。
        const spaceBands = 56;
        const centerX = width * 0.5;
        const baseY = height * 0.88;
        const spanX = width * 0.84;
        const depthSpan = width * 0.22;
        const depthLift = height * 0.18;
        const heightScale = height * 0.62;

        if (waveLeftOutputAnalyser && waveRightOutputAnalyser && waveLeftOutputData && waveRightOutputData) {
          waveLeftOutputAnalyser.getByteFrequencyData(waveLeftOutputData);
          waveRightOutputAnalyser.getByteFrequencyData(waveRightOutputData);

          if (!drawWave._waveA5Smooth || drawWave._waveA5Smooth.length !== spaceBands) {
            drawWave._waveA5Smooth = new Float32Array(spaceBands);
            drawWave._waveA5Balance = new Float32Array(spaceBands);
          }

          const smoothLevel = drawWave._waveA5Smooth;
          const smoothBalance = drawWave._waveA5Balance;

          const getBand = (data, bandIndex) => {
            const start = Math.floor(Math.pow(bandIndex / spaceBands, 1.45) * data.length);
            const end = Math.min(
              data.length,
              Math.max(start + 1, Math.floor(Math.pow((bandIndex + 1) / spaceBands, 1.45) * data.length))
            );
            let level = 0;
            for (let i = start; i < end; i++) level = Math.max(level, (data[i] || 0) / 255);
            return level;
          };

          const points = [];
          for (let b = 0; b < spaceBands; b++) {
            const left = getBand(waveLeftOutputData, b);
            const right = getBand(waveRightOutputData, b);
            const levelTarget = Math.min(1, Math.max(left, right) * 2);
            const balanceTarget = (right + left) > 0.02
              ? (right - left) / Math.max(0.02, right + left)
              : 0;

            smoothLevel[b] += (levelTarget - smoothLevel[b]) * 0.16;
            smoothBalance[b] += (balanceTarget - smoothBalance[b]) * 0.16;

            const ratio = b / Math.max(1, spaceBands - 1);
            const freqX = centerX + (ratio - 0.5) * spanX;
            const depth = smoothBalance[b];
            const x = freqX + depth * depthSpan;
            const y = baseY - smoothLevel[b] * heightScale - depth * depthLift;
            points.push({ x, y, depth, level: smoothLevel[b], ratio });
          }

          // 床面。前後方向が見えるよう、ステレオ位置の基準線を薄く表示。
          ctx.strokeStyle = "rgba(255,255,255,0.10)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(centerX - spanX * 0.5 - depthSpan, baseY);
          ctx.lineTo(centerX + spanX * 0.5 + depthSpan, baseY);
          ctx.stroke();

          // 周波数方向の立体波形。
          ctx.beginPath();
          points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.strokeStyle = "hsla(195, 90%, 62%, 0.92)";
          ctx.lineWidth = 2.2;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.stroke();

          // 各帯域を床まで接続して、強度と前後位置を同時に見えるようにする。
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p.level < 0.015) continue;
            const alpha = 0.08 + p.level * 0.18;
            ctx.strokeStyle = `hsla(${185 + p.ratio * 105}, 90%, 62%, ${alpha})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(p.x, baseY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }

          // ステレオ定位を示す前後方向の補助ライン。
          const midY = baseY - height * 0.02;
          ctx.strokeStyle = "rgba(255,255,255,0.07)";
          ctx.beginPath();
          ctx.moveTo(centerX - depthSpan, midY);
          ctx.lineTo(centerX + depthSpan, midY);
          ctx.stroke();

          ctx.fillStyle = "rgba(255,255,255,0.68)";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("低", Math.max(4, centerX - spanX * 0.5), baseY + 14);
          ctx.textAlign = "right";
          ctx.fillText("高", Math.min(width - 4, centerX + spanX * 0.5), baseY + 14);
          ctx.textAlign = "center";
          ctx.fillText("L ← 前後 → R", centerX, Math.max(12, baseY - height * 0.74));
        }
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

        const low = bandEnergy(0.01, 0.10);
        const mid = bandEnergy(0.10, 0.42);
        const high = bandEnergy(0.42, 0.92);
        const total = Math.min(1, low * 1.5 + mid * 1.1 + high * 0.8);
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
          { energy: low, hue: 35, radius: baseRadius * (1.45 + low * 2.1), wobble: height * 0.12, speed: 0.75, tilt: 0.38 },
          { energy: mid, hue: 185, radius: baseRadius * (2.25 + mid * 2.3), wobble: height * 0.10, speed: -0.52, tilt: -0.25 },
          { energy: high, hue: 285, radius: baseRadius * (3.05 + high * 2.0), wobble: height * 0.08, speed: 0.95, tilt: 0.16 }
        ];

        rings.forEach((ring, ringIndex) => {
          const points = 96;
          const phase = now * 0.001 * ring.speed;
          ctx.beginPath();
          for (let i = 0; i <= points; i++) {
            const t = (i / points) * Math.PI * 2;
            const wave = Math.sin(t * (3 + ringIndex) + phase * 2.2) * ring.wobble * (0.20 + ring.energy * 1.35);
            const pulse = ring.energy * Math.sin(t * 2 - phase * 1.4) * Math.min(width, height) * 0.035;
            const rx = ring.radius + wave + pulse;
            const ry = ring.radius * (0.48 + ring.energy * 0.22) + wave * 0.42;
            const x = cx + Math.cos(t + phase) * rx;
            const y = cy + Math.sin(t + phase * 0.7) * ry + Math.sin(t * 2 + phase) * ring.tilt * ring.energy * 14;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `hsla(${ring.hue}, 88%, 64%, ${0.22 + ring.energy * 0.62})`;
          ctx.lineWidth = 1.2 + ring.energy * 2.8;
          ctx.shadowBlur = 8 + ring.energy * 18;
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
        // 案7: 粒子ビジュアライザー。粒子数0なら粒子処理を行わない。
        const particleCount = Math.max(0, Math.min(1200, state.waveParticleCount || 0));
        if (particleCount > 0) {
          if (!drawWave._waveParticleState || drawWave._waveParticleState.count !== particleCount) {
            const particles = new Array(particleCount);
            for (let i = 0; i < particleCount; i++) {
              particles[i] = {
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.22,
                vy: (Math.random() - 0.5) * 0.22,
                size: 0.7 + Math.random() * 1.8,
                phase: Math.random() * Math.PI * 2
              };
            }
            drawWave._waveParticleState = { count: particleCount, particles };
          }
          const energy = waveSmoothData.reduce((s, v) => s + v, 0) / Math.max(1, waveSmoothData.length);
          const particleStep = lowPerformance ? Math.max(3, particleCount > 700 ? 4 : 3) : (particleCount > 700 ? 2 : 1);
          ctx.globalAlpha = 0.78;
          for (let i = 0; i < particleCount; i += particleStep) {
            const p = drawWave._waveParticleState.particles[i];
            const bandIndex = Math.min(dataLen - 1, Math.floor((i / particleCount) * dataLen));
            const band = waveSmoothData[bandIndex] || energy;
            p.vx += Math.sin(p.phase + now * 0.0007) * 0.0015;
            p.vy += Math.cos(p.phase + now * 0.0009) * 0.0015;
            p.x += p.vx * (1 + band * 4) * (dt * 60);
            p.y += p.vy * (1 + band * 4) * (dt * 60);
            if (p.x < -4) p.x = width + 4;
            if (p.x > width + 4) p.x = -4;
            if (p.y < -4) p.y = height + 4;
            if (p.y > height + 4) p.y = -4;
            const size = p.size + band * 4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${180 + bandIndex / Math.max(1, dataLen - 1) * 100}, 90%, 65%, ${0.28 + band * 0.65})`;
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      } else if (state.waveMode === "a8") {
        // 案8: 曲変更時に現在の波形を収束させ、新しい波形を形成する。
        const trackKey = state.currentSong?.name || audio.src || "";
        if (drawWave._wave8TrackKey !== trackKey) {
          drawWave._wave8TrackKey = trackKey;
          drawWave._wave8Transition = 1;
        }
        const transition = Math.max(0, drawWave._wave8Transition || 0);
        if (transition > 0) {
          drawWave._wave8Transition = Math.max(0, transition - dt * 1.8);
          ctx.fillStyle = `rgba(255,255,255,${0.05 + transition * 0.12})`;
          ctx.fillRect(0, 0, width, height);
        }
        const centerY = height * 0.55;
        const amplitude = height * 0.34;
        ctx.beginPath();
        for (let i = 0; i < dataLen; i++) {
          const ratio = i / Math.max(1, dataLen - 1);
          const x = ratio * width;
          const level = waveSmoothData[i] || 0;
          const y = centerY - level * amplitude * (1 - transition * 0.78);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(95, 214, 255, ${0.28 + (1 - transition) * 0.62})`;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();
        if (transition > 0.02) {
          ctx.beginPath();
          const center = width * 0.5;
          const spread = width * (0.08 + (1 - transition) * 0.42);
          ctx.moveTo(center - spread, centerY);
          ctx.lineTo(center + spread, centerY);
          ctx.strokeStyle = `rgba(255,255,255,${0.15 + transition * 0.3})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } else {
        const SAMPLE_INTERVAL = 0.04;
        const HISTORY_SECONDS = 5.5;
        const BANDS_3D = 72;
        const maxHistory = Math.max(24, Math.round(HISTORY_SECONDS / SAMPLE_INTERVAL));

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

          drawWave._wave3DTrackKey = trackKey;

          if (drawWave._wave3DLastAudioTime >= 0 &&
              (audioTime < drawWave._wave3DLastAudioTime ||
               Math.abs(audioTime - drawWave._wave3DLastAudioTime) > 0.4)) {
            drawWave._wave3DHistory = [];
            drawWave._wave3DSampleElapsed = 0;
            drawWave._wave3DLastSampleTime = -1;
          }

          if (drawWave._wave3DLastSampleTime < 0 ||
              audioTime - drawWave._wave3DLastSampleTime >= SAMPLE_INTERVAL) {
            const bands = new Float32Array(BANDS_3D);
            const maxBin = analyserData.length - 1;

            for (let b = 0; b < BANDS_3D; b++) {
              const lo = Math.floor(Math.pow(b / BANDS_3D, 1.45) * maxBin);
              const hi = Math.max(
                lo + 1,
                Math.floor(Math.pow((b + 1) / BANDS_3D, 1.45) * maxBin)
              );

              let sum = 0;
              let count = 0;

              for (let k = lo; k <= hi && k <= maxBin; k++) {
                const value = (analyserData[k] || 0) / 255;
                sum += value * value;
                count++;
              }

              bands[b] = count
                ? Math.sqrt(sum / count) * 2.0
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

        const rows = drawWave._wave3DHistory;
        const liveBands = isPlaying && waveSmoothData?.length
          ? (() => {
              const bands = new Float32Array(BANDS_3D);
              const maxBin = waveSmoothData.length - 1;
              for (let b = 0; b < BANDS_3D; b++) {
                const lo = Math.floor(Math.pow(b / BANDS_3D, 1.45) * maxBin);
                const hi = Math.max(
                  lo + 1,
                  Math.floor(Math.pow((b + 1) / BANDS_3D, 1.45) * maxBin)
                );
                let level = 0;
                for (let k = lo; k <= hi && k <= maxBin; k++) {
                  level = Math.max(level, waveSmoothData[k] || 0);
                }
                bands[b] = level * 2.0;
              }
              return bands;
            })()
          : null;
        const cameraSpan = 1.12 + Math.min(0.34, Math.abs(Math.sin(waveViewYaw)) * 0.24 + Math.abs(waveViewPitch) * 0.10);
        const timeLeft = -width * 0.20 * cameraSpan;
        const timeRight = width * 1.20 * cameraSpan;
        const baseY = height * 0.97;
        const maxHeight = height * 0.78;
        const freqDepth = width * (0.50 + Math.min(0.14, Math.abs(Math.sin(waveViewYaw)) * 0.10));
        const freqTilt = height * 0.74;
        const timeDepth = width * (0.40 + Math.min(0.12, Math.abs(Math.cos(waveViewYaw)) * 0.08));
        const timeLift = height * 0.40;

        if (rows.length) {
          const currentAudioTime = Number(audio.currentTime) || 0;
          const pauseFade = isPlaying
            ? 1
            : Math.max(0, (drawWave._wave3DPauseFade ?? 1) - dt * 1.8);

          if (!isPlaying) drawWave._wave3DPauseFade = pauseFade;

          const project3DPoint = (time, amplitudeBands, bandIndex) => {
            const ageSeconds = Math.max(0, currentAudioTime - time);
            const age = Math.min(1, ageSeconds / HISTORY_SECONDS);
            const freqRatio = bandIndex / Math.max(1, BANDS_3D - 1);
            const depth = freqRatio - 0.5;
            const timeX = timeLeft + age * (timeRight - timeLeft);
            const timeY = baseY - age * timeLift;
            const x = timeX + depth * freqDepth - age * timeDepth;
            const amplitude = Math.max(0, amplitudeBands?.[bandIndex] || 0);
            const y = timeY + depth * freqTilt -
              amplitude * maxHeight * 0.70 * (0.55 + 0.45 * freqRatio);
            return applyWaveView({ x, y, age }, width, height);
          };

          for (let t = rows.length - 1; t >= 0; t--) {
            const row = rows[t];
            const ageSeconds = Math.max(0, currentAudioTime - row.time);
            const age = Math.min(1, ageSeconds / HISTORY_SECONDS);
            const timeX = timeLeft + age * (timeRight - timeLeft);
            const timeY = baseY - age * timeLift;

            const fade = (0.18 + 0.82 * (1 - age)) * pauseFade;
            const hue = 180 + (1 - age) * 100;

            ctx.beginPath();

            for (let b = 0; b < BANDS_3D; b++) {
              const freqRatio = b / Math.max(1, BANDS_3D - 1);
              const depth = freqRatio - 0.5;
              const x = timeX + depth * freqDepth - age * timeDepth;
              const amplitude = Math.max(0, row.bands?.[b] || 0);
              const y = timeY + depth * freqTilt -
                amplitude * maxHeight * 0.70 * (0.55 + 0.45 * freqRatio);

              const point = applyWaveView({ x, y, age }, width, height);
              if (b === 0) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }

            ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
            ctx.globalAlpha = fade;
            ctx.lineWidth = t === 0 ? 2.6 : 1.05;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
          }

          // 周波数方向の線だけでなく、時間方向にも各波形を接続して連続した面にする
          ctx.globalAlpha = 0.28 * pauseFade;
          ctx.strokeStyle = "rgba(95, 214, 255, 0.72)";
          ctx.lineWidth = 0.65;
          for (let b = 0; b < BANDS_3D; b++) {
            ctx.beginPath();
            for (let t = rows.length - 1; t >= 0; t--) {
              const point = project3DPoint(rows[t].time, rows[t].bands, b);
              if (t === rows.length - 1) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
          }

          // 最前面は現在の解析値を毎フレーム描画し、0.04秒刻みの段差を目立たせない。
          // 履歴より明るく目立たせる専用のネオン色にはせず、波形全体の色調に合わせる。
          if (liveBands) {
            ctx.globalAlpha = pauseFade;
            ctx.strokeStyle = "hsl(280, 100%, 60%)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (let b = 0; b < BANDS_3D; b++) {
              const point = project3DPoint(currentAudioTime, liveBands, b);
              if (b === 0) ctx.moveTo(point.x, point.y);
              else ctx.lineTo(point.x, point.y);
            }
            ctx.stroke();
          }

          ctx.globalAlpha = 1;

          if (!isPlaying) {
            const pauseFade = Math.max(0, drawWave._wave3DPauseFade ?? 0);
            const restAlpha = 0.18 + 0.62 * (1 - pauseFade);
            ctx.strokeStyle = "rgba(95, 214, 255, 1)";
            ctx.globalAlpha = restAlpha;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(timeLeft, baseY);
            ctx.lineTo(timeRight, baseY);
            ctx.stroke();

            if (pauseFade <= 0) {
              waveDecayActive = false;
            }
          }
          ctx.globalAlpha = 1;
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
  const sectionResetKeys = {
    optionsSection:[STORAGE.volume,STORAGE.pitch,STORAGE.shuffle,STORAGE.repeat,STORAGE.favOnly,STORAGE.crossfade,STORAGE.silenceSkip,STORAGE.dMode],
    waveSection:[STORAGE.waveMode,STORAGE.waveParticleCount,STORAGE.visualizerSettings],
    visualizerDetailSection:[STORAGE.visualizerSettings],
    eqSection:[STORAGE.eqState],
    speakerSection:[STORAGE.channelLeft,STORAGE.channelRight,STORAGE.micMonitorVolume,STORAGE.micFeedbackStrength,STORAGE.speakerPairSwap,STORAGE.outputRoutes,STORAGE.mainOutputDevice,STORAGE.speakerSettings],
    playlistSection:[STORAGE.playlistSettings],
    queueSection:[STORAGE.queue],
    statsSection:[STORAGE.playCounts,STORAGE.playHistory,STORAGE.playStats,STORAGE.playbackMonthly],
    themeSection:[STORAGE.themeMode,STORAGE.customTheme]
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
        if(sectionResetKeys[sec.id]) {
          const reset=document.createElement("button"); reset.type="button"; reset.className="btn small ghost"; reset.textContent="この設定をリセット";
          reset.addEventListener("click",e=>{
            e.stopPropagation();
            showInSiteConfirm("設定をリセット", "「"+title.textContent.replace("?","").trim()+"」だけを初期値に戻します。", ()=>{
              (sectionResetKeys[sec.id]||[]).forEach(k=>localStorage.removeItem(k));
              location.reload();
            }, "リセット");
          });
          wrap.appendChild(reset);
        }
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

  document.querySelectorAll(".settingsCard").forEach(card => {
    card.addEventListener("click", () => {
      const secId = card.dataset.settingsSection;
      if (!secId) return;

      if (el.sidebar) el.sidebar.classList.add("settingsBottomSheet");
      openSidebar();

      if (el.mainMenuList) el.mainMenuList.style.display = "none";
      document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));

      const target = document.getElementById(secId);
      if (target) target.classList.add("active");

      // 設定タブから開いた詳細画面では、左上の「戻る」でメニューへ戻らない。
      if (el.btnSideBack) el.btnSideBack.style.display = "none";

      const menuItem = document.querySelector(`.menuItem[data-section="${secId}"]`);
      if (el.sideTitle) {
        el.sideTitle.textContent = menuItem
          ? menuItem.childNodes[0].textContent.trim()
          : "設定";
      }
    });
  });

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

  function updateAppLoadingProgress(percent, message) {
    const safe = Math.max(0, Math.min(100, Math.round(percent)));
    const fill = document.getElementById("appLoadingProgressFill");
    const percentText = document.getElementById("appLoadingPercent");
    const messageText = document.getElementById("appLoadingText");
    if (fill) fill.style.width = safe + "%";
    if (percentText) percentText.textContent = safe + "%";
    if (messageText && message) messageText.textContent = message;
  }

  function revealAppAfterHomeReady() {
    updateAppLoadingProgress(100, "ホーム画面を表示します...");
    requestAnimationFrame(() => {
      document.body.classList.remove("app-loading");
      document.getElementById("appLoadingScreen")?.remove();
    });
  }

  (async () => {
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

    await new Promise(resolve => requestAnimationFrame(resolve));
    await initDB();
    await reloadPlaylistFromDB();
    restoreLastPlaybackMemory();
    renderEqualizer();
  })();
