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

  function initDB() {
    return new Promise(resolve => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks", { keyPath: "name" });
      };
      req.onsuccess = e => { db = e.target.result; resolve(); };
      req.onerror = () => resolve();
    });
  }

  function saveTrackToDB(trackData) {
    if (!db) return;
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(trackData);
  }

  function deleteTrackFromDB(name) {
    return new Promise(resolve => {
      if (!db) return resolve();
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  function loadTracksFromDB() {
    return new Promise(resolve => {
      if (!db) return resolve([]);
      const tx = db.transaction("tracks", "readonly");
      const req = tx.objectStore("tracks").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
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
          while (offset < size + 10 && offset + 10 < buf.byteLength) {
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
                let p = 1;
                while(p < frameData.length && frameData[p] !== 0) p++;
                const mime = new TextDecoder("ascii").decode(frameData.subarray(1, p)) || "image/jpeg";
                let imgStart = p + 2;
                while(imgStart < frameData.length && frameData[imgStart] === 0) imgStart++;
                coverBlob = new Blob([frameData.subarray(imgStart)], { type: mime });
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

  let audioCtx = null, sourceNode = null, filters = [], masterGain = null, pannerNode = null, panner3DNode = null, analyser = null, analyserData = null;
  let audioGraphReady = false;
  let currentRate = 1.0;
  let spatialAngle = 0;
  let targetSongForPlaylist = null;
  let lastUnmutedVolume = 1.0;
  let currentVolumeTarget = loadNum(STORAGE.volume, 1.0); // デフォルト100% (1.0)
  let eqAnimId = null;
  let wakeLock = null;

  const historyStack = [];
  let historyIndex = -1;

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
    folderPicker: document.getElementById("folderPicker"),
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
    seekbarHeatmap: document.getElementById("seekbarHeatmap"),
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
    btnClosePlSheet: document.getElementById("btnClosePlSheet")
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
  });

  function updateTitleTextAndScroll(element, text) {
    if (!element) return;
    const container = element.closest(".scroll-container");
    element.classList.remove("scrolling");
    element.style.animationPlayState = "paused";
    element.textContent = text;

    requestAnimationFrame(() => {
      if (!container) return;
      const overflow = element.scrollWidth - container.clientWidth;
      if (overflow > 6) {
        element.style.setProperty("--scroll-dist", `-${overflow + 12}px`);
        element.classList.add("scrolling");
        if (container._isIntersecting && document.visibilityState === "visible") {
          element.style.animationPlayState = "running";
        }
      }
    });
  }

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

  function fmtTime(sec){
    if(!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function toast(msg){
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove("show"), 1400);
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
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1.0,
          position: audio.currentTime || 0
        });
      }
    }
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
      audio.volume = Math.min(1.0, currentVolumeTarget);

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
      masterGain.connect(analyser);
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
    el.rateText.textContent = `${currentRate.toFixed(2)}x`;
    el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
    updateMediaSessionPosition();
  }

  function updateSpatialAudio() {
    if (!audioCtx || !panner3DNode || audio.paused) return;
    spatialAngle += 0.025;
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

  function applyTheme(){
    document.body.classList.remove("theme-light");
    [el.btnThemeSystem, el.btnThemeDark, el.btnThemeLight, el.btnThemeCustom].forEach(b => b?.classList.remove("active"));
    el.customThemeArea.style.display = "none";

    document.body.style.removeProperty("--text");
    document.body.style.removeProperty("--muted");

    let activeMode = state.themeMode;
    if(activeMode === "system"){
      el.btnThemeSystem.classList.add("active");
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeMode = isSystemDark ? "dark" : "light";
    }

    if(activeMode === "light"){
      document.body.classList.add("theme-light");
      document.body.style.background = "";
      document.body.style.color = "";
      if(state.themeMode === "light") el.btnThemeLight.classList.add("active");
    } else if(activeMode === "custom"){
      el.btnThemeCustom.classList.add("active");
      el.customThemeArea.style.display = "block";

      const { c1, l1, c2, l2, text, lText, dir } = state.customTheme;
      const computedC1 = adjustColorLightness(c1 || "#1d3557", l1 !== undefined ? l1 : 100);
      const computedC2 = adjustColorLightness(c2 || "#121212", l2 !== undefined ? l2 : 100);
      
      const baseLText = lText !== undefined ? lText : 100;
      const computedText = adjustColorLightness(text || "#ffffff", baseLText);
      const computedMuted = adjustColorLightness(text || "#ffffff", Math.round(baseLText * 0.65));

      document.body.style.background = `linear-gradient(${dir || "180deg"}, ${computedC1} 0%, ${computedC2} 100%)`;
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.color = computedText;
      
      document.body.style.setProperty("--text", computedText);
      document.body.style.setProperty("--muted", computedMuted);
    } else {
      document.body.style.background = "";
      document.body.style.color = "";
      if(state.themeMode === "dark") el.btnThemeDark.classList.add("active");
    }
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if(state.themeMode === "system") applyTheme();
  });

  function renderColorPickers(){
    const targets = [
      { grid: el.gridColor1, key: "c1" },
      { grid: el.gridColor2, key: "c2" },
      { grid: el.gridTextColor, key: "text" }
    ];

    targets.forEach(({ grid, key }) => {
      if(!grid) return;
      grid.innerHTML = "";
      const current = state.customTheme[key];
      COLOR_PALETTE_12.forEach(color => {
        const dot = document.createElement("div");
        dot.className = "colorDot" + (current === color ? " selected" : "");
        dot.style.background = color;
        dot.addEventListener("click", () => {
          state.customTheme[key] = color;
          saveState();
          applyTheme();
          renderColorPickers();
        });
        grid.appendChild(dot);
      });
    });

    if(el.sliderL1) el.sliderL1.value = state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100;
    if(el.sliderL2) el.sliderL2.value = state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100;
    if(el.sliderLText) el.sliderLText.value = state.customTheme.lText !== undefined ? state.customTheme.lText : 100;
    if(el.txtL1) el.txtL1.textContent = `${el.sliderL1.value}%`;
    if(el.txtL2) el.txtL2.textContent = `${el.sliderL2.value}%`;
    if(el.txtLText) el.txtLText.textContent = `${el.sliderLText.value}%`;

    document.querySelectorAll(".gradOption").forEach(opt => {
      opt.classList.toggle("selected", opt.dataset.deg === (state.customTheme.dir || "180deg"));
    });
  }

  document.querySelectorAll(".gradOption").forEach(opt => {
    opt.addEventListener("click", () => {
      state.customTheme.dir = opt.dataset.deg;
      saveState();
      applyTheme();
      renderColorPickers();
    });
  });

  [{ slider: el.sliderL1, txt: el.txtL1, key: "l1" },
   { slider: el.sliderL2, txt: el.txtL2, key: "l2" },
   { slider: el.sliderLText, txt: el.txtLText, key: "lText" }].forEach(({ slider, txt, key }) => {
    if(!slider) return;
    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      state.customTheme[key] = val;
      txt.textContent = `${val}%`;
      saveState();
      applyTheme();
    });
  });

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

  el.btnEqReset.addEventListener("click", () => {
    state.eqState.preset = "Normal";
    animateEqPreset([0,0,0,0,0]);
    updatePresetButtonsUI();
  });

  function updateArtwork(song) {
    const drawCanvas = (canvas, size) => {
      if(!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, size, size);

      if (song?.coverUrl) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, size, size);
        img.src = song.coverUrl;
        return;
      }

      ctx.fillStyle = "rgba(35, 35, 40, 0.9)";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
      ctx.font = `bold ${Math.round(size / 6.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("NO IMAGE", size / 2, size / 2);
    };

    drawCanvas(el.nowCoverCanvas, 160);
    drawCanvas(el.miniCoverCanvas, 32);
  }

  function downloadSingleSong(song) {
    if (!song) return;
    loadTracksFromDB().then(tracks => {
      const dbTrack = tracks.find(t => t.name === song.name);
      if (dbTrack && dbTrack.blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(dbTrack.blob);
        a.download = song.name;
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        toast("ファイルの取得に失敗しました");
      }
    });
  }

  el.btnResetFiles.addEventListener("click", () => {
    if (!confirm("保存された全トラックを削除しますか？")) return;
    if (db) {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").clear();
    }
    state.playlist = [];
    state.currentSong = null;
    state.queue = [];
    state.playlists = {};
    audio.pause();
    audio.src = "";
    if (el.folder) el.folder.value = "";
    if (el.folderPicker) el.folderPicker.value = "";
    updateArtwork(null);
    updateTitleTextAndScroll(el.nowTitle, "未再生");
    updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
    updateTitleTextAndScroll(el.miniTitle, "停止中");
    saveState();
    renderAll();
    toast("全ファイルをリセットしました");
  });

  // ドラッグ＆ドロップ時にフォルダ階層を再帰的に解析する関数
  async function scanFilesFromDataTransfer(items) {
    const fileList = [];
    const entryPromises = [];

    function traverseFileTree(item) {
      return new Promise(resolve => {
        if (item.isFile) {
          item.file(file => {
            fileList.push(file);
            resolve();
          }, () => resolve());
        } else if (item.isDirectory) {
          const dirReader = item.createReader();
          dirReader.readEntries(async entries => {
            for (const entry of entries) {
              await traverseFileTree(entry);
            }
            resolve();
          }, () => resolve());
        } else {
          resolve();
        }
      });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
      if (item) {
        entryPromises.push(traverseFileTree(item));
      } else if (items[i].getAsFile) {
        const file = items[i].getAsFile();
        if (file) fileList.push(file);
      }
    }
    await Promise.all(entryPromises);
    return fileList;
  }

  // ファイル・Zip・フォルダ読込統合処理
  async function loadFiles(fileList){
    const files = Array.from(fileList || []);
    if(!files.length) return;

    toast(`ファイルの解析・読み込み中...`);

    const directAudioFiles = files.filter(f => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
    const zipFiles = files.filter(f => /\.zip$/i.test(f.name));

    // Zipファイルを自動で解析し、プレイリストとして登録
    for (const zipFile of zipFiles) {
      if (typeof JSZip === "undefined") {
        toast("Zipライブラリが見つかりません");
        continue;
      }
      try {
        const plName = zipFile.name.replace(/\.zip$/i, "");
        if (!state.playlists[plName]) {
          state.playlists[plName] = [];
        }

        const zip = await JSZip.loadAsync(zipFile);
        const fileKeys = Object.keys(zip.files);

        for (const filename of fileKeys) {
          const entry = zip.files[filename];
          if (!entry.dir && /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(filename)) {
            const blob = await entry.async("blob");
            const cleanName = filename.split('/').pop();
            const audioFile = new File([blob], cleanName, { type: blob.type || "audio/mpeg" });
            const meta = await parseID3(audioFile);

            saveTrackToDB({
              name: audioFile.name,
              title: meta.title,
              artist: meta.artist,
              blob: audioFile,
              coverBlob: meta.coverBlob
            });

            if (!state.playlists[plName].includes(audioFile.name)) {
              state.playlists[plName].push(audioFile.name);
            }
          }
        }
        toast(`Zip「${plName}」をプレイリストとして追加しました`);
      } catch (e) {
        toast("Zipファイルの解析エラーが発生しました");
      }
    }

    // 単体音声ファイルまたはフォルダ内の音声ファイル読込
    for (const f of directAudioFiles) {
      const meta = await parseID3(f);
      saveTrackToDB({
        name: f.name,
        title: meta.title,
        artist: meta.artist,
        blob: f,
        coverBlob: meta.coverBlob
      });
    }

    saveState();
    await reloadPlaylistFromDB();
    renderPlaylists();
    toast(`読み込み完了！`);
  }

  async function reloadPlaylistFromDB() {
    const tracks = await loadTracksFromDB();
    state.playlist = tracks.map(t => ({
      name: t.name,
      title: t.title || t.name,
      artist: t.artist || "不明なアーティスト",
      url: URL.createObjectURL(t.blob),
      coverUrl: t.coverBlob ? URL.createObjectURL(t.coverBlob) : null
    })).sort((a,b) => a.title.localeCompare(b.title, "ja", {numeric:true}));
    renderAll();
  }

  async function deleteSingleTrack(song) {
    if(!song) return;
    if(!confirm(`「${song.title}」を削除しますか？`)) return;

    await deleteTrackFromDB(song.name);
    
    if (state.currentSong?.name === song.name) {
      audio.pause();
      audio.src = "";
      state.currentSong = null;
      updateArtwork(null);
      updateTitleTextAndScroll(el.nowTitle, "未再生");
      updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
      updateTitleTextAndScroll(el.miniTitle, "停止中");
    }

    state.queue = state.queue.filter(q => q !== song.name);
    state.favorites = state.favorites.filter(f => f !== song.name);
    
    await reloadPlaylistFromDB();
    toast("曲を削除しました");
  }

  function getVisibleSongs(){
    let list = state.playlist.slice();
    if(state.search){
      const q = state.search.toLowerCase();
      list = list.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    if(state.favOnly) list = list.filter(s => state.favorites.includes(s.name));
    return list;
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
    }).catch(()=>{});
  }

  function recordPlayCount() {
    if (!state.currentSong || hasCountedCurrentSong) return;
    hasCountedCurrentSong = true;
    const songName = state.currentSong.name;
    state.playCounts[songName] = (state.playCounts[songName] || 0) + 1;
    
    const today = new Date().toISOString().split('T')[0];
    state.playHistory[today] = (state.playHistory[today] || 0) + 1;

    saveState();
    renderStats();
    renderSongList();
  }

  function updatePlayPauseUI(){
    const isPlaying = !audio.paused && audio.src;
    el.btnPlay.textContent = isPlaying ? "❚❚ 一時停止" : "▶ 再生";
    el.miniPlay.textContent = isPlaying ? "❚❚" : "▶";
    el.btnPlay.classList.toggle("playing", isPlaying);
    el.miniPlay.classList.toggle("playing", isPlaying);

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }

    if (isPlaying) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }

  function updateNowPlayingUI(song){
    if(song){
      updateTitleTextAndScroll(el.nowTitle, song.title);
      updateTitleTextAndScroll(el.miniTitle, song.title);
      updateTitleTextAndScroll(el.nowSub, song.artist);
      el.btnFav.textContent = state.favorites.includes(song.name) ? "★" : "☆";
      el.btnFav.classList.toggle("active", state.favorites.includes(song.name));

      if ('mediaSession' in navigator) {
        const metadataInit = {
          title: song.title || 'Unknown Title',
          artist: song.artist || 'Unknown Artist'
        };
        if (song.coverUrl) {
          metadataInit.artwork = [{ src: song.coverUrl, sizes: '512x512', type: 'image/png' }];
        }
        navigator.mediaSession.metadata = new MediaMetadata(metadataInit);
      }
    }
    document.querySelectorAll(".song").forEach(n => {
      n.classList.toggle("active", n.dataset.name === song?.name);
    });
    updatePlayPauseUI();
    renderSeekbarHeatmap();
  }

  function playPause(){
    if(!state.currentSong && state.playlist.length) return playSong(getVisibleSongs()[0]);
    if(audio.paused) {
      audio.play().then(() => {
        requestWakeLock();
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

  function nextTrack(){
    if(historyIndex < historyStack.length - 1) {
      historyIndex++;
      playSong(historyStack[historyIndex], false);
      return;
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

  // 音量更新UI（0%〜200%可動、中央100%）
  function updateVolumeUI(targetVal, isMuteAction = false) {
    const prevVol = currentVolumeTarget;
    currentVolumeTarget = targetVal;
    if (el.volume) {
      el.volume.min = "0";
      el.volume.max = "2";
      el.volume.value = targetVal;
    }
    if (el.volText) {
      el.volText.textContent = `${Math.round(targetVal * 100)}%`;
    }
    if (el.btnMuteToggle) {
      el.btnMuteToggle.textContent = targetVal === 0 ? "🔇" : targetVal < 0.5 ? "🔉" : "🔊";
    }

    if(masterGain && audioCtx) {
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);

      if (targetVal > prevVol) {
        masterGain.gain.setTargetAtTime(targetVal, now, 0.35);
      } else {
        masterGain.gain.setTargetAtTime(targetVal, now, isMuteAction ? 0.02 : 0.05);
      }
    } else {
      audio.volume = Math.min(1.0, targetVal);
    }
    saveState();
  }

  if (el.volume) {
    el.volume.addEventListener("input", () => {
      updateVolumeUI(Number(el.volume.value));
    });
  }

  if (el.btnMuteToggle) {
    el.btnMuteToggle.addEventListener("click", () => {
      if (currentVolumeTarget > 0) {
        lastUnmutedVolume = currentVolumeTarget;
        updateVolumeUI(0, true);
        toast("消音（ミュート）");
      } else {
        updateVolumeUI(lastUnmutedVolume || 1, false);
        toast("消音解除");
      }
    });
  }

  function showPlAlertModal() { el.plAlertModal.classList.add("show"); }
  function hidePlAlertModal() { el.plAlertModal.classList.remove("show"); }
  if (el.btnClosePlModal) el.btnClosePlModal.addEventListener("click", hidePlAlertModal);
  if (el.plAlertModal) el.plAlertModal.addEventListener("click", e => { if(e.target === el.plAlertModal) hidePlAlertModal(); });

  function showShortcutModal() { el.shortcutModal.classList.add("show"); }
  function hideShortcutModal() { el.shortcutModal.classList.remove("show"); }
  if (el.btnShortcutHelp) el.btnShortcutHelp.addEventListener("click", showShortcutModal);
  if (el.btnCloseShortcutModal) el.btnCloseShortcutModal.addEventListener("click", hideShortcutModal);
  if (el.shortcutModal) el.shortcutModal.addEventListener("click", e => { if(e.target === el.shortcutModal) hideShortcutModal(); });

  function createPlaylist() {
    const name = el.newPlName.value.trim();
    if(!name) {
      showPlAlertModal();
      return;
    }
    if(!state.playlists[name]) state.playlists[name] = [];
    el.newPlName.value = "";
    saveState();
    renderPlaylists();
    toast(`プレイリスト「${name}」を作成しました`);
  }

  if (el.btnCreatePl) el.btnCreatePl.addEventListener("click", createPlaylist);
  if (el.newPlName) {
    el.newPlName.addEventListener("keydown", e => {
      if(e.key === "Enter") {
        e.preventDefault();
        createPlaylist();
      }
    });
  }

  function renderPlaylists(){
    if (!el.playlistContainer) return;
    el.playlistContainer.innerHTML = "";
    const names = Object.keys(state.playlists);
    if(!names.length) {
      el.playlistContainer.innerHTML = `<div style="color:var(--muted); font-size:.86rem">プレイリストがありません</div>`;
      return;
    }
    names.forEach(pName => {
      const card = document.createElement("div");
      card.className = "sectionCard";
      
      const tracksInPl = state.playlists[pName];
      const listDiv = document.createElement("div");
      listDiv.className = "plTrackList";

      if (!tracksInPl.length) {
        listDiv.innerHTML = `<div style="color:var(--muted); font-size:.78rem">曲がありません</div>`;
      } else {
        tracksInPl.forEach((songName, idx) => {
          const found = state.playlist.find(x => x.name === songName);
          const row = document.createElement("div");
          row.className = "plTrackItem";
          row.innerHTML = `
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
              ${!found ? '<span style="color:#f8d25c; margin-right:4px;" title="ファイルが見つかりません">▲</span>' : ''}
              <strong>${found ? found.title : songName.replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i, '')}</strong>
            </span>
            <div style="display:flex; gap:6px; align-items:center;">
              <button class="btn small playPlTrackBtn" style="padding:2px 8px;">▶</button>
              <button class="btn small ghost removePlSongBtn" style="padding:2px 6px;">✕</button>
            </div>
          `;
          
          row.querySelector(".playPlTrackBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (found) playSong(found);
          });
          row.addEventListener("click", () => {
            if (found) playSong(found);
          });

          row.querySelector(".removePlSongBtn").addEventListener("click", (e) => {
            e.stopPropagation();
            state.playlists[pName].splice(idx, 1);
            saveState();
            renderPlaylists();
          });
          listDiv.appendChild(row);
        });
      }

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:700; cursor:pointer;" class="plTitleText">${pName} (${tracksInPl.length}曲)</div>
          <div style="display:flex; gap:4px;">
            <button class="btn small renamePlBtn">名前変更</button>
            <button class="btn small playPlBtn">▶ 全曲再生</button>
            <button class="btn small ghost delPlBtn">✕</button>
          </div>
        </div>
      `;
      card.appendChild(listDiv);

      card.querySelector(".playPlBtn").addEventListener("click", () => {
        const songObjects = state.playlists[pName].map(n => state.playlist.find(x => x.name === n)).filter(Boolean);
        if(songObjects.length) playSong(songObjects[0]);
      });

      card.querySelector(".renamePlBtn").addEventListener("click", () => {
        const newName = prompt("新しいプレイリスト名を入力してください:", pName);
        if(newName && newName.trim() && newName !== pName) {
          state.playlists[newName.trim()] = state.playlists[pName];
          delete state.playlists[pName];
          saveState();
          renderPlaylists();
        }
      });

      card.querySelector(".delPlBtn").addEventListener("click", () => {
        delete state.playlists[pName];
        saveState();
        renderPlaylists();
      });

      el.playlistContainer.appendChild(card);
    });
  }

  function addSongToPlaylist(songName) {
    const plNames = Object.keys(state.playlists);
    if(!plNames.length) {
      toast("先にメニューのプレイリスト画面から作成してください");
      return;
    }
    targetSongForPlaylist = songName;
    renderPlSelectSheet();
    el.plSelectSheet.classList.add("show");
  }

  function closePlSelectSheet() {
    el.plSelectSheet.classList.remove("show");
    targetSongForPlaylist = null;
  }

  function renderPlSelectSheet() {
    el.plSelectList.innerHTML = "";
    const plNames = Object.keys(state.playlists);
    
    plNames.forEach(pName => {
      const item = document.createElement("div");
      item.className = "plSelectItem";
      const count = state.playlists[pName].length;
      item.innerHTML = `
        <div style="font-weight:600;">${pName}</div>
        <div style="color:var(--muted); font-size:.82rem;">${count}曲</div>
      `;
      item.addEventListener("click", () => {
        if(targetSongForPlaylist) {
          state.playlists[pName].push(targetSongForPlaylist);
          saveState();
          renderPlaylists();
          toast(`「${pName}」に追加しました`);
        }
        closePlSelectSheet();
      });
      el.plSelectList.appendChild(item);
    });
  }

  if (el.btnClosePlSheet) el.btnClosePlSheet.addEventListener("click", closePlSelectSheet);
  if (el.plSelectSheet) {
    el.plSelectSheet.addEventListener("click", e => {
      if(e.target === el.plSelectSheet) closePlSelectSheet();
    });
  }

  function renderSongList(){
    if (!el.list) return;
    const vis = getVisibleSongs();
    el.list.innerHTML = "";
    vis.forEach(song => {
      const row = document.createElement("div");
      row.className = "song" + (song.name === state.currentSong?.name ? " active" : "");
      row.dataset.name = song.name;
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${song.title}</div>
          <div class="songArtist">${song.artist}</div>
          <div class="songMeta">再生数 ${state.playCounts[song.name] || 0}回</div>
        </div>
        <div class="songRight">
          <button class="dlTrackBtn">⬇</button>
          <button class="addPlBtn">リスト追加</button>
          <button class="queueBtn">＋キュー</button>
          <button class="starBtn${state.favorites.includes(song.name) ? " active" : ""}">${state.favorites.includes(song.name) ? "★" : "☆"}</button>
          <button class="delTrackBtn">🗑</button>
        </div>
      `;
      row.querySelector(".dlTrackBtn").addEventListener("click", e => { e.stopPropagation(); downloadSingleSong(song); });
      row.querySelector(".addPlBtn").addEventListener("click", e => { e.stopPropagation(); addSongToPlaylist(song.name); });
      row.querySelector(".queueBtn").addEventListener("click", e => { e.stopPropagation(); addToQueue(song.name); });
      row.querySelector(".starBtn").addEventListener("click", e => { e.stopPropagation(); toggleFav(song.name); });
      row.querySelector(".delTrackBtn").addEventListener("click", e => { e.stopPropagation(); deleteSingleTrack(song); });
      row.addEventListener("click", () => playSong(song));
      el.list.appendChild(row);
    });
  }

  function addToQueue(name){
    state.queue.push(name);
    saveState();
    renderQueue();
    toast("キューに追加しました");
  }

  function toggleFav(name){
    const idx = state.favorites.indexOf(name);
    if(idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(name);
    saveState();
    renderSongList();
    if(state.currentSong?.name === name) updateNowPlayingUI(state.currentSong);
  }

  function renderQueue(){
    if (!el.queueList) return;
    el.queueList.innerHTML = "";
    if(!state.queue.length){
      el.queueList.innerHTML = `<div style="color:var(--muted); font-size:.86rem">キューは空です</div>`;
      return;
    }
    state.queue.forEach((name, idx) => {
      const displayName = name.replace(/\.(mp3|m4a|wav|ogg|flac|aac)$/i, "");
      const item = document.createElement("div");
      item.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:var(--panel2); padding:8px 12px; border-radius:10px;";
      item.innerHTML = `
        <span style="font-size:.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${displayName}</span>
        <div style="display:flex; gap:4px; margin-left:8px;">
          <button class="btn small moveUpBtn" style="padding:2px 6px;">▲</button>
          <button class="btn small moveDownBtn" style="padding:2px 6px;">▼</button>
          <button class="btn small delQueueBtn" style="padding:2px 6px;">✕</button>
        </div>
      `;
      
      item.querySelector(".moveUpBtn").addEventListener("click", () => {
        if(idx > 0) {
          [state.queue[idx - 1], state.queue[idx]] = [state.queue[idx], state.queue[idx - 1]];
          saveState();
          renderQueue();
        }
      });

      item.querySelector(".moveDownBtn").addEventListener("click", () => {
        if(idx < state.queue.length - 1) {
          [state.queue[idx + 1], state.queue[idx]] = [state.queue[idx], state.queue[idx + 1]];
          saveState();
          renderQueue();
        }
      });

      item.querySelector(".delQueueBtn").addEventListener("click", () => {
        state.queue.splice(idx, 1);
        saveState();
        renderQueue();
      });

      el.queueList.appendChild(item);
    });
  }

  if (el.btnQueueClear) {
    el.btnQueueClear.addEventListener("click", () => {
      state.queue = [];
      saveState();
      renderQueue();
      toast("再生キューを全消去しました");
    });
  }

  if (el.btnQueueShuffle) {
    el.btnQueueShuffle.addEventListener("click", () => {
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      saveState();
      renderQueue();
      toast("キューをシャッフルしました");
    });
  }

  if (el.pillFavs) {
    el.pillFavs.addEventListener("click", () => {
      state.favOnly = !state.favOnly;
      el.pillFavs.classList.toggle("active", state.favOnly);
      saveState();
      renderSongList();
    });
  }

  function renderSeekbarHeatmap() {
    if (!el.seekbarHeatmap) return;
    const canvas = el.seekbarHeatmap;
    const ctx = canvas.getContext("2d");
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(29, 185, 84, 0.25)";
    ctx.fillRect(0, canvas.height - 4, canvas.width, 4);
  }

  function renderStats() {
    if (el.statPlays) el.statPlays.textContent = Object.values(state.playCounts).reduce((a, b) => a + b, 0);
    if (el.statSongs) el.statSongs.textContent = state.playlist.length;
  }

  function renderAll() {
    renderSongList();
    renderQueue();
    renderPlaylists();
    renderEqualizer();
    renderColorPickers();
    renderStats();
    if (el.pillSongs) el.pillSongs.textContent = `${state.playlist.length}曲`;
    if (el.pillFavs) el.pillFavs.textContent = `${state.favorites.length}☆`;
    updateVolumeUI(currentVolumeTarget);
  }

  // 波形描画処理
  function drawWaveform() {
    requestAnimationFrame(drawWaveform);

    const canvas = el.wave;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!drawWaveform._waveHistory) {
      const rows = 13;
      const cols = 150;
      drawWaveform._waveRows = rows;
      drawWaveform._waveCols = cols;
      drawWaveform._waveHistory = Array.from({ length: rows }, () => new Float32Array(cols));
      drawWaveform._waveSmooth = new Float32Array(rows);
      drawWaveform._lastSampleTime = 0;
      drawWaveform._lastFrameTime = performance.now();
    }

    const rows = drawWaveform._waveRows;
    const cols = drawWaveform._waveCols;
    const history = drawWaveform._waveHistory;
    const bandSmooth = drawWaveform._waveSmooth;
    const now = performance.now();
    const dt = Math.min(100, now - drawWaveform._lastFrameTime);
    drawWaveform._lastFrameTime = now;

    const playing = !!(analyser && !audio.paused && !audio.ended);

    if (analyser && playing) {
      analyser.getByteFrequencyData(analyserData);
      updateSpatialAudio();

      if (state.silenceSkip) {
        let sum = 0;
        for (let i = 0; i < analyserData.length; i++) sum += analyserData[i];
        const avg = sum / analyserData.length;
        if (avg < 2 && audio.currentTime > 1 && audio.duration - audio.currentTime > 1.5) {
          audio.currentTime += 0.5;
        }
      }
    }

    if (state.waveMode === "3d") {
      const dataLen = analyserData ? analyserData.length : 64;

      function readBand(row) {
        if (!analyserData || !dataLen) return 0;

        const minBin = 1;
        const maxBin = Math.max(minBin + 1, Math.floor(dataLen * 0.92));
        const t0 = row / rows;
        const t1 = (row + 1) / rows;
        const a = Math.max(minBin, Math.floor(Math.pow(maxBin / minBin, t0) * minBin));
        const b = Math.max(a + 1, Math.floor(Math.pow(maxBin / minBin, t1) * minBin));

        let sum = 0;
        let count = 0;
        for (let i = a; i < Math.min(b, dataLen); i++) {
          sum += analyserData[i];
          count++;
        }
        return count ? sum / count / 255 : 0;
      }

      const sampleInterval = 55;
      if (playing && now - drawWaveform._lastSampleTime >= sampleInterval) {
        drawWaveform._lastSampleTime = now;

        for (let r = 0; r < rows; r++) {
          const raw = readBand(r);
          const response = raw > bandSmooth[r] ? 0.34 : 0.18;
          bandSmooth[r] += (raw - bandSmooth[r]) * response;

          history[r].copyWithin(0, 1);
          history[r][cols - 1] = bandSmooth[r];
        }
      }

      if (!playing) {
        const decay = Math.pow(0.008, dt / 1000);
        for (let r = 0; r < rows; r++) {
          const arr = history[r];
          for (let i = 0; i < cols; i++) arr[i] *= decay;
          bandSmooth[r] *= decay;
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const pitch = -46 * Math.PI / 180;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const fov = 760;
      const depth = 340;
      const centerY = h * 0.64;
      const xSpan = w * 0.92;

      function project(xNorm, z, height) {
        const x3d = (xNorm - 0.5) * xSpan;
        const y3d = height * h * 0.34;
        const yRot = y3d * cosP - z * sinP;
        const zRot = y3d * sinP + z * cosP;
        const scale = fov / (fov + zRot + 260);
        return {
          x: w / 2 + x3d * scale,
          y: centerY - yRot * scale,
          scale
        };
      }

      function hueForRow(row) {
        return 0 + (row / (rows - 1)) * 215;
      }

      for (let r = 0; r < rows; r++) {
        const z = (r / (rows - 1)) * depth;
        const p0 = project(0, z, 0);
        const p1 = project(1, z, 0);
        const hue = hueForRow(r);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = `hsla(${hue}, 75%, 55%, 0.10)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let r = 0; r < rows; r++) {
        const z = (r / (rows - 1)) * depth;
        const hue = hueForRow(r);
        const arr = history[r];

        ctx.beginPath();
        for (let i = 0; i < cols; i++) {
          const xNorm = i / (cols - 1);
          const p = project(xNorm, z, arr[i]);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }

        const peak = Math.max(...arr);
        ctx.strokeStyle = `hsla(${hue}, 95%, 60%, ${0.62 + Math.min(peak, 1) * 0.25})`;
        ctx.lineWidth = 1.25 + Math.min(peak, 1) * 1.35;
        ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
        ctx.shadowBlur = 5 + Math.min(peak, 1) * 10;
        ctx.stroke();
      }

      ctx.restore();
    } else {
      const len = analyserData ? analyserData.length : 64;
      if (!drawWaveform._smooth2d || drawWaveform._smooth2d.length !== len) {
        drawWaveform._smooth2d = new Float32Array(len);
      }
      const smooth2d = drawWaveform._smooth2d;

      for (let i = 0; i < len; i++) {
        const target = (playing && analyserData) ? analyserData[i] : 0;
        if (target > smooth2d[i]) {
          smooth2d[i] += (target - smooth2d[i]) * 0.35;
        } else {
          smooth2d[i] += (target - smooth2d[i]) * 0.12;
        }
      }

      const barWidth = w / len;
      ctx.fillStyle = "rgba(29, 185, 84, 0.75)";
      for (let i = 0; i < len; i++) {
        const barHeight = (smooth2d[i] / 255) * h;
        ctx.fillRect(i * barWidth, h - barHeight, barWidth - 1, barHeight);
      }
    }
  }

  // イベントリスナー設定
  if (el.folder) el.folder.addEventListener("change", e => loadFiles(e.target.files));
  if (el.folderPicker) el.folderPicker.addEventListener("change", e => loadFiles(e.target.files));

  if (el.shell) {
    el.shell.addEventListener("dragover", e => { e.preventDefault(); el.shell.classList.add("dragover"); });
    el.shell.addEventListener("dragleave", () => el.shell.classList.remove("dragover"));
    el.shell.addEventListener("drop", async e => {
      e.preventDefault();
      el.shell.classList.remove("dragover");
      if (e.dataTransfer.items) {
        const files = await scanFilesFromDataTransfer(e.dataTransfer.items);
        if (files.length) loadFiles(files);
      } else if (e.dataTransfer.files) {
        loadFiles(e.dataTransfer.files);
      }
    });
  }

  if (el.btnPlay) el.btnPlay.addEventListener("click", playPause);
  if (el.miniPlay) el.miniPlay.addEventListener("click", playPause);
  if (el.btnPrev) el.btnPrev.addEventListener("click", prevTrack);
  if (el.miniPrev) el.miniPrev.addEventListener("click", prevTrack);
  if (el.btnNext) el.btnNext.addEventListener("click", nextTrack);
  if (el.miniNext) el.miniNext.addEventListener("click", nextTrack);

  if (el.btnRewind10) el.btnRewind10.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); updateMediaSessionPosition(); });
  if (el.btnForward10) el.btnForward10.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); updateMediaSessionPosition(); });

  if (el.btnFav) {
    el.btnFav.addEventListener("click", () => {
      if (state.currentSong) toggleFav(state.currentSong.name);
    });
  }

  if (el.btnMainShuffle) {
    el.btnMainShuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      el.btnMainShuffle.classList.toggle("active", state.shuffle);
      saveState();
      toast(`シャッフル: ${state.shuffle ? "ON" : "OFF"}`);
    });
  }

  if (el.btnMainRepeat) {
    el.btnMainRepeat.addEventListener("click", () => {
      state.repeat = !state.repeat;
      el.btnMainRepeat.classList.toggle("active", state.repeat);
      saveState();
      toast(`リピート: ${state.repeat ? "ON" : "OFF"}`);
    });
  }

  if (el.progress) {
    el.progress.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (el.progress.value / 100) * audio.duration;
        updateMediaSessionPosition();
      }
    });
  }

  if (el.miniProgress) {
    el.miniProgress.addEventListener("input", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (el.miniProgress.value / 100) * audio.duration;
        updateMediaSessionPosition();
      }
    });
  }

  audio.addEventListener("timeupdate", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      const pct = (audio.currentTime / audio.duration) * 100;
      if (el.progress) el.progress.value = pct;
      if (el.miniProgress) el.miniProgress.value = pct;
      if (el.timeNow) el.timeNow.textContent = fmtTime(audio.currentTime);
      if (el.timeAll) el.timeAll.textContent = fmtTime(audio.duration);

      if (audio.currentTime / audio.duration >= 0.5) {
        recordPlayCount();
      }
    }
  });

  audio.addEventListener("ended", () => {
    if (state.repeat) {
      audio.currentTime = 0;
      audio.play().catch(()=>{});
    } else {
      nextTrack();
    }
  });

  if (el.playbackRate) {
    el.playbackRate.addEventListener("input", () => {
      currentRate = Number(el.playbackRate.value);
      if (el.customRateInput) el.customRateInput.value = currentRate.toFixed(2);
      applyPitchAndRate();
    });
  }

  if (el.customRateInput) {
    el.customRateInput.addEventListener("change", () => {
      currentRate = Math.min(10, Math.max(0.1, Number(el.customRateInput.value) || 1.0));
      if (el.playbackRate) el.playbackRate.value = currentRate;
      applyPitchAndRate();
    });
  }

  if (el.pitchShift) {
    el.pitchShift.addEventListener("input", () => {
      state.pitchSemitones = Number(el.pitchShift.value);
      saveState();
      applyPitchAndRate();
    });
  }

  if (el.search) {
    el.search.addEventListener("input", () => {
      state.search = el.search.value;
      renderSongList();
    });
  }

  // メニュー・ナビゲーション制御
  if (el.btnMenu) {
    el.btnMenu.addEventListener("click", () => {
      el.sidebar.classList.add("open");
      el.overlay.classList.add("open");
      document.body.classList.add("menu-open");
    });
  }

  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.overlay.classList.remove("open");
    document.body.classList.remove("menu-open");
  }

  if (el.btnCloseMenu) el.btnCloseMenu.addEventListener("click", closeSidebar);
  if (el.overlay) el.overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll(".menuItem").forEach(item => {
    item.addEventListener("click", () => {
      const sectionId = item.dataset.section;
      document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
      const sec = document.getElementById(sectionId);
      if (sec) sec.classList.add("active");
      el.mainMenuList.style.display = "none";
      el.btnSideBack.style.display = "inline-block";
    });
  });

  if (el.btnSideBack) {
    el.btnSideBack.addEventListener("click", () => {
      document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
      el.mainMenuList.style.display = "flex";
      el.btnSideBack.style.display = "none";
    });
  }

  document.querySelectorAll(".navTab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".navTab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.target;
      document.getElementById("homeElements").style.display = target === "home" ? "block" : "none";
      document.getElementById("playlistElements").style.display = target === "playlist" ? "flex" : "none";
      document.getElementById("settingsTabContainer").style.display = target === "settings" ? "block" : "none";
    });
  });

  // ショートカットキー対応
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    switch (e.key.toLowerCase()) {
      case " ":
        e.preventDefault(); playPause(); break;
      case "arrowleft":
        e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); updateMediaSessionPosition(); break;
      case "arrowright":
        e.preventDefault(); audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); updateMediaSessionPosition(); break;
      case "arrowup":
        e.preventDefault(); updateVolumeUI(Math.min(2.0, currentVolumeTarget + 0.05)); break;
      case "arrowdown":
        e.preventDefault(); updateVolumeUI(Math.max(0, currentVolumeTarget - 0.05)); break;
      case "m":
        e.preventDefault();
        if (currentVolumeTarget > 0) { lastUnmutedVolume = currentVolumeTarget; updateVolumeUI(0, true); }
        else updateVolumeUI(lastUnmutedVolume || 1.0, false);
        break;
      case "f":
        if (state.currentSong) toggleFav(state.currentSong.name);
        break;
      case "?":
        showShortcutModal(); break;
    }
  });

  // アプリの初期化
  initDB().then(() => {
    reloadPlaylistFromDB();
    applyTheme();
    setWaveMode(state.waveMode);
    setDMode(state.dMode);
    requestAnimationFrame(drawWaveform);
  });
})();
