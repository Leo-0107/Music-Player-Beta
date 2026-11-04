  const STORAGE = {
    favorites: "mp_favs_v12",
    queue: "mp_queue_v12",
    playCounts: "mp_counts_v12",
    playHistory: "mp_history_v12",
    playStats: "mp_stats_v1",
    playbackMonthly: "mp_playback_monthly_v1",
    waveParticleCount: "mp_wave_particle_count_v1",
    eqState: "mp_eq_v12",
    volume: "mp_vol_v12",
    pitch: "mp_pitch_v12",
    shuffle: "mp_shuffle_v12",
    repeat: "mp_repeat_v12",
    favOnly: "mp_favonly_v12",
    themeMode: "mp_thememode_v12",
    customTheme: "mp_custtheme_v12",
    playlists: "mp_playlists_v12",
    playlistOrder: "mp_playlist_order_v12",
    crossfade: "mp_crossfade_v12",
    silenceSkip: "mp_silenceskip_v12",
    dMode: "mp_dmode_v12",
    waveMode: "mp_wavemode_v12",
    clippingProtection: "mp_clipping_v12",
    channelLeft: "mp_channel_left_v13",
    channelRight: "mp_channel_right_v13",
    micMonitorVolume: "mp_mic_monitor_volume_v1",
    micFeedbackProtection: "mp_mic_feedback_protection_v1",
    micFeedbackStrength: "mp_mic_feedback_strength_v1",
    speakerPairSwap: "mp_speaker_pair_swap_v1",
    visualizerSettings: "mp_visualizer_settings_v1",
    visualizerModeSettings: "mp_visualizer_mode_settings_v1",
    outputRoutes: "mp_output_routes_v1",
    mainOutputDevice: "mp_main_output_device_v1",
    speakerSettings: "mp_speaker_settings_v1",
    playlistSettings: "mp_playlist_settings_v12",
    homeLayout: "mp_home_layout_v1",
    lastSong: "mp_last_song_v12",
    lastPosition: "mp_last_position_v1",
    lastPlayback: "mp_last_playback_v1"
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

  const dbName = "Music Player v7.2";
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
  window.addEventListener("pagehide", event => {
    if (!event.persisted) revokeAllObjectURLs();
  });


  function migrateLegacyDB() {
    const oldDbName = "Music Player v3.8";
    return new Promise(resolve => {
      if (!indexedDB.databases) return resolve();

      indexedDB.databases().then(databases => {
        if (!databases.some(info => info.name === oldDbName)) return resolve();

        const req = indexedDB.open(oldDbName);
        req.onblocked = () => resolve();
        req.onsuccess = e => {
          const oldDb = e.target.result;
          if (!oldDb.objectStoreNames.contains("tracks")) {
            oldDb.close();
            return resolve();
          }

          let readTx;
          try {
            readTx = oldDb.transaction("tracks", "readonly");
          } catch {
            oldDb.close();
            return resolve();
          }

          const getReq = readTx.objectStore("tracks").getAll();
          getReq.onsuccess = () => {
            const tracks = getReq.result || [];
            oldDb.close();

            if (!tracks.length || !db) return resolve();

            try {
              const writeTx = db.transaction("tracks", "readwrite");
              const store = writeTx.objectStore("tracks");
              const existingReq = store.getAllKeys();

              existingReq.onsuccess = () => {
                const existingNames = new Set(existingReq.result || []);
                for (const track of tracks) {
                  if (track && track.name && !existingNames.has(track.name)) {
                    store.put(track);
                  }
                }
              };
              existingReq.onerror = () => writeTx.abort();
              writeTx.oncomplete = () => {
                indexedDB.deleteDatabase(oldDbName);
                toast("v3.8の保存曲をv7.2へ移行しました");
                resolve();
              };
              writeTx.onerror = () => resolve();
              writeTx.onabort = () => resolve();
            } catch {
              resolve();
            }
          };
          getReq.onerror = () => {
            oldDb.close();
            resolve();
          };
        };
        req.onerror = () => resolve();
      }).catch(() => resolve());
    });
  }

  function openDBConnection() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      try {
        const req = indexedDB.open(dbName, 1);

        req.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains("tracks")) {
            d.createObjectStore("tracks", { keyPath: "name" });
          }
        };

        req.onblocked = () => finish(reject, new Error("blocked"));

        req.onsuccess = e => {
          const openedDB = e.target.result;
          openedDB.onversionchange = () => {
            try { openedDB.close(); } catch {}
          };
          openedDB.onerror = () => {
            try { openedDB.close(); } catch {}
          };
          finish(resolve, openedDB);
        };

        req.onerror = () => finish(reject, req.error || new Error("open failed"));
      } catch (e) {
        finish(reject, e);
      }
    });
  }

  async function initDB() {
    if (db) {
      try {
        if (db.objectStoreNames.contains("tracks")) return true;
      } catch {}
      try { db.close(); } catch {}
      db = null;
    }

    if (!("indexedDB" in window)) {
      toast("IndexedDBがこのブラウザでは利用できません");
      return false;
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        db = await openDBConnection();
        await migrateLegacyDB();

        if (navigator.storage?.persist) {
          try { await navigator.storage.persist(); } catch {}
        }

        return true;
      } catch {
        db = null;
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
        }
      }
    }

    toast("データベースに接続できませんでした。ブラウザのストレージ設定を確認してください");
    return false;
  }

  function saveTrackToDB(trackData) {
    return new Promise(resolve => {
      if (!db) return resolve(false);
      try {
        const tx = db.transaction("tracks", "readwrite");
        tx.objectStore("tracks").put(trackData);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          toast("トラックの保存中にエラーが発生しました");
          resolve(false);
        };
        tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
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