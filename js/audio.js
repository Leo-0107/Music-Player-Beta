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
export let currentVolumeTarget = 1.0;
export let currentRate = 1.0;

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
  } catch {}
}

export function applyPitchAndRate() {
  const pitchFactor = Math.pow(2, state.pitchSemitones / 12);
  audio.playbackRate = currentRate * pitchFactor;
  audio.preservesPitch = false;
  if (el.rateText) el.rateText.textContent = `${currentRate.toFixed(2)}x`;
  if (el.pitchText) el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
}

export function updateVolumeUI(targetVal, isMuteAction = false) {
  const prevVol = currentVolumeTarget;
  currentVolumeTarget = Math.max(0, targetVal);
  if (el.volume) el.volume.value = currentVolumeTarget;
  if (el.volText) el.volText.textContent = `${Math.round(currentVolumeTarget * 100)}%`;
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
}

export function playSong(song) {
  if (!song) return;
  ensureGraph();
  state.currentSong = song;
  audio.src = song.url;
  applyPitchAndRate();
  if (masterGain && audioCtx) {
    masterGain.gain.setTargetAtTime(currentVolumeTarget, audioCtx.currentTime, 0.2);
  }
  audio.play().catch(() => {});
}
