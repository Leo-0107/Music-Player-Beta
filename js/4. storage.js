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
    clippingProtection: "mp_clippingprotection_v1",
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
