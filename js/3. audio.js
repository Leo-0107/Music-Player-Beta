// js/audio.js
const audio = new Audio();
audio.preload = "auto";

let audioCtx = null, sourceNode = null, filters = [], masterGain = null, limiterNode = null, pannerNode = null, panner3DNode = null, analyser = null, analyserData = null;
let audioGraphReady = false;

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

function updateSpatialAudio(dt) {
  if (!audioCtx || !panner3DNode || audio.paused) return;
  const rotationSpeed = 1.5;
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

function playSong(song, pushHistory = true){
  if(!song) return;
  ensureGraph();
  
  if(state.crossfade && audio.src && !audio.paused && masterGain) {
    masterGain.gain.setTargetAtTime(0.001, audioCtx.currentTime, 0.15);
    setTimeout(() => startNewSong(song, pushHistory), 200);
  } else {
    startNewSong(song, pushHistory);
  }
}

function startNewSong(song, pushHistory) {
  state.currentSong = song;
  hasCountedCurrentSong = false;
  silenceTimer = 0;
  audio.src = song.url;
  applyPitchAndRate();
  
  if(masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(currentVolumeTarget, audioCtx.currentTime, 0.2);
  }

  if(pushHistory) {
    if(historyIndex === -1 || historyStack[historyIndex]?.name !== song.name) {
      historyStack.splice(historyIndex + 1);
      historyStack.push(song);
      historyIndex = historyStack.length - 1;
    }
  }

  updateArtwork(song);
  updateNowPlayingUI(song);
  resumeAudioCtx();
  audio.play().then(() => {
    requestWakeLock();
    lastFrameTime = performance.now();
    startWaveAnimation();
  }).catch(()=>{});
}

function playPause(){
  if(!state.currentSong && state.playlist.length) return playSong(getVisibleSongs()[0]);
  if(audio.paused) {
    audio.play().then(() => {
      requestWakeLock();
      lastFrameTime = performance.now();
      startWaveAnimation();
    }).catch(()=>{});
  } else {
    audio.pause();
    releaseWakeLock();
  }
  updatePlayPauseUI();
}

function prevTrack(){
  if(historyIndex > 0) {
    historyIndex--;
    playSong(historyStack[historyIndex], false);
  } else {
    const vis = getVisibleSongs();
    if(!vis.length) return;
    const idx = vis.findIndex(s => s.name === state.currentSong?.name);
    playSong(vis[(idx - 1 + vis.length) % vis.length]);
  }
}

function nextTrack(isAuto = false){
  if(!isAuto && historyIndex < historyStack.length - 1) {
    historyIndex++;
    playSong(historyStack[historyIndex], false);
    return;
  }

  if (isAuto && historyIndex < historyStack.length - 1) {
    historyStack.splice(historyIndex + 1);
  }

  const vis = getVisibleSongs();
  if(!vis.length) return;
  if(state.queue.length){
    const name = state.queue.shift();
    saveState();
    renderQueue();
    const s = state.playlist.find(x => x.name === name);
    if(s) return playSong(s);
  }
  if(state.shuffle){
    const next = vis[Math.floor(Math.random() * vis.length)];
    return playSong(next);
  }
  const idx = vis.findIndex(s => s.name === state.currentSong?.name);
  playSong(vis[(idx + 1) % vis.length]);
}