export const STORAGE = {
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

export const EQ_PRESETS = {
  Normal: [0,0,0,0,0],
  Pop: [2,1,0,2,3],
  Rock: [4,2,-1,2,4],
  Jazz: [3,2,1,2,2],
  "Bass Boost": [6,4,0,0,0]
};

export const COLOR_PALETTE_12 = [
  "#e63946", "#f77f00", "#fcbf49", "#aacc00",
  "#2b9348", "#00a896", "#0077b6", "#1d3557",
  "#7209b7", "#f72585", "#121212", "#ffffff"
];

export const state = {
  playlist: [],
  currentSong: null,
  favorites: [],
  queue: [],
  playCounts: {},
  playHistory: {},
  eqState: { preset: "Normal", gains: [0,0,0,0,0] },
  shuffle: true,
  repeat: false,
  favOnly: false,
  search: "",
  themeMode: "system",
  customTheme: { c1: "#1d3557", l1: 100, c2: "#121212", l2: 100, text: "#ffffff", lText: 100, dir: "180deg" },
  pitchSemitones: 0,
  playlists: {},
  crossfade: true,
  silenceSkip: true,
  dMode: "2D",
  waveMode: "3d",
  panValue: 0,
  menuOpen: false
};

export const el = {
  shell: document.getElementById("shell"),
  folder: document.getElementById("folder"),
  search: document.getElementById("search"),
  list: document.getElementById("list"),
  nowTitle: document.getElementById("nowTitle"),
  nowSub: document.getElementById("nowSub"),
  miniTitle: document.getElementById("miniTitle"),
  btnPlay: document.getElementById("btnPlay"),
  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  btnFav: document.getElementById("btnFav"),
  volume: document.getElementById("volume"),
  volText: document.getElementById("volText"),
  toast: document.getElementById("toast"),
  queueList: document.getElementById("queueList"),
  btnMainShuffle: document.getElementById("btnMainShuffle"),
  btnMainRepeat: document.getElementById("btnMainRepeat"),
  btnMuteToggle: document.getElementById("btnMuteToggle"),
  progress: document.getElementById("progress"),
  miniProgress: document.getElementById("miniProgress"),
  timeNow: document.getElementById("timeNow"),
  timeAll: document.getElementById("timeAll"),
  pillSongs: document.getElementById("pillSongs"),
  pillFavs: document.getElementById("pillFavs"),
  statPlays: document.getElementById("statPlays"),
  statSongs: document.getElementById("statSongs"),
  playHistoryChart: document.getElementById("playHistoryChart"),
  btnResetStats: document.getElementById("btnResetStats"),
  btnResetFiles: document.getElementById("btnResetFiles")
};

export function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
