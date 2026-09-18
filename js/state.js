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
  Normal: [0, 0, 0, 0, 0],
  Pop: [2, 1, 0, 2, 3],
  Rock: [4, 2, -1, 2, 4],
  Jazz: [3, 2, 1, 2, 2],
  "Bass Boost": [6, 4, 0, 0, 0]
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
  eqState: { preset: "Normal", gains: [0, 0, 0, 0, 0] },
  shuffle: true,
  repeat: false,
  favOnly: false,
  search: "",
  themeMode: "system",
  customTheme: {
    c1: "#1d3557",
    l1: 100,
    c2: "#121212",
    l2: 100,
    text: "#ffffff",
    lText: 100,
    dir: "180deg"
  },
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
  btnResetFiles: document.getElementById("btnResetFiles"),
  search: document.getElementById("search"),
  list: document.getElementById("list"),
  nowTitle: document.getElementById("nowTitle"),
  nowSub: document.getElementById("nowSub"),
  miniTitle: document.getElementById("miniTitle"),
  miniCoverCanvas: document.getElementById("miniCoverCanvas"),
  pillSongs: document.getElementById("pillSongs"),
  pillFavs: document.getElementById("pillFavs"),
  btnShortcutHelp: document.getElementById("btnShortcutHelp"),
  statPlays: document.getElementById("statPlays"),
  statSongs: document.getElementById("statSongs"),
  btnResetStats: document.getElementById("btnResetStats"),
  playHistoryChart: document.getElementById("playHistoryChart"),
  queueList: document.getElementById("queueList"),
  eqPresetRow: document.getElementById("eqPresetRow"),
  eqBands: document.getElementById("eqBands"),
  btnMenu: document.getElementById("btnMenu"),
  btnCloseMenu: document.getElementById("btnCloseMenu"),
  btnSideBack: document.getElementById("btnSideBack"),
  sideTitle: document.getElementById("sideTitle"),
  overlay: document.getElementById("overlay"),
  sidebar: document.getElementById("sidebar"),
  sidebarInner: document.getElementById("sidebarInner"),
  mainMenuList: document.getElementById("mainMenuList"),
  btnPrev: document.getElementById("btnPrev"),
  btnRewind10: document.getElementById("btnRewind10"),
  btnPlay: document.getElementById("btnPlay"),
  btnForward10: document.getElementById("btnForward10"),
  btnNext: document.getElementById("btnNext"),
  btnFav: document.getElementById("btnFav"),
  btnMainShuffle: document.getElementById("btnMainShuffle"),
  btnMainRepeat: document.getElementById("btnMainRepeat"),
  miniPrev: document.getElementById("miniPrev"),
  miniPlay: document.getElementById("miniPlay"),
  miniNext: document.getElementById("miniNext"),
  btnMuteToggle: document.getElementById("btnMuteToggle"),
  volume: document.getElementById("volume"),
  volText: document.getElementById("volText"),
  playbackRate: document.getElementById("playbackRate"),
  customRateInput: document.getElementById("customRateInput"),
  rateText: document.getElementById("rateText"),
  pitchShift: document.getElementById("pitchShift"),
  pitchText: document.getElementById("pitchText"),
  progress: document.getElementById("progress"),
  miniProgress: document.getElementById("miniProgress"),
  timeNow: document.getElementById("timeNow"),
  timeAll: document.getElementById("timeAll"),
  wave: document.getElementById("wave"),
  waveModeBtns: document.getElementById("waveModeBtns"),
  btnQueueClear: document.getElementById("btnQueueClear"),
  btnQueueShuffle: document.getElementById("btnQueueShuffle"),
  btnEqReset: document.getElementById("btnEqReset"),
  toast: document.getElementById("toast"),
  btnThemeSystem: document.getElementById("btnThemeSystem"),
  btnThemeDark: document.getElementById("btnThemeDark"),
  btnThemeLight: document.getElementById("btnThemeLight"),
  btnThemeCustom: document.getElementById("btnThemeCustom"),
  customThemeArea: document.getElementById("customThemeArea"),
  gridColor1: document.getElementById("gridColor1"),
  gridColor2: document.getElementById("gridColor2"),
  gridTextColor: document.getElementById("gridTextColor"),
  sliderL1: document.getElementById("sliderL1"),
  sliderL2: document.getElementById("sliderL2"),
  sliderLText: document.getElementById("sliderLText"),
  txtL1: document.getElementById("txtL1"),
  txtL2: document.getElementById("txtL2"),
  txtLText: document.getElementById("txtLText"),
  gradDirectionList: document.getElementById("gradDirectionList"),
  nowCoverCanvas: document.getElementById("nowCoverCanvas"),
  btnCrossfade: document.getElementById("btnCrossfade"),
  btnSilenceSkip: document.getElementById("btnSilenceSkip"),
  dModeBtns: document.getElementById("dModeBtns"),
  dModeDesc: document.getElementById("dModeDesc"),
  pannerSlider: document.getElementById("pannerSlider"),
  pannerValText: document.getElementById("pannerValText"),
  newPlName: document.getElementById("newPlName"),
  btnCreatePl: document.getElementById("btnCreatePl"),
  playlistContainer: document.getElementById("playlistContainer"),
  plAlertModal: document.getElementById("plAlertModal"),
  btnClosePlModal: document.getElementById("btnClosePlModal"),
  shortcutModal: document.getElementById("shortcutModal"),
  btnCloseShortcutModal: document.getElementById("btnCloseShortcutModal"),
  timerStatus: document.getElementById("timerStatus"),
  customTimerInput: document.getElementById("customTimerInput"),
  btnSetCustomTimer: document.getElementById("btnSetCustomTimer"),
  plSelectSheet: document.getElementById("plSelectSheet"),
  plSelectList: document.getElementById("plSelectList"),
  btnClosePlSheet: document.getElementById("btnClosePlSheet"),
  btnBulkAddPl: document.getElementById("btnBulkAddPl")
};

export function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
