import { state, el } from "./state.js";

export let audio = new Audio();
audio.preload = "auto";

export let audioCtx = null;
export let sourceNode = null;
export let filters = [];
export let masterGain = null;
export let limiterNode = null;
export let pannerNode = null;
export let panner3DNode = null;
export let analyser = null;
export let analyserData = null;
export let audioGraphReady = false;
export let currentVolumeTarget = Number(localStorage.getItem("mp_vol_v12") || 1.0);
export let currentRate = 1.0;

let spatialAngle = 0;
let lastWaveFrame = performance.now();
let silenceTimer = 0;

export function ensureGraph() {
  if (audioGraphReady) return;
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
      panner3DNode.panningModel = "HRTF";
      panner3DNode.distanceModel = "inverse";
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
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);

    let lastFilter = filters[filters.length - 1];
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

    lastFilter.connect(masterGain);
    masterGain.connect(limiterNode);
    limiterNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    audioGraphReady = true;
  } catch {
    audioGraphReady = false;
  }
}

export async function resumeAudioCtx() {
  ensureGraph();
  if (audioCtx && audioCtx.state === "suspended") {
    try {
      await audioCtx.resume();
    } catch {}
  }
}

export function applyPitchAndRate() {
  const pitchFactor = Math.pow(2, state.pitchSemitones / 12);
  audio.playbackRate = currentRate * pitchFactor;
  audio.preservesPitch = false;
  if (el.rateText) el.rateText.textContent = `${currentRate.toFixed(2)}x`;
  if (el.pitchText) {
    el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
  }
}

export function updateSpatialAudio(dt) {
  if (!audioCtx || !panner3DNode || audio.paused) return;
  const rotationSpeed = 1.5;
  spatialAngle += rotationSpeed * dt;
  const t = spatialAngle;

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
      setPos(state.panValue * 2, 0, 1);
      break;
    case "4D":
      setPos(Math.sin(t * 0.4) * 2.5, Math.sin(t * 0.8) * 1.2, Math.cos(t * 0.4) * 2.5);
      break;
    case "8D":
      setPos(Math.sin(t) * 3.2, 0, Math.cos(t) * 3.2);
      break;
    case "16D":
      setPos(Math.sin(t * 1.2) * 3.5, Math.sin(t * 2.4) * 1.8, Math.cos(t * 0.7) * 3.5);
      break;
    case "2D":
    default:
      setPos(0, 0, 0);
      break;
  }
}

export function setDMode(mode) {
  state.dMode = mode;
  if (el.dModeDesc) {
    const descriptions = {
      "2D": "2D: 標準ステレオ再生",
      "3D": "3D: 左右パン連動の固定立体音響",
      "4D": "4D: 前後左右＋上下の緩やかな空間揺らぎ",
      "8D": "8D: 頭の周りを360度全方位回転",
      "16D": "16D: 高度なマルチトラック8の字立体周回"
    };
    el.dModeDesc.textContent = descriptions[mode] || descriptions["2D"];
  }
  if (el.dModeBtns) {
    el.dModeBtns.querySelectorAll("button").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.d === mode);
    });
  }
  if (mode === "2D" && panner3DNode) {
    if (panner3DNode.positionX) {
      panner3DNode.positionX.value = 0;
      panner3DNode.positionY.value = 0;
      panner3DNode.positionZ.value = 0;
    } else {
      panner3DNode.setPosition(0, 0, 0);
    }
  }
}

export function updateVolumeUI(targetVal, isMuteAction = false) {
  const prevVol = currentVolumeTarget;
  currentVolumeTarget = Math.max(0, targetVal);

  if (el.volume) el.volume.value = currentVolumeTarget;
  if (el.volText) el.volText.textContent = `${Math.round(currentVolumeTarget * 100)}%`;
  if (el.btnMuteToggle) {
    el.btnMuteToggle.textContent = currentVolumeTarget === 0 ? "🔇" : currentVolumeTarget < 0.5 ? "🔉" : "🔊";
  }

  audio.volume = Math.min(1.0, Math.max(0.0, currentVolumeTarget));

  if (masterGain && audioCtx) {
    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    if (currentVolumeTarget > prevVol) {
      masterGain.gain.setTargetAtTime(currentVolumeTarget, now, 0.35);
    } else {
      masterGain.gain.setTargetAtTime(currentVolumeTarget, now, isMuteAction ? 0.02 : 0.05);
    }
  }

  try {
    localStorage.setItem("mp_vol_v12", String(currentVolumeTarget));
  } catch {}
}

export function applyEqGains(timeConstant = 0.1) {
  if (!filters.length) return;
  const now = audioCtx ? audioCtx.currentTime : 0;
  state.eqState.gains.forEach((g, i) => {
    if (filters[i]) {
      if (audioCtx) {
        filters[i].gain.setTargetAtTime(g, now, timeConstant);
      } else {
        filters[i].gain.value = g;
      }
    }
  });
}

export function startWaveLoop() {
  if (!audio || audio.paused) return;
  const tick = (now) => {
    const dt = Math.min((now - lastWaveFrame) / 1000, 0.1);
    lastWaveFrame = now;

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

    if (!audio.paused) requestAnimationFrame(tick);
  };

  lastWaveFrame = performance.now();
  requestAnimationFrame(tick);
}

export function playSong(song, pushHistory = true) {
  if (!song) return;
  ensureGraph();

  const startNewSong = (nextSong, keepHistory) => {
    state.currentSong = nextSong;
    audio.src = nextSong.url;
    applyPitchAndRate();

    if (masterGain && audioCtx) {
      masterGain.gain.setTargetAtTime(currentVolumeTarget, audioCtx.currentTime, 0.2);
    }

    if (keepHistory) {
      const history = window.__musicHistory || [];
      if (!history.length || history[history.length - 1]?.name !== nextSong.name) {
        history.push(nextSong);
        window.__musicHistory = history;
      }
    }

    if (el.nowTitle) el.nowTitle.textContent = nextSong.title;
    if (el.nowSub) el.nowSub.textContent = nextSong.artist;
    if (el.miniTitle) el.miniTitle.textContent = nextSong.title;

    resumeAudioCtx();
    audio.play().catch(() => {});
  };

  if (state.crossfade && audio.src && !audio.paused && masterGain) {
    masterGain.gain.setTargetAtTime(0.001, audioCtx.currentTime, 0.15);
    setTimeout(() => startNewSong(song, pushHistory), 200);
  } else {
    startNewSong(song, pushHistory);
  }
}

export function toggleWaveMode(mode) {
  state.waveMode = mode;
  if (el.waveModeBtns) {
    el.waveModeBtns.querySelectorAll("button").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.wave === mode);
    });
  }
}

export function setWaveMode(mode) {
  toggleWaveMode(mode);
  try {
    localStorage.setItem("mp_wavemode_v12", mode);
  } catch {}
}
