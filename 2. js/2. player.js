// script.js
(() => {
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

  const dbName = "Music Player v3.8";
  let db = null;
  const activeObjectURLMap = new Map();
  let isWaveAnimating = false;

  let lastFrameTime = performance.now();
  let silenceTimer = 0;

  function escapeHTML(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanUpObjectURLs() {
    const currentName = state.currentSong?.name;
    for (const [name, urls] of activeObjectURLMap.entries()) {
      if (name !== currentName) {
        if (urls.url) URL.revokeObjectURL(urls.url);
        if (urls.coverUrl) URL.revokeObjectURL(urls.coverUrl);
        activeObjectURLMap.delete(name);
      }
    }
  }

  function revokeAllObjectURLs() {
    for (const [name, urls] of activeObjectURLMap.entries()) {
      if (urls.url) URL.revokeObjectURL(urls.url);
      if (urls.coverUrl) URL.revokeObjectURL(urls.coverUrl);
    }
    activeObjectURLMap.clear();
  }

  function initDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks", { keyPath: "name" });
        };
        req.onsuccess = e => { db = e.target.result; resolve(); };
        req.onerror = () => {
          toast("データベースの接続に失敗しました");
          resolve();
        };
      } catch (e) {
        toast("IndexedDBがサポートされていないかアクセスできません");
        resolve();
      }
    });
  }

  function saveTrackToDB(trackData) {
    if (!db) return;
    try {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").put(trackData);
      tx.onerror = () => toast("トラックの保存中にエラーが発生しました");
    } catch (e) {}
  }

  function deleteTrackFromDB(name) {
    return new Promise(resolve => {
      if (!db) return resolve();
      try {
        const tx = db.transaction("tracks", "readwrite");
        tx.objectStore("tracks").delete(name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => {
          toast("トラックの削除に失敗しました");
          resolve();
        };
      } catch {
        resolve();
      }
    });
  }

  function loadTracksFromDB() {
    return new Promise(resolve => {
      if (!db) return resolve([]);
      try {
        const tx = db.transaction("tracks", "readonly");
        const req = tx.objectStore("tracks").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  function decodeID3String(byteArray) {
    if (!byteArray || !byteArray.length) return "";
    const encoding = byteArray[0];
    const data = byteArray.subarray(1);
    try {
      if (encoding === 1 || encoding === 2) {
        return new TextDecoder("utf-16").decode(data).replace(/\0/g, '').trim();
      } else {
        return new TextDecoder("utf-8").decode(data).replace(/\0/g, '').trim();
      }
    } catch {
      return "";
    }
  }

  function parseID3(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const buf = e.target.result;
        const view = new DataView(buf);
        let title = file.name.replace(/\.[^/.]+$/, "");
        let artist = "不明なアーティスト";
        let coverBlob = null;

        if (buf.byteLength > 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
          let offset = 10;
          const size = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9);
          while (offset < size + 10 && offset + 10 <= buf.byteLength) {
            const frameID = String.fromCharCode(view.getUint8(offset), view.getUint8(offset+1), view.getUint8(offset+2), view.getUint8(offset+3));
            const frameSize = view.getUint32(offset + 4);
            if (frameSize <= 0 || offset + 10 + frameSize > buf.byteLength) break;
            const frameData = new Uint8Array(buf, offset + 10, frameSize);
            
            try {
              if (frameID === "TIT2") {
                title = decodeID3String(frameData) || title;
              } else if (frameID === "TPE1") {
                artist = decodeID3String(frameData) || artist;
              } else if (frameID === "APIC") {
                const encoding = frameData[0];
                let p = 1;
                while (p < frameData.length && frameData[p] !== 0) p++;
                const mime = new TextDecoder("ascii").decode(frameData.subarray(1, p)) || "image/jpeg";
                let imgStart = p + 2;
                if (encoding === 1 || encoding === 2) {
                  while (imgStart < frameData.length - 1) {
                    if (frameData[imgStart] === 0 && frameData[imgStart + 1] === 0) {
                      imgStart += 2;
                      break;
                    }
                    imgStart += 2;
                  }
                } else {
                  while (imgStart < frameData.length && frameData[imgStart] !== 0) imgStart++;
                  imgStart += 1;
                }
                if (imgStart < frameData.length) {
                  coverBlob = new Blob([frameData.subarray(imgStart)], { type: mime });
                }
              }
            } catch {}
            offset += 10 + frameSize;
          }
        }
        resolve({ title, artist, coverBlob });
      };
      reader.onerror = () => resolve({ title: file.name.replace(/\.[^/.]+$/, ""), artist: "不明なアーティスト", coverBlob: null });
      reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
    });
  }

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

  function loadJSON(k, f){ try{ const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; }catch{ return f; } }
  function loadBool(k, f){ const r = localStorage.getItem(k); return r === null ? f : r === "true"; }
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

  const el = {
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

  const titleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const container = entry.target;
      container._isIntersecting = entry.isIntersecting;
      const textEl = container.querySelector(".scroll-text");
      if (textEl && textEl.classList.contains("scrolling")) {
        if (entry.isIntersecting && document.visibilityState === "visible") {
          textEl.style.animationPlayState = "running";
        } else {
          textEl.style.animationPlayState = "paused";
        }
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll(".scroll-container").forEach(c => titleObserver.observe(c));

  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll(".scroll-container").forEach(container => {
      const textEl = container.querySelector(".scroll-text");
      if (textEl && textEl.classList.contains("scrolling")) {
        if (document.visibilityState === "visible" && container._isIntersecting) {
          textEl.style.animationPlayState = "running";
        } else {
          textEl.style.animationPlayState = "paused";
        }
      }
    });
    if (document.visibilityState === "visible" && !audio.paused) {
      lastFrameTime = performance.now();
      startWaveAnimation();
    }
