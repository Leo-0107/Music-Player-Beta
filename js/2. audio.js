const audio = new Audio();
audio.preload = "auto";

let audioCtx = null, sourceNode = null, filters = [], masterGain = null, limiterNode = null, pannerNode = null, panner3DNode = null, analyser = null, analyserData = null;
let audioGraphReady = false;
let isSlidingRange = false;
let currentRate = 1.0;
let spatialAngle = 0;
let targetSongForPlaylist = null;
let lastUnmutedVolume = 1.0;
let currentVolumeTarget = loadNum(STORAGE.volume, 1.0);
let eqAnimId = null;
let wakeLock = null;

const historyStack = [];
let historyIndex = -1;

let sleepTimerId = null;
let sleepIntervalId = null;
let sleepTimerEnd = null;
let hasCountedCurrentSong = false;

function setWaveMode(mode) {
  state.waveMode = mode;
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

  try {
    navigator.mediaSession.setActionHandler('play', () => {
      if (audio.paused) playPause();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (!audio.paused) playPause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      prevTrack();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      nextTrack();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      audio.pause();
      audio.currentTime = 0;
      updatePlayPauseUI();
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skip = details.seekOffset || 10;
      audio.currentTime = Math.max(0, audio.currentTime - skip);
      updateMediaSessionPosition();
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skip = details.seekOffset || 10;
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      updateMediaSessionPosition();
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.fastSeek && ('fastSeek' in audio)) {
        audio.fastSeek(details.seekTime);
      } else {
        audio.currentTime = details.seekTime;
      }
      updateMediaSessionPosition();
    });
  } catch (e) {}
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

    // パイプライン: lastFilter -> masterGain -> limiterNode -> analyser -> destination
    lastFilter.connect(masterGain);
    masterGain.connect(limiterNode);
    limiterNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    audioGraphReady = true;
  } catch(e) {}
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
  if (audio.paused || document.visibilityState !== "visible") {
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

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  updateSpatialAudio(dt);

  if (analyser && analyserData) {
    analyser.getByteFrequencyData(analyserData);

    // 連続無音判定 (2.0秒以上の連続無音でスキップ)
    if (state.silenceSkip && !audio.paused) {
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
    }

    if (state.waveMode === "3d") {
      const bars = analyserData.length;
      const barWidth = width / bars;
      for (let i = 0; i < bars; i++) {
        const value = analyserData[i];
        const percent = value / 255;
        const barHeight = height * percent;
        const x = i * barWidth;
        const y = height - barHeight;

        const hue = (i / bars) * 280 + 120;
        ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.8)`;
        ctx.fillRect(x, y, barWidth - 1, barHeight);

        ctx.fillStyle = `hsla(${hue}, 100%, 75%, 0.3)`;
        ctx.fillRect(x, y - 4, barWidth - 1, 3);
      }
    } else {
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1DB954";
      const sliceWidth = width / analyserData.length;
      let x = 0;
      for (let i = 0; i < analyserData.length; i++) {
        const v = analyserData[i] / 128.0;
        const y = (v * height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(width, height / 2);
      ctx.stroke();
    }
  }
}

function startWaveAnimation() {
  if (!isWaveAnimating && !audio.paused) {
    isWaveAnimating = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(drawWave);
  }
}

