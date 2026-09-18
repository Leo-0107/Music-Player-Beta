// js/state.js
const STORAGE = {
  favorites: "mp_favs_v12",
  queue: "mp_queue_v12",
  playCounts: "mp_counts_v12",
  playHistory: "mp_history_v12",
  eqState: "mp_eq_v12",
  volume: "mp_vol_v12",
  pitch: "mp_pitch_v12",
  shuffle: "mp_shuffle_v12",
  repeat: "mp_repeat_v12",
  favOnly: "mp_favonly_v12",
  themeMode: "mp_thememode_v12",
  customTheme: "mp_custtheme_v12",
  playlists: "mp_playlists_v12",
  crossfade: "mp_crossfade_v12",
  silenceSkip: "mp_silenceskip_v12",
  dMode: "mp_dmode_v12",
  waveMode: "mp_wavemode_v12"
};

const EQ_PRESETS = {
  "Normal": [0,0,0,0,0],
  "Pop": [2,1,0,2,3],
  "Rock": [4,2,-1,2,4],
  "Jazz": [3,2,1,2,2],
  "Bass Boost": [6,4,0,0,0]
};

const COLOR_PALETTE_12 = [
  "#e63946", "#f77f00", "#fcbf49", "#aacc00", 
  "#2b9348", "#00a896", "#0077b6", "#1d3557", 
  "#7209b7", "#f72585", "#121212", "#ffffff"
];

function loadJSON(k, f){ try{ const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; }catch{ return f; } }
function loadBool(k, f){ const r = localStorage.getItem(k); return r === null ? f : r; }
function loadNum(k, f){ const r = localStorage.getItem(k); const n = Number(r); return Number.isFinite(n) ? n : f; }
function loadStr(k, f){ const r = localStorage.getItem(k); return r === null ? f : r; }

const state = {
  playlist: [],
  currentSong: null,
  favorites: loadJSON(STORAGE.favorites, []),
  queue: loadJSON(STORAGE.queue, []),
  playCounts: loadJSON(STORAGE.playCounts, {}),
  playHistory: loadJSON(STORAGE.playHistory, {}),
  eqState: loadJSON(STORAGE.eqState, { preset: "Normal", gains: [0,0,0,0,0] }),
  shuffle: loadBool(STORAGE.shuffle, true),
  repeat: loadBool(STORAGE.repeat, false),
  favOnly: loadBool(STORAGE.favOnly, false),
  search: "",
  themeMode: loadStr(STORAGE.themeMode, "system"),
  customTheme: loadJSON(STORAGE.customTheme, { 
    c1: "#1d3557", l1: 100, 
    c2: "#121212", l2: 100, 
    text: "#ffffff", lText: 100, 
    dir: "180deg" 
  }),
  pitchSemitones: loadNum(STORAGE.pitch, 0),
  playlists: loadJSON(STORAGE.playlists, {}),
  crossfade: loadBool(STORAGE.crossfade, true),
  silenceSkip: loadBool(STORAGE.silenceSkip, true),
  dMode: loadStr(STORAGE.dMode, "2D"),
  waveMode: loadStr(STORAGE.waveMode, "3d"),
  panValue: 0,
  menuOpen: false
};

let activeObjectURLMap = new Map();
let isWaveAnimating = false;
let lastFrameTime = performance.now();
let silenceTimer = 0;
let currentRate = 1.0;
let spatialAngle = 0;
let targetSongForPlaylist = null;
let bulkTargetPlaylist = null;
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
let isSlidingRange = false;
let songListResizeTimer;

function saveState(){
  localStorage.setItem(STORAGE.favorites, JSON.stringify(state.favorites));
  localStorage.setItem(STORAGE.queue, JSON.stringify(state.queue));
  localStorage.setItem(STORAGE.playCounts, JSON.stringify(state.playCounts));
  localStorage.setItem(STORAGE.playHistory, JSON.stringify(state.playHistory));
  localStorage.setItem(STORAGE.eqState, JSON.stringify(state.eqState));
  localStorage.setItem(STORAGE.volume, String(currentVolumeTarget));
  localStorage.setItem(STORAGE.pitch, String(state.pitchSemitones));
  localStorage.setItem(STORAGE.shuffle, String(state.shuffle));
  localStorage.setItem(STORAGE.repeat, String(state.repeat));
  localStorage.setItem(STORAGE.favOnly, String(state.favOnly));
  localStorage.setItem(STORAGE.themeMode, state.themeMode);
  localStorage.setItem(STORAGE.customTheme, JSON.stringify(state.customTheme));
  localStorage.setItem(STORAGE.playlists, JSON.stringify(state.playlists));
  localStorage.setItem(STORAGE.crossfade, String(state.crossfade));
  localStorage.setItem(STORAGE.silenceSkip, String(state.silenceSkip));
  localStorage.setItem(STORAGE.dMode, state.dMode);
  localStorage.setItem(STORAGE.waveMode, state.waveMode);
}
