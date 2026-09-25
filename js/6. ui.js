      showInSiteConfirm("再生履歴を削除しますか？", "再生履歴と再生回数のデータを削除します。", () => {
        state.playCounts = {};
        state.playHistory = {};
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

  audio.addEventListener("timeupdate", () => {
    if(!audio.duration) return;
    const cur = audio.currentTime, dur = audio.duration;
    if(!isSlidingRange) {
      if (el.progress) el.progress.value = (cur / dur) * 100;
      if (el.miniProgress) el.miniProgress.value = (cur / dur) * 100;
    }
    if (el.timeNow) el.timeNow.textContent = fmtTime(cur);
    if (el.timeAll) el.timeAll.textContent = fmtTime(dur);

    if (cur > 30 || (dur > 0 && cur / dur > 0.5)) {
      recordPlayCount();
    }

    updateMediaSessionPosition();
  });

  audio.addEventListener("ended", () => {
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

  // --- 描画ループ & 連続無音判定 ---
  function drawWave() {
    const pageVisible = document.visibilityState === "visible";
    const isPlaying = !audio.paused && pageVisible;
    if (!isPlaying && !waveDecayActive) {
      isWaveAnimating = false;
      return;
    }

    requestAnimationFrame(drawWave);
    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (!el.wave) return;
    const canvas = el.wave;
    const ctx = canvas.getContext("2d");
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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

    if (analyser && analyserData) {
      const dataLen = analyserData.length;
      if (!waveSmoothData || waveSmoothData.length !== dataLen) waveSmoothData = new Float32Array(dataLen);
      if (isPlaying) analyser.getByteFrequencyData(analyserData);
      else analyserData.fill(0);

      const smoothing = isPlaying ? 0.24 : 0.14;
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
        const meterSmoothing = isPlaying ? 0.105 : 0.035;
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
              leftDisplay[i] += (waveLeftOutputData[i] - leftDisplay[i]) * 0.16;
              rightDisplay[i] += (waveRightOutputData[i] - rightDisplay[i]) * 0.16;
            }
          } else {
            for (let i = 0; i < leftDisplay.length; i++) {
              leftDisplay[i] += (128 - leftDisplay[i]) * 0.16;
              rightDisplay[i] += (128 - rightDisplay[i]) * 0.16;
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
        const centerY = height * 0.65;
        const maxBarHeight = height * 0.43;
        const sideWidth = width * 0.46;
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

            let sum = 0;
            let count = 0;
            for (let i = start; i < end; i++) {
              const value = (data[i] || 0) / 255;
              sum += value * value;
              count++;
            }
            return count ? Math.sqrt(sum / count) * 1.55 : 0;
          };

          for (let i = 0; i < sideBars; i++) {
            const leftTarget = Math.min(1, getBandLevel(waveLeftOutputData, i) * 2);
            const rightTarget = Math.min(1, getBandLevel(waveRightOutputData, i) * 2);

            leftSmooth[i] += (leftTarget - leftSmooth[i]) * 0.16;
            rightSmooth[i] += (rightTarget - rightSmooth[i]) * 0.16;

            const distanceIndex = i + 1;
            const xLeft = centerX - distanceIndex * stepX;
            const xRight = centerX + distanceIndex * stepX;

            const leftHeight = Math.max(1, maxBarHeight * leftSmooth[i]);
            const rightHeight = Math.max(1, maxBarHeight * rightSmooth[i]);

            const hue = (i / Math.max(1, sideBars - 1)) * 280 + 120;
            ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.82)`;

            ctx.fillRect(xLeft - barWidth * 0.5, centerY - leftHeight, barWidth, leftHeight);
            ctx.fillRect(xRight - barWidth * 0.5, centerY - rightHeight, barWidth, rightHeight);
          }
        }

        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
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
          const displayLevel = Math.min(1, Math.sqrt(change) * 3.8);
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
      } else {
        const SAMPLE_INTERVAL = 0.04;
        const HISTORY_SECONDS = 3.5;
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
        const timeLeft = width * 0.015;
        const timeRight = width * 0.985;
        const baseY = height * 0.97;
        const maxHeight = height * 0.78;
        const freqDepth = width * 0.46;
        const freqTilt = height * 0.74;
        const timeDepth = width * 0.34;
        const timeLift = height * 0.38;

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
            return { x, y, age };
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

              if (b === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
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
    if (!isWaveAnimating && (!audio.paused || force)) {
      isWaveAnimating = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(drawWave);
    }
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


  document.querySelectorAll(".settingsCard").forEach(card => {
    card.addEventListener("click", () => {
      const secId = card.dataset.settingsSection;
      if (!secId) return;
      const menuItem = document.querySelector(`.menuItem[data-section="${secId}"]`);
      if (menuItem) {
        if (el.sidebar) el.sidebar.classList.add("settingsBottomSheet");
        openSidebar();
        menuItem.click();
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
      MediaStop: () => { audio.pause(); audio.currentTime = 0; updatePlayPauseUI(); }
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

  (async () => {
    await initDB();
    await reloadPlaylistFromDB();
    restoreLastPlaybackMemory();
    applyTheme();
    renderEqualizer();
    renderColorPickers();
    setDMode(state.dMode);
    setWaveMode(state.waveMode);
    updateVolumeUI(currentVolumeTarget);
    applyPitchAndRate();
    setupMediaSessionRemoteControls();
  })();
