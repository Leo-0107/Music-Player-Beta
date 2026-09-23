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
    lastFrameTime = performance.now();
    startWaveAnimation();
  });

  audio.addEventListener("pause", () => {
    updatePlayPauseUI();
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

      // ボタン2D → 以前の3D表示 / ボタン3D → 以前の2D表示。
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
      } else {
        const HISTORY_SECONDS = 4;
        const SAMPLE_INTERVAL = 0.05;
        const BANDS_3D = 42;
        const maxHistoryFrames = Math.round(HISTORY_SECONDS / SAMPLE_INTERVAL);

        if (!Array.isArray(drawWave._wave3DHistory)) drawWave._wave3DHistory = [];
        if (!Number.isFinite(drawWave._wave3DSampleElapsed)) drawWave._wave3DSampleElapsed = 0;
        if (!Number.isFinite(drawWave._wave3DLastAudioTime)) drawWave._wave3DLastAudioTime = -1;
        if (drawWave._wave3DMode !== state.waveMode) {
          drawWave._wave3DHistory = [];
          drawWave._wave3DSampleElapsed = 0;
          drawWave._wave3DLastAudioTime = -1;
          drawWave._wave3DMode = state.waveMode;
        }

        if (isPlaying && analyserData?.length) {
          if (drawWave._wave3DLastAudioTime >= 0 && Math.abs(audio.currentTime - drawWave._wave3DLastAudioTime) > 0.35) {
            drawWave._wave3DHistory = [];
            drawWave._wave3DSampleElapsed = 0;
          }

          drawWave._wave3DSampleElapsed += dt;
          if (drawWave._wave3DSampleElapsed >= SAMPLE_INTERVAL) {
            drawWave._wave3DSampleElapsed %= SAMPLE_INTERVAL;

            const raw = new Float32Array(BANDS_3D);
            const maxBin = analyserData.length - 1;

            for (let b = 0; b < BANDS_3D; b++) {
              const lo = Math.floor(Math.pow(b / BANDS_3D, 1.55) * maxBin);
              const hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / BANDS_3D, 1.55) * maxBin));
              let sum = 0;
              let count = 0;

              for (let k = lo; k <= hi && k <= maxBin; k++) {
                const v = waveSmoothData[k] || 0;
                sum += v * v;
                count++;
              }

              raw[b] = count ? Math.min(1, Math.sqrt(sum / count) * 1.45) : 0;
            }

            const smooth = new Float32Array(BANDS_3D);
            for (let b = 0; b < BANDS_3D; b++) {
              let sum = 0;
              let weight = 0;

              for (let o = -2; o <= 2; o++) {
                const idx = b + o;
                if (idx < 0 || idx >= BANDS_3D) continue;
                const w = o === 0 ? 3 : (Math.abs(o) === 1 ? 2 : 1);
                sum += raw[idx] * w;
                weight += w;
              }

              smooth[b] = Math.pow(sum / weight, 0.92);
            }

            drawWave._wave3DHistory.unshift(smooth);
            if (drawWave._wave3DHistory.length > maxHistoryFrames) {
              drawWave._wave3DHistory.length = maxHistoryFrames;
            }
            drawWave._wave3DLastAudioTime = audio.currentTime;
          }
        } else {
          drawWave._wave3DSampleElapsed = 0;
        }

        const rows = drawWave._wave3DHistory;
        const meterW = Math.min(18, Math.max(12, width * 0.022));
        const waveLeft = meterW + 8;
        const waveWidth = Math.max(1, width - waveLeft - meterW - 8);
        const baseY = height * 0.82;
        const timeSpan = waveWidth * 0.76;
        const freqSpan = waveWidth * 0.18;
        const timeDepthY = height * 0.06;
        const freqDepthY = height * 0.18;
        const heightScale = height * 0.54;

        if (rows.length) {
          const project3D = (t, f, level) => {
            const tn = rows.length <= 1 ? 0 : t / (rows.length - 1);
            const fn = f / (BANDS_3D - 1);
            const x = waveLeft + tn * timeSpan + fn * freqSpan;
            const y = baseY - tn * timeDepthY - fn * freqDepthY - level * heightScale;
            return [x, y];
          };

          const surfaceColor = (level, fade, current) => {
            const hue = 118 - Math.min(118, Math.max(0, level * 135));
            const light = 47 + Math.min(18, level * 18);
            const alpha = current ? 0.9 : Math.max(0.08, 0.52 * fade);
            return `hsla(${hue}, 82%, ${light}%, ${alpha})`;
          };

          for (let t = rows.length - 1; t >= 0; t--) {
            const row = rows[t];
            const prev = rows[t + 1];
            const fade = 1 - (t / Math.max(1, rows.length - 1)) * 0.72;

            if (prev) {
              for (let f = 0; f < BANDS_3D - 1; f++) {
                const a = project3D(t, f, row[f]);
                const b = project3D(t, f + 1, row[f + 1]);
                const c = project3D(t + 1, f + 1, prev[f + 1]);
                const d = project3D(t + 1, f, prev[f]);

                const avg = (row[f] + row[f + 1] + prev[f] + prev[f + 1]) * 0.25;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.lineTo(c[0], c[1]);
                ctx.lineTo(d[0], d[1]);
                ctx.closePath();
                ctx.fillStyle = surfaceColor(avg, fade, t < 2);
                ctx.fill();
              }
            }
          }

          ctx.lineJoin = "round";

          for (let t = rows.length - 1; t >= 0; t -= 2) {
            const row = rows[t];
            ctx.beginPath();

            for (let f = 0; f < BANDS_3D; f++) {
              const p = project3D(t, f, row[f]);
              if (f === 0) ctx.moveTo(p[0], p[1]);
              else ctx.lineTo(p[0], p[1]);
            }

            const fade = 1 - (t / Math.max(1, rows.length - 1)) * 0.76;
            ctx.strokeStyle = t === 0
              ? "rgba(255,240,190,.95)"
              : `rgba(225,235,255,${Math.max(0.04, 0.28 * fade)})`;
            ctx.lineWidth = t === 0 ? 2.1 : 0.75;
            ctx.stroke();
          }

          for (let f = 0; f < BANDS_3D; f += 3) {
            ctx.beginPath();

            for (let t = rows.length - 1; t >= 0; t--) {
              const row = rows[t];
              const p = project3D(t, f, row[f]);
              if (t === rows.length - 1) ctx.moveTo(p[0], p[1]);
              else ctx.lineTo(p[0], p[1]);
            }

            ctx.strokeStyle = "rgba(190,205,235,.12)";
            ctx.lineWidth = 0.65;
            ctx.stroke();
          }
        }
      }    }

    if (!isPlaying && waveDecayActive) {
      let maxWave = 0;
      if (waveSmoothData) for (let i = 0; i < waveSmoothData.length; i++) maxWave = Math.max(maxWave, waveSmoothData[i]);
      if (maxWave < 0.008 && leftDisplayLevel < 0.008 && rightDisplayLevel < 0.008) {
        waveDecayActive = false;
        isWaveAnimating = false;
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
