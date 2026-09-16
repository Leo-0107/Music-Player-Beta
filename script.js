// script_2.js
import * as Audio from "./js/audio.js";
import * as Playlist from "./js/playlist.js";
import * as Visualizer from "./js/visualizer.js";
import * as Effects from "./js/effects.js";
import * as Metadata from "./js/metadata.js";
import * as Storage from "./js/storage.js";
import * as UI from "./js/ui.js";
import * as Settings from "./js/settings.js";

window.MusicPlayerModules = { Audio, Playlist, Visualizer, Effects, Metadata, Storage, UI, Settings };

(() => {
  const audio = new Audio.AudioEngine(new window.Audio());
  audio.audio.preload = "auto";

  let isWaveAnimating = false;
  let lastFrameTime = performance.now();
  let silenceTimer = 0;
  let eqAnimId = null;
  let wakeLock = null;

  let currentRate = 1.0;
  let targetSongForPlaylist = null;
  let bulkTargetPlaylist = null;
  let lastUnmutedVolume = 1.0;
  let currentVolumeTarget = Storage.loadNum(Storage.STORAGE_KEYS.volume, 1.0);

  const historyStack = [];
  let historyIndex = -1;

  let sleepTimerId = null;
  let sleepIntervalId = null;
  let sleepTimerEnd = null;
  let hasCountedCurrentSong = false;
  let isSlidingRange = false;

  const state = {
    playlist: [],
    currentSong: null,
    favorites: Storage.loadJSON(Storage.STORAGE_KEYS.favorites, []),
    queue: Storage.loadJSON(Storage.STORAGE_KEYS.queue, []),
    playCounts: Storage.loadJSON(Storage.STORAGE_KEYS.playCounts, {}),
    playHistory: Storage.loadJSON(Storage.STORAGE_KEYS.playHistory, {}),
    eqState: Storage.loadJSON(Storage.STORAGE_KEYS.eqState, { preset: "Normal", gains: [0,0,0,0,0] }),
    shuffle: Storage.loadBool(Storage.STORAGE_KEYS.shuffle, true),
    repeat: Storage.loadBool(Storage.STORAGE_KEYS.repeat, false),
    favOnly: Storage.loadBool(Storage.STORAGE_KEYS.favOnly, false),
    search: "",
    themeMode: Storage.loadStr(Storage.STORAGE_KEYS.themeMode, "system"),
    customTheme: Storage.loadJSON(Storage.STORAGE_KEYS.customTheme, { 
      c1: "#1d3557", l1: 100, 
      c2: "#121212", l2: 100, 
      text: "#ffffff", lText: 100, 
      dir: "180deg" 
    }),
    pitchSemitones: Storage.loadNum(Storage.STORAGE_KEYS.pitch, 0),
    playlists: Storage.loadJSON(Storage.STORAGE_KEYS.playlists, {}),
    crossfade: Storage.loadBool(Storage.STORAGE_KEYS.crossfade, true),
    silenceSkip: Storage.loadBool(Storage.STORAGE_KEYS.silenceSkip, true),
    dMode: Storage.loadStr(Storage.STORAGE_KEYS.dMode, "2D"),
    waveMode: Storage.loadStr(Storage.STORAGE_KEYS.waveMode, "3d"),
    panValue: 0,
    menuOpen: false
  };

  const el = {
    shell: UI.$("#shell"),
    folder: UI.$("#folder"),
    btnResetFiles: UI.$("#btnResetFiles"),
    search: UI.$("#search"),
    list: UI.$("#list"),
    nowTitle: UI.$("#nowTitle"),
    nowSub: UI.$("#nowSub"),
    miniTitle: UI.$("#miniTitle"),
    miniCoverCanvas: UI.$("#miniCoverCanvas"),
    pillSongs: UI.$("#pillSongs"),
    pillFavs: UI.$("#pillFavs"),
    btnShortcutHelp: UI.$("#btnShortcutHelp"),
    statPlays: UI.$("#statPlays"),
    statSongs: UI.$("#statSongs"),
    btnResetStats: UI.$("#btnResetStats"),
    playHistoryChart: UI.$("#playHistoryChart"),
    queueList: UI.$("#queueList"),
    eqPresetRow: UI.$("#eqPresetRow"),
    eqBands: UI.$("#eqBands"),
    btnMenu: UI.$("#btnMenu"),
    btnCloseMenu: UI.$("#btnCloseMenu"),
    btnSideBack: UI.$("#btnSideBack"),
    sideTitle: UI.$("#sideTitle"),
    overlay: UI.$("#overlay"),
    sidebar: UI.$("#sidebar"),
    sidebarInner: UI.$("#sidebarInner"),
    mainMenuList: UI.$("#mainMenuList"),
    btnPrev: UI.$("#btnPrev"),
    btnRewind10: UI.$("#btnRewind10"),
    btnPlay: UI.$("#btnPlay"),
    btnForward10: UI.$("#btnForward10"),
    btnNext: UI.$("#btnNext"),
    btnFav: UI.$("#btnFav"),
    btnMainShuffle: UI.$("#btnMainShuffle"),
    btnMainRepeat: UI.$("#btnMainRepeat"),
    miniPrev: UI.$("#miniPrev"),
    miniPlay: UI.$("#miniPlay"),
    miniNext: UI.$("#miniNext"),
    btnMuteToggle: UI.$("#btnMuteToggle"),
    volume: UI.$("#volume"),
    volText: UI.$("#volText"),
    playbackRate: UI.$("#playbackRate"),
    customRateInput: UI.$("#customRateInput"),
    rateText: UI.$("#rateText"),
    pitchShift: UI.$("#pitchShift"),
    pitchText: UI.$("#pitchText"),
    progress: UI.$("#progress"),
    miniProgress: UI.$("#miniProgress"),
    timeNow: UI.$("#timeNow"),
    timeAll: UI.$("#timeAll"),
    wave: UI.$("#wave"),
    waveModeBtns: UI.$("#waveModeBtns"),
    btnQueueClear: UI.$("#btnQueueClear"),
    btnQueueShuffle: UI.$("#btnQueueShuffle"),
    btnEqReset: UI.$("#btnEqReset"),
    toast: UI.$("#toast"),
    btnThemeSystem: UI.$("#btnThemeSystem"),
    btnThemeDark: UI.$("#btnThemeDark"),
    btnThemeLight: UI.$("#btnThemeLight"),
    btnThemeCustom: UI.$("#btnThemeCustom"),
    customThemeArea: UI.$("#customThemeArea"),
    gridColor1: UI.$("#gridColor1"),
    gridColor2: UI.$("#gridColor2"),
    gridTextColor: UI.$("#gridTextColor"),
    sliderL1: UI.$("#sliderL1"),
    sliderL2: UI.$("#sliderL2"),
    sliderLText: UI.$("#sliderLText"),
    txtL1: UI.$("#txtL1"),
    txtL2: UI.$("#txtL2"),
    txtLText: UI.$("#txtLText"),
    gradDirectionList: UI.$("#gradDirectionList"),
    nowCoverCanvas: UI.$("#nowCoverCanvas"),
    btnCrossfade: UI.$("#btnCrossfade"),
    btnSilenceSkip: UI.$("#btnSilenceSkip"),
    dModeBtns: UI.$("#dModeBtns"),
    dModeDesc: UI.$("#dModeDesc"),
    pannerSlider: UI.$("#pannerSlider"),
    pannerValText: UI.$("#pannerValText"),
    newPlName: UI.$("#newPlName"),
    btnCreatePl: UI.$("#btnCreatePl"),
    playlistContainer: UI.$("#playlistContainer"),
    plAlertModal: UI.$("#plAlertModal"),
    btnClosePlModal: UI.$("#btnClosePlModal"),
    shortcutModal: UI.$("#shortcutModal"),
    btnCloseShortcutModal: UI.$("#btnCloseShortcutModal"),
    timerStatus: UI.$("#timerStatus"),
    customTimerInput: UI.$("#customTimerInput"),
    btnSetCustomTimer: UI.$("#btnSetCustomTimer"),
    plSelectSheet: UI.$("#plSelectSheet"),
    plSelectList: UI.$("#plSelectList"),
    btnClosePlSheet: UI.$("#btnClosePlSheet"),
    btnBulkAddPl: UI.$("#btnBulkAddPl")
  };

  function toast(msg) { UI.showToast(el.toast, msg); }

  function saveState() {
    localStorage.setItem(Storage.STORAGE_KEYS.favorites, JSON.stringify(state.favorites));
    localStorage.setItem(Storage.STORAGE_KEYS.queue, JSON.stringify(state.queue));
    localStorage.setItem(Storage.STORAGE_KEYS.playCounts, JSON.stringify(state.playCounts));
    localStorage.setItem(Storage.STORAGE_KEYS.playHistory, JSON.stringify(state.playHistory));
    localStorage.setItem(Storage.STORAGE_KEYS.eqState, JSON.stringify(state.eqState));
    localStorage.setItem(Storage.STORAGE_KEYS.volume, String(currentVolumeTarget));
    localStorage.setItem(Storage.STORAGE_KEYS.pitch, String(state.pitchSemitones));
    localStorage.setItem(Storage.STORAGE_KEYS.shuffle, String(state.shuffle));
    localStorage.setItem(Storage.STORAGE_KEYS.repeat, String(state.repeat));
    localStorage.setItem(Storage.STORAGE_KEYS.favOnly, String(state.favOnly));
    localStorage.setItem(Storage.STORAGE_KEYS.themeMode, state.themeMode);
    localStorage.setItem(Storage.STORAGE_KEYS.customTheme, JSON.stringify(state.customTheme));
    localStorage.setItem(Storage.STORAGE_KEYS.playlists, JSON.stringify(state.playlists));
    localStorage.setItem(Storage.STORAGE_KEYS.crossfade, String(state.crossfade));
    localStorage.setItem(Storage.STORAGE_KEYS.silenceSkip, String(state.silenceSkip));
    localStorage.setItem(Storage.STORAGE_KEYS.dMode, state.dMode);
    localStorage.setItem(Storage.STORAGE_KEYS.waveMode, state.waveMode);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {}
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().then(() => { wakeLock = null; }).catch(() => {});
    }
  }

  function updateMediaSessionPosition() {
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
      if (Number.isFinite(audio.audio.duration) && audio.audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.audio.duration,
            playbackRate: audio.audio.playbackRate || 1.0,
            position: Math.min(audio.audio.currentTime || 0, audio.audio.duration)
          });
        } catch {}
      }
    }
  }

  function setupMediaSessionRemoteControls() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => { if (audio.audio.paused) playPause(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (!audio.audio.paused) playPause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
      navigator.mediaSession.setActionHandler('stop', () => {
        audio.audio.pause();
        audio.audio.currentTime = 0;
        updatePlayPauseUI();
      });
      navigator.mediaSession.setActionHandler('seekbackward', details => {
        const skip = details.seekOffset || 10;
        audio.audio.currentTime = Math.max(0, audio.audio.currentTime - skip);
        updateMediaSessionPosition();
      });
      navigator.mediaSession.setActionHandler('seekforward', details => {
        const skip = details.seekOffset || 10;
        audio.audio.currentTime = Math.min(audio.audio.duration || 0, audio.audio.currentTime + 10);
        updateMediaSessionPosition();
      });
      navigator.mediaSession.setActionHandler('seekto', details => {
        if (details.fastSeek && ('fastSeek' in audio.audio)) {
          audio.audio.fastSeek(details.seekTime);
        } else {
          audio.audio.currentTime = details.seekTime;
        }
        updateMediaSessionPosition();
      });
    } catch {}
  }

  function applyPitchAndRate() {
    const pitchFactor = Math.pow(2, state.pitchSemitones / 12);
    audio.audio.playbackRate = currentRate * pitchFactor;
    audio.audio.preservesPitch = false;
    if (el.rateText) el.rateText.textContent = `${currentRate.toFixed(2)}x`;
    if (el.pitchText) el.pitchText.textContent = state.pitchSemitones > 0 ? `+${state.pitchSemitones}` : `${state.pitchSemitones}`;
    updateMediaSessionPosition();
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
    if (mode === "2D") audio.setPanner3DPosition(0, 0, 0);
  }

  if (el.dModeBtns) {
    el.dModeBtns.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => setDMode(btn.dataset.d));
    });
  }

  function applyTheme() {
    document.body.classList.remove("theme-light");
    [el.btnThemeSystem, el.btnThemeDark, el.btnThemeLight, el.btnThemeCustom].forEach(b => b?.classList.remove("active"));
    if (el.customThemeArea) el.customThemeArea.style.display = "none";

    document.body.style.removeProperty("--text");
    document.body.style.removeProperty("--muted");

    let activeMode = state.themeMode;
    if (activeMode === "system") {
      if (el.btnThemeSystem) el.btnThemeSystem.classList.add("active");
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeMode = isSystemDark ? "dark" : "light";
    }

    if (activeMode === "light") {
      document.body.classList.add("theme-light");
      document.body.style.background = "";
      document.body.style.color = "";
      if (state.themeMode === "light" && el.btnThemeLight) el.btnThemeLight.classList.add("active");
    } else if (activeMode === "custom") {
      if (el.btnThemeCustom) el.btnThemeCustom.classList.add("active");
      if (el.customThemeArea) el.customThemeArea.style.display = "block";

      const { c1, l1, c2, l2, text, lText, dir } = state.customTheme;
      const computedC1 = Settings.adjustColorLightness(c1 || "#1d3557", l1 !== undefined ? l1 : 100);
      const computedC2 = Settings.adjustColorLightness(c2 || "#121212", l2 !== undefined ? l2 : 100);
      
      const baseLText = lText !== undefined ? lText : 100;
      const computedText = Settings.adjustColorLightness(text || "#ffffff", baseLText);
      const computedMuted = Settings.adjustColorLightness(text || "#ffffff", Math.round(baseLText * 0.65));

      document.body.style.background = `linear-gradient(${dir || "180deg"}, ${computedC1} 0%, ${computedC2} 100%)`;
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.color = computedText;
      
      document.body.style.setProperty("--text", computedText);
      document.body.style.setProperty("--muted", computedMuted);
    } else {
      document.body.style.background = "";
      document.body.style.color = "";
      if (state.themeMode === "dark" && el.btnThemeDark) el.btnThemeDark.classList.add("active");
    }
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.themeMode === "system") applyTheme();
  });

  function renderColorPickers() {
    const targets = [
      { grid: el.gridColor1, key: "c1" },
      { grid: el.gridColor2, key: "c2" },
      { grid: el.gridTextColor, key: "text" }
    ];

    targets.forEach(({ grid, key }) => {
      if (!grid) return;
      grid.innerHTML = "";
      const current = state.customTheme[key];
      Settings.COLOR_PALETTE_12.forEach(color => {
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

    if (el.sliderL1) el.sliderL1.value = state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100;
    if (el.sliderL2) el.sliderL2.value = state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100;
    if (el.sliderLText) el.sliderLText.value = state.customTheme.lText !== undefined ? state.customTheme.lText : 100;
    if (el.txtL1) el.txtL1.textContent = `${el.sliderL1.value}%`;
    if (el.txtL2) el.txtL2.textContent = `${el.sliderL2.value}%`;
    if (el.txtLText) el.txtLText.textContent = `${el.sliderLText.value}%`;

    const previewC1 = Settings.adjustColorLightness(state.customTheme.c1 || "#1d3557", state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100);
    const previewC2 = Settings.adjustColorLightness(state.customTheme.c2 || "#121212", state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100);
    document.querySelectorAll(".gradOption").forEach(opt => {
      opt.classList.toggle("selected", opt.dataset.deg === (state.customTheme.dir || "180deg"));
      const preview = opt.querySelector(".gradPreview");
      if (preview) preview.style.background = `linear-gradient(${opt.dataset.deg}, ${previewC1} 0%, ${previewC2} 100%)`;
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
    if (!slider) return;
    slider.addEventListener("input", () => {
      const val = Number(slider.value);
      state.customTheme[key] = val;
      if (txt) txt.textContent = `${val}%`;
      saveState();
      applyTheme();
    });
  });

  function renderEqualizer() {
    if (!el.eqPresetRow || !el.eqBands) return;
    el.eqPresetRow.innerHTML = "";
    Object.keys(Settings.EQ_PRESETS).forEach(pName => {
      const b = document.createElement("button");
      b.className = "btn small" + (state.eqState.preset === pName ? " active" : "");
      b.textContent = pName;
      b.addEventListener("click", () => {
        state.eqState.preset = pName;
        triggerEqAnimation(Settings.EQ_PRESETS[pName]);
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
        if (eqAnimId) cancelAnimationFrame(eqAnimId);
        const v = Number(slider.value);
        state.eqState.preset = "Custom";
        state.eqState.gains[idx] = v;
        updatePresetButtonsUI();
        audio.applyEqGains(state.eqState.gains, 0.05);
        updateEqUIValues();
        saveState();
      });
      el.eqBands.appendChild(vBand);
    });
  }

  function triggerEqAnimation(targetGains) {
    if (eqAnimId) cancelAnimationFrame(eqAnimId);
    eqAnimId = Effects.animateEqPreset(
      targetGains,
      state.eqState.gains,
      gains => {
        state.eqState.gains = gains;
        audio.applyEqGains(gains, 0.05);
        updateEqUIValues();
      },
      () => {
        saveState();
      }
    );
  }

  function updatePresetButtonsUI() {
    if (!el.eqPresetRow) return;
    el.eqPresetRow.querySelectorAll("button").forEach(b => {
      b.classList.toggle("active", b.textContent === state.eqState.preset);
    });
  }

  function updateEqUIValues() {
    state.eqState.gains.forEach((g, idx) => {
      const slider = document.getElementById(`eqSlider_${idx}`);
      const valDisp = document.getElementById(`eqVal_${idx}`);
      if (slider) slider.value = g;
      if (valDisp) valDisp.textContent = (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1)) + "dB";
    });
  }

  if (el.btnEqReset) {
    el.btnEqReset.addEventListener("click", () => {
      state.eqState.preset = "Normal";
      triggerEqAnimation([0,0,0,0,0]);
      updatePresetButtonsUI();
    });
  }

  if (el.btnResetFiles) {
    el.btnResetFiles.addEventListener("click", () => {
      if (!confirm("保存された全トラックを削除しますか？")) return;
      Storage.clearDBTracks();
      Storage.revokeAllObjectURLs();
      state.playlist = [];
      state.currentSong = null;
      state.queue = [];
      state.playlists = {};
      audio.audio.pause();
      audio.audio.src = "";
      if (el.folder) el.folder.value = "";
      Visualizer.updateArtwork(null, el.nowCoverCanvas, el.miniCoverCanvas);
      UI.updateTitleTextAndScroll(el.nowTitle, "未再生");
      UI.updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
      UI.updateTitleTextAndScroll(el.miniTitle, "停止中");
      saveState();
      renderAll();
      toast("全ファイルをリセットしました");
    });
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    toast(`ファイルの解析・読み込み中...`);
    const directAudioFiles = files.filter(f => f.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f.name));
    const zipFiles = files.filter(f => /\.zip$/i.test(f.name));

    for (const zipFile of zipFiles) {
      if (typeof JSZip === "undefined") {
        toast("Zipライブラリが見つかりません");
        continue;
      }
      try {
        const plName = zipFile.name.replace(/\.zip$/i, "");
        if (!state.playlists[plName]) state.playlists[plName] = [];
        const zip = await JSZip.loadAsync(zipFile);
        const fileKeys = Object.keys(zip.files);

        for (const filename of fileKeys) {
          const entry = zip.files[filename];
          if (!entry.dir && /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(filename)) {
            const blob = await entry.async("blob");
            const cleanName = filename.split('/').pop();
            const audioFile = new File([blob], cleanName, { type: blob.type || "audio/mpeg" });
            const meta = await Metadata.parseID3(audioFile);

            Storage.saveTrackToDB({
              name: audioFile.name,
              title: meta.title,
              artist: meta.artist,
              blob: audioFile,
              coverBlob: meta.coverBlob
            }, toast);

            if (!state.playlists[plName].includes(audioFile.name)) {
              state.playlists[plName].push(audioFile.name);
            }
          }
        }
      } catch {
        toast("Zipファイルの解析エラーが発生しました");
      }
    }

    for (const f of directAudioFiles) {
      const meta = await Metadata.parseID3(f);
      const storageName = f.webkitRelativePath || f.name;
      Storage.saveTrackToDB({
        name: storageName,
        title: meta.title,
        artist: meta.artist,
        blob: f,
        coverBlob: meta.coverBlob
      }, toast);
    }

    saveState();
    await reloadPlaylistFromDB();
    toast(`読み込み完了！`);
  }

  if (el.folder) {
    el.folder.addEventListener("change", e => {
      loadFiles(e.target.files);
      el.folder.value = "";
    });
  }

  async function reloadPlaylistFromDB() {
    Storage.cleanUpObjectURLs(state.currentSong?.name);
    const tracks = await Storage.loadTracksFromDB();
    state.playlist = tracks.map(t => {
      const urls = Storage.getOrCreateObjectURLs(t);
      return {
        name: t.name,
        title: t.title || t.name,
        artist: t.artist || "不明なアーティスト",
        url: urls.url,
        coverUrl: urls.coverUrl
      };
    }).sort((a,b) => a.title.localeCompare(b.title, "ja", { numeric: true }));
    renderAll();
  }

  async function deleteSingleTrack(song) {
    if (!song) return;
    if (!confirm(`「${song.title}」を削除しますか？`)) return;

    await Storage.deleteTrackFromDB(song.name, toast);

    if (state.currentSong?.name === song.name) {
      audio.audio.pause();
      audio.audio.src = "";
      state.currentSong = null;
      Visualizer.updateArtwork(null, el.nowCoverCanvas, el.miniCoverCanvas);
      UI.updateTitleTextAndScroll(el.nowTitle, "未再生");
      UI.updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
      UI.updateTitleTextAndScroll(el.miniTitle, "停止中");
    }

    state.queue = state.queue.filter(q => q !== song.name);
    state.favorites = state.favorites.filter(f => f !== song.name);

    await reloadPlaylistFromDB();
    toast("曲を削除しました");
  }

  function getVisibleSongsList() {
    return Playlist.getVisibleSongs(state.playlist, state.search, state.favOnly, state.favorites);
  }

  function playSong(song, pushHistory = true) {
    if (!song) return;
    audio.ensureGraph(state.eqState.gains, currentVolumeTarget, state.panValue);

    if (state.crossfade && audio.audio.src && !audio.audio.paused && audio.masterGain) {
      audio.masterGain.gain.setTargetAtTime(0.001, audio.audioCtx.currentTime, 0.15);
      setTimeout(() => startNewSong(song, pushHistory), 200);
    } else {
      startNewSong(song, pushHistory);
    }
  }

  function startNewSong(song, pushHistory) {
    state.currentSong = song;
    hasCountedCurrentSong = false;
    silenceTimer = 0;
    audio.audio.src = song.url;
    applyPitchAndRate();

    if (audio.masterGain && audio.audioCtx) {
      audio.masterGain.gain.setTargetAtTime(currentVolumeTarget, audio.audioCtx.currentTime, 0.2);
    }

    if (pushHistory) {
      if (historyIndex === -1 || historyStack[historyIndex]?.name !== song.name) {
        historyStack.splice(historyIndex + 1);
        historyStack.push(song);
        historyIndex = historyStack.length - 1;
      }
    }

    Visualizer.updateArtwork(song, el.nowCoverCanvas, el.miniCoverCanvas);
    updateNowPlayingUI(song);
    audio.resume();
    audio.audio.play().then(() => {
      requestWakeLock();
      lastFrameTime = performance.now();
      startWaveAnimation();
    }).catch(() => {});
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
    updateSongItemPlayCountUI(songName, state.playCounts[songName]);
  }

  function updateSongItemPlayCountUI(songName, count) {
    if (!el.list) return;
    const songRows = el.list.querySelectorAll(".song");
    for (let i = 0; i < songRows.length; i++) {
      if (songRows[i].dataset.name === songName) {
        const metaEl = songRows[i].querySelector(".songMeta");
        if (metaEl) metaEl.textContent = `再生数 ${count}回`;
        break;
      }
    }
  }

  function updatePlayPauseUI() {
    const isPlaying = !audio.audio.paused && audio.audio.src;
    if (el.btnPlay) {
      el.btnPlay.textContent = isPlaying ? "❚❚ 一時停止" : "▶ 再生";
      el.btnPlay.classList.toggle("playing", isPlaying);
    }
    if (el.miniPlay) {
      el.miniPlay.textContent = isPlaying ? "❚❚" : "▶";
      el.miniPlay.classList.toggle("playing", isPlaying);
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }

    if (isPlaying) requestWakeLock();
    else releaseWakeLock();
  }

  function updateNowPlayingUI(song) {
    if (song) {
      UI.updateTitleTextAndScroll(el.nowTitle, song.title);
      UI.updateTitleTextAndScroll(el.miniTitle, song.title);
      UI.updateTitleTextAndScroll(el.nowSub, song.artist);
      if (el.btnFav) {
        el.btnFav.textContent = state.favorites.includes(song.name) ? "★" : "☆";
        el.btnFav.classList.toggle("active", state.favorites.includes(song.name));
      }

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
  }

  function playPause() {
    if (!state.currentSong && state.playlist.length) return playSong(getVisibleSongsList()[0]);
    if (audio.audio.paused) {
      audio.audio.play().then(() => {
        requestWakeLock();
        lastFrameTime = performance.now();
        startWaveAnimation();
      }).catch(() => {});
    } else {
      audio.audio.pause();
      releaseWakeLock();
    }
    updatePlayPauseUI();
  }

  function prevTrack() {
    if (historyIndex > 0) {
      historyIndex--;
      playSong(historyStack[historyIndex], false);
    } else {
      const vis = getVisibleSongsList();
      if (!vis.length) return;
      const idx = vis.findIndex(s => s.name === state.currentSong?.name);
      playSong(vis[(idx - 1 + vis.length) % vis.length]);
    }
  }

  function nextTrack(isAuto = false) {
    if (!isAuto && historyIndex < historyStack.length - 1) {
      historyIndex++;
      playSong(historyStack[historyIndex], false);
      return;
    }

    if (isAuto && historyIndex < historyStack.length - 1) {
      historyStack.splice(historyIndex + 1);
    }

    const vis = getVisibleSongsList();
    if (!vis.length) return;
    if (state.queue.length) {
      const name = state.queue.shift();
      saveState();
      renderQueue();
      const s = state.playlist.find(x => x.name === name);
      if (s) return playSong(s);
    }
    if (state.shuffle) {
      const next = vis[Math.floor(Math.random() * vis.length)];
      return playSong(next);
    }
    const idx = vis.findIndex(s => s.name === state.currentSong?.name);
    playSong(vis[(idx + 1) % vis.length]);
  }

  function updateVolumeUI(targetVal, isMuteAction = false) {
    const prevVol = currentVolumeTarget;
    currentVolumeTarget = Math.max(0, targetVal);
    if (el.volume) el.volume.value = currentVolumeTarget;
    if (el.volText) el.volText.textContent = `${Math.round(currentVolumeTarget * 100)}%`;
    if (el.btnMuteToggle) el.btnMuteToggle.textContent = currentVolumeTarget === 0 ? "🔇" : currentVolumeTarget < 0.5 ? "🔉" : "🔊";

    audio.audio.volume = Math.min(1.0, Math.max(0.0, currentVolumeTarget));

    if (audio.masterGain && audio.audioCtx) {
      const now = audio.audioCtx.currentTime;
      audio.masterGain.gain.cancelScheduledValues(now);
      if (currentVolumeTarget > prevVol) {
        audio.masterGain.gain.setTargetAtTime(currentVolumeTarget, now, 0.35);
      } else {
        audio.masterGain.gain.setTargetAtTime(currentVolumeTarget, now, isMuteAction ? 0.02 : 0.05);
      }
    }
    saveState();
  }

  if (el.volume) el.volume.addEventListener("input", () => updateVolumeUI(Number(el.volume.value)));
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

  function renderPlaylists() {
    const containers = [el.playlistContainer, document.getElementById("playlistContainerMain")].filter(Boolean);
    if (!containers.length) return;

    containers.forEach(container => {
      container.innerHTML = "";
      const names = Object.keys(state.playlists);
      if (!names.length) {
        container.innerHTML = `<div style="color:var(--muted); font-size:.86rem">プレイリストがありません</div>`;
        return;
      }

      names.forEach(pName => {
        const card = document.createElement("div");
        card.className = "sectionCard plCard";
        const tracksInPl = Array.isArray(state.playlists[pName]) ? state.playlists[pName] : [];
        state.playlists[pName] = tracksInPl;

        const row1 = document.createElement("div");
        row1.className = "plRow1";
        row1.innerHTML = `
          <button class="btn small ghost plToggleBtn" type="button" aria-expanded="false">▶ 曲一覧 (${tracksInPl.length})</button>
          <div class="plTitleContainer">
            <div class="plTitleText">${UI.escapeHTML(pName)}</div>
          </div>
          <button class="btn small ghost delPlBtn" type="button">✕</button>
        `;

        const row2 = document.createElement("div");
        row2.className = "plRow2";
        row2.innerHTML = `
          <button class="btn small bulkAddPlBtn" type="button">＋一覧から追加</button>
          <button class="btn small renamePlBtn" type="button">名前変更</button>
          <button class="btn small playPlBtn" type="button">▶ 全曲再生</button>
        `;

        card.appendChild(row1);
        card.appendChild(row2);

        const listDiv = document.createElement("div");
        listDiv.className = "plTrackList collapsed";

        if (!tracksInPl.length) {
          listDiv.innerHTML = `<div style="color:var(--muted); font-size:.78rem">曲がありません</div>`;
        } else {
          tracksInPl.forEach((songName, idx) => {
            const found = state.playlist.find(x => x.name === songName);
            const row = document.createElement("div");
            row.className = "plTrackItem";
            const displayTitle = found ? found.title : songName.replace(/\.[^/.]+$/, '');
            row.innerHTML = `
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">
                ${!found ? '<span style="color:#f8d25c; margin-right:4px;">▲</span>' : ''}
                <strong>${UI.escapeHTML(displayTitle)}</strong>
              </span>
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="btn small playPlTrackBtn" type="button">▶</button>
                <button class="btn small ghost removePlSongBtn" type="button">✕</button>
              </div>
            `;

            row.querySelector(".playPlTrackBtn").addEventListener("click", e => {
              e.stopPropagation();
              if (found) playSong(found);
            });
            row.addEventListener("click", () => { if (found) playSong(found); });
            row.querySelector(".removePlSongBtn").addEventListener("click", e => {
              e.stopPropagation();
              state.playlists[pName].splice(idx, 1);
              saveState();
              renderPlaylists();
            });
            listDiv.appendChild(row);
          });
        }

        card.appendChild(listDiv);

        row1.querySelector(".plToggleBtn").addEventListener("click", e => {
          e.stopPropagation();
          const willOpen = listDiv.classList.contains("collapsed");
          listDiv.classList.toggle("collapsed", !willOpen);
          e.target.textContent = willOpen ? `▼ 曲一覧 (${tracksInPl.length})` : `▶ 曲一覧 (${tracksInPl.length})`;
        });

        row2.querySelector(".bulkAddPlBtn").addEventListener("click", e => {
          e.stopPropagation();
          openBulkAddForPlaylist(pName);
        });

        row2.querySelector(".playPlBtn").addEventListener("click", e => {
          e.stopPropagation();
          const songObjects = state.playlists[pName].map(n => state.playlist.find(x => x.name === n)).filter(Boolean);
          if (songObjects.length) playSong(songObjects[0]);
          else toast("このプレイリストに再生できる曲がありません");
        });

        row2.querySelector(".renamePlBtn").addEventListener("click", e => {
          e.stopPropagation();
          const newName = prompt("新しいプレイリスト名を入力してください:", pName);
          const trimmed = newName?.trim();
          if (trimmed && trimmed !== pName) {
            if (state.playlists[trimmed]) return toast("その名前のプレイリストは既にあります");
            state.playlists[trimmed] = state.playlists[pName];
            delete state.playlists[pName];
            saveState();
            renderPlaylists();
          }
        });

        row1.querySelector(".delPlBtn").addEventListener("click", e => {
          e.stopPropagation();
          if (!confirm(`プレイリスト「${pName}」を削除しますか？`)) return;
          delete state.playlists[pName];
          saveState();
          renderPlaylists();
        });

        container.appendChild(card);
      });
    });
  }

  function addSongToPlaylist(songName) {
    if (!Object.keys(state.playlists).length) return toast("先にプレイリストを作成してください");
    targetSongForPlaylist = songName;
    renderPlSelectSheet();
    if (el.plSelectSheet) el.plSelectSheet.classList.add("show");
  }

  function renderPlSelectSheet() {
    if (!el.plSelectList) return;
    el.plSelectList.innerHTML = "";
    bulkTargetPlaylist = null;
    if (el.btnBulkAddPl) el.btnBulkAddPl.style.display = "none";
    const title = document.getElementById("plSelectSheetTitle");
    if (title) title.textContent = "プレイリストを選択";

    Object.keys(state.playlists).forEach(pName => {
      const item = document.createElement("div");
      item.className = "plSelectItem";
      item.innerHTML = `<div style="font-weight:600;">${UI.escapeHTML(pName)}</div><div style="color:var(--muted); font-size:.82rem;">${state.playlists[pName].length}曲</div>`;
      item.addEventListener("click", () => {
        if (targetSongForPlaylist) {
          if (!state.playlists[pName].includes(targetSongForPlaylist)) {
            state.playlists[pName].push(targetSongForPlaylist);
            saveState();
            renderPlaylists();
            toast(`「${pName}」に追加しました`);
          } else {
            toast(`「${pName}」には既に入っています`);
          }
        }
        closePlSelectSheet();
      });
      el.plSelectList.appendChild(item);
    });
  }

  function openBulkAddForPlaylist(pName) {
    if (!state.playlists[pName]) return;
    bulkTargetPlaylist = pName;
    targetSongForPlaylist = null;
    if (!el.plSelectList) return;
    el.plSelectList.innerHTML = "";

    const title = document.getElementById("plSelectSheetTitle");
    if (title) title.textContent = `「${pName}」へ追加する曲を選択`;
    if (el.btnBulkAddPl) el.btnBulkAddPl.style.display = "block";

    const current = new Set(state.playlists[pName]);
    const songs = getVisibleSongsList();
    songs.forEach(song => {
      const item = document.createElement("label");
      item.className = "bulkPlItem";
      item.innerHTML = `
        <input type="checkbox" class="bulkSongCheck" value="${UI.escapeHTML(song.name)}"${current.has(song.name) ? " checked" : ""}>
        <span class="bulkSongName">${UI.escapeHTML(song.title)}</span>
      `;
      el.plSelectList.appendChild(item);
    });

    if (el.plSelectSheet) el.plSelectSheet.classList.add("show");
  }

  function closePlSelectSheet() {
    if (el.plSelectSheet) el.plSelectSheet.classList.remove("show");
    targetSongForPlaylist = null;
    bulkTargetPlaylist = null;
    if (el.btnBulkAddPl) el.btnBulkAddPl.style.display = "none";
  }

  if (el.btnBulkAddPl) {
    el.btnBulkAddPl.addEventListener("click", () => {
      if (!bulkTargetPlaylist) return;
      const checks = el.plSelectList?.querySelectorAll(".bulkSongCheck") || [];
      const selected = Array.from(checks).filter(cb => cb.checked).map(cb => cb.value);
      const existing = new Set(state.playlists[bulkTargetPlaylist] || []);
      selected.forEach(name => existing.add(name));
      state.playlists[bulkTargetPlaylist] = Array.from(existing);
      saveState();
      renderPlaylists();
      toast(`${selected.length}曲を「${bulkTargetPlaylist}」に追加しました`);
      closePlSelectSheet();
    });
  }

  if (el.btnClosePlSheet) el.btnClosePlSheet.addEventListener("click", closePlSelectSheet);

  function renderSongList() {
    const vis = getVisibleSongsList();
    if (!el.list) return;
    el.list.innerHTML = "";
    vis.forEach(song => {
      const row = document.createElement("div");
      row.className = "song" + (song.name === state.currentSong?.name ? " active" : "");
      row.dataset.name = song.name;
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${UI.escapeHTML(song.title)}</div>
          <div class="songArtist">${UI.escapeHTML(song.artist)}</div>
          <div class="songMeta">再生数 ${state.playCounts[song.name] || 0}回</div>
        </div>
        <div class="songRight">
          <button class="addPlBtn">リスト追加</button>
          <button class="queueBtn">＋キュー</button>
          <button class="starBtn${state.favorites.includes(song.name) ? " active" : ""}">${state.favorites.includes(song.name) ? "★" : "☆"}</button>
          <button class="delTrackBtn">🗑</button>
        </div>
      `;
      row.querySelector(".addPlBtn").addEventListener("click", e => { e.stopPropagation(); addSongToPlaylist(song.name); });
      row.querySelector(".queueBtn").addEventListener("click", e => { e.stopPropagation(); addToQueue(song.name); });
      row.querySelector(".starBtn").addEventListener("click", e => { e.stopPropagation(); toggleFav(song.name); });
      row.querySelector(".delTrackBtn").addEventListener("click", e => { e.stopPropagation(); deleteSingleTrack(song); });
      row.addEventListener("click", () => playSong(song));
      el.list.appendChild(row);
    });
  }

  function addToQueue(name) {
    state.queue.push(name);
    saveState();
    renderQueue();
    toast("キューに追加しました");
  }

  function toggleFav(name) {
    const idx = state.favorites.indexOf(name);
    if (idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(name);
    saveState();
    renderSongList();
    if (state.currentSong?.name === name && el.btnFav) {
      el.btnFav.textContent = state.favorites.includes(name) ? "★" : "☆";
      el.btnFav.classList.toggle("active", state.favorites.includes(name));
    }
  }

  function renderQueue() {
    if (!el.queueList) return;
    el.queueList.innerHTML = "";
    if (!state.queue.length) {
      el.queueList.innerHTML = `<div style="color:var(--muted); font-size:.86rem">キューは空です</div>`;
      return;
    }
    state.queue.forEach((name, idx) => {
      const s = state.playlist.find(x => x.name === name);
      const row = document.createElement("div");
      row.className = "song";
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${UI.escapeHTML(s ? s.title : name)}</div>
          <div class="songArtist">${UI.escapeHTML(s ? s.artist : "不明")}</div>
        </div>
        <div class="songRight">
          <button class="btn small danger delQueueBtn">削除</button>
        </div>
      `;
      row.querySelector(".delQueueBtn").addEventListener("click", e => {
        e.stopPropagation();
        state.queue.splice(idx, 1);
        saveState();
        renderQueue();
      });
      row.addEventListener("click", () => {
        state.queue.splice(idx, 1);
        saveState();
        renderQueue();
        if (s) playSong(s);
      });
      el.queueList.appendChild(row);
    });
  }

  if (el.btnQueueClear) {
    el.btnQueueClear.addEventListener("click", () => {
      state.queue = [];
      saveState();
      renderQueue();
      toast("キューを全消去しました");
    });
  }

  if (el.btnQueueShuffle) {
    el.btnQueueShuffle.addEventListener("click", () => {
      state.queue = Playlist.shuffleArray(state.queue);
      saveState();
      renderQueue();
      toast("キューをシャッフルしました");
    });
  }

  function renderStats() {
    let totalPlays = 0;
    Object.values(state.playCounts).forEach(c => totalPlays += c);
    if (el.statPlays) el.statPlays.textContent = totalPlays;
    if (el.statSongs) el.statSongs.textContent = state.playlist.length;
    if (el.pillSongs) el.pillSongs.textContent = `${state.playlist.length}曲`;
    if (el.pillFavs) el.pillFavs.textContent = `${state.favorites.length}☆`;
    Visualizer.renderStatsChart(el.playHistoryChart, state.playCounts, state.playHistory, state.playlist.length);
  }

  if (el.btnResetStats) {
    el.btnResetStats.addEventListener("click", () => {
      if (!confirm("再生統計データをリセットしますか？")) return;
      state.playCounts = {};
      state.playHistory = {};
      saveState();
      renderStats();
      renderSongList();
      toast("再生統計をリセットしました");
    });
  }

  function renderAll() {
    renderSongList();
    renderQueue();
    renderPlaylists();
    renderStats();
  }

  audio.audio.addEventListener("play", () => {
    updatePlayPauseUI();
    lastFrameTime = performance.now();
    startWaveAnimation();
  });
  audio.audio.addEventListener("pause", () => updatePlayPauseUI());
  audio.audio.addEventListener("playing", () => updatePlayPauseUI());
  audio.audio.addEventListener("waiting", () => updatePlayPauseUI());

  audio.audio.addEventListener("timeupdate", () => {
    if (!audio.audio.duration) return;
    const cur = audio.audio.currentTime, dur = audio.audio.duration;
    if (!isSlidingRange) {
      if (el.progress) el.progress.value = (cur / dur) * 100;
      if (el.miniProgress) el.miniProgress.value = (cur / dur) * 100;
    }
    if (el.timeNow) el.timeNow.textContent = UI.fmtTime(cur);
    if (el.timeAll) el.timeAll.textContent = UI.fmtTime(dur);

    if (cur > 30 || (dur > 0 && cur / dur > 0.5)) recordPlayCount();
    updateMediaSessionPosition();
  });

  audio.audio.addEventListener("ended", () => {
    releaseWakeLock();
    if (state.repeat) {
      audio.audio.currentTime = 0;
      audio.audio.play().then(() => requestWakeLock()).catch(() => {});
    } else {
      nextTrack(true);
    }
  });

  if (el.progress) {
    el.progress.addEventListener("pointerdown", () => isSlidingRange = true);
    el.progress.addEventListener("pointerup", () => isSlidingRange = false);
    el.progress.addEventListener("input", () => {
      if (audio.audio.duration) audio.audio.currentTime = (Number(el.progress.value) / 100) * audio.audio.duration;
    });
  }

  if (el.btnPlay) el.btnPlay.addEventListener("click", playPause);
  if (el.miniPlay) el.miniPlay.addEventListener("click", playPause);
  if (el.btnPrev) el.btnPrev.addEventListener("click", prevTrack);
  if (el.miniPrev) el.miniPrev.addEventListener("click", prevTrack);
  if (el.btnNext) el.btnNext.addEventListener("click", () => nextTrack(false));
  if (el.miniNext) el.miniNext.addEventListener("click", () => nextTrack(false));
  if (el.btnRewind10) el.btnRewind10.addEventListener("click", () => { audio.audio.currentTime = Math.max(0, audio.audio.currentTime - 10); });
  if (el.btnForward10) el.btnForward10.addEventListener("click", () => { audio.audio.currentTime = Math.min(audio.audio.duration || 0, audio.audio.currentTime + 10); });

  if (el.btnFav) {
    el.btnFav.addEventListener("click", () => {
      if (state.currentSong) toggleFav(state.currentSong.name);
    });
  }

  if (el.btnMainShuffle) {
    el.btnMainShuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      saveState();
      el.btnMainShuffle.classList.toggle("active", state.shuffle);
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

  if (el.search) {
    el.search.addEventListener("input", e => {
      state.search = e.target.value;
      renderSongList();
    });
  }

  if (el.playbackRate) {
    el.playbackRate.addEventListener("input", e => {
      currentRate = Number(e.target.value);
      if (el.customRateInput) el.customRateInput.value = currentRate.toFixed(2);
      applyPitchAndRate();
    });
  }

  if (el.pitchShift) {
    el.pitchShift.addEventListener("input", e => {
      state.pitchSemitones = Number(e.target.value);
      saveState();
      applyPitchAndRate();
    });
  }

  if (el.pannerSlider) {
    el.pannerSlider.addEventListener("input", e => {
      state.panValue = Number(e.target.value);
      if (audio.pannerNode) audio.pannerNode.pan.value = state.panValue;
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

  function drawWave() {
    if (audio.audio.paused || document.visibilityState !== "visible") {
      isWaveAnimating = false;
      return;
    }

    requestAnimationFrame(drawWave);
    const now = performance.now();
    const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (!el.wave) return;
    Visualizer.resizeCanvas(el.wave);
    const canvas = el.wave;
    const ctx = canvas.getContext("2d");
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;
    ctx.clearRect(0, 0, width, height);

    audio.updateSpatialAudio(dt, state.dMode, state.panValue);

    if (audio.analyser && audio.analyserData) {
      audio.analyser.getByteFrequencyData(audio.analyserData);

      if (state.silenceSkip && !audio.audio.paused) {
        let sum = 0;
        for (let i = 0; i < audio.analyserData.length; i++) sum += audio.analyserData[i];
        const avg = sum / audio.analyserData.length;
        const cur = audio.audio.currentTime, dur = audio.audio.duration;

        if (avg < 2 && cur > 2 && dur - cur > 3) {
          silenceTimer += dt;
          if (silenceTimer >= 2.0) {
            audio.audio.currentTime += 0.5;
            silenceTimer = 0;
          }
        } else {
          silenceTimer = 0;
        }
      }

      if (state.waveMode === "3d") {
        const bars = audio.analyserData.length;
        const barWidth = width / bars;
        for (let i = 0; i < bars; i++) {
          const value = audio.analyserData[i];
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
        const sliceWidth = width / audio.analyserData.length;
        let x = 0;
        for (let i = 0; i < audio.analyserData.length; i++) {
          const v = audio.analyserData[i] / 128.0;
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
    if (!isWaveAnimating && !audio.audio.paused) {
      isWaveAnimating = true;
      lastFrameTime = performance.now();
      requestAnimationFrame(drawWave);
    }
  }

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

  (async () => {
    await Storage.initDB(toast);
    await reloadPlaylistFromDB();
    applyTheme();
    renderEqualizer();
    renderColorPickers();
    setDMode(state.dMode);
    updateVolumeUI(currentVolumeTarget);
    applyPitchAndRate();
    setupMediaSessionRemoteControls();
  })();
})();
