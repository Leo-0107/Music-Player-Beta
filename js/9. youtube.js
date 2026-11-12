// YouTube連携 v1
// 公式IFrame Player APIを利用し、音声抽出や非公式ストリーム取得は行わない。
(() => {
  const YT_STORAGE_KEY = "mp_youtube_v1";
  const YT_LIBRARY_STORAGE_KEY = "mp_youtube_library_v1";
  const YOUTUBE_DATA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const YOUTUBE_SEARCH_INSTANCES = [
    "https://invidious.f5.si",
    "https://invidious.tiekoetter.com",
    "https://invidious.nerdvpn.de",
    "https://yt.chocolatemoo53.com",
    "https://inv.nadeko.net"
  ];
  let youtubeSearchInstanceIndex = 0;

  function pruneYoutubeMetadata(items, now = Date.now()) {
    const retained = [];
    for (const original of items) {
      let item = original;
      if (item.userTitle && !item.customTitle) {
        item = {
          ...item,
          customTitle: item.title,
          title: "YouTube動画",
          author: "YouTube",
          metadataSource: "placeholder"
        };
        delete item.userTitle;
      }
      const timestamp = Number(item.apiDataFetchedAt || item.addedAt || 0);
      const isFresh = Number.isFinite(timestamp) && timestamp > 0 &&
        now - timestamp <= YOUTUBE_DATA_MAX_AGE_MS;
      if (isFresh) {
        retained.push(item);
      } else if (item.customTitle) {
        retained.push({
          ...item,
          title: "YouTube動画",
          author: "YouTube",
          apiDataFetchedAt: null,
          addedAt: now,
          metadataSource: "placeholder"
        });
      }
    }
    return retained;
  }
  function readYoutubeLibraryItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(YT_LIBRARY_STORAGE_KEY) || "[]");
      const valid = Array.isArray(raw) ? raw.filter(x => x && /^[\w-]{11}$/.test(x.id)) : [];
      const retained = pruneYoutubeMetadata(valid);
      if (JSON.stringify(valid) !== JSON.stringify(retained)) {
        try { localStorage.setItem(YT_LIBRARY_STORAGE_KEY, JSON.stringify(retained)); } catch {}
      }
      return retained;
    } catch { return []; }
  }
  const youtubeLibraryItems = new Map(readYoutubeLibraryItems().map(item => [item.id, item]));
  const youtubeItems = new Map();
  let youtubePlayer = null;
  let youtubePlayerReady = false;
  let youtubeApiPromise = null;
  let currentYoutubeItem = null;
  let pendingPlayId = null;

  function isYoutubePlaybackContextActive() {
    const youtubeTab = document.querySelector('.navTab[data-target="youtube"]');
    return document.visibilityState === "visible" && !!youtubeTab?.classList.contains("active");
  }

  function pauseYoutubeForBackground(reason) {
    if (!isYoutubeSong(state.currentSong)) return false;
    const wasPending = !!pendingPlayId;
    const playerState = Number(youtubePlayer?.getPlayerState?.());
    const playerStates = window.YT?.PlayerState || {};
    const playerIsActive = Number.isFinite(playerState) &&
      playerState !== playerStates.PAUSED && playerState !== playerStates.ENDED;
    if (!wasPending && !playerIsActive) return false;

    // 読み込み中の動画が、画面離脱後にonReadyで再生される競合も防ぐ。
    youtubeRequestSerial++;
    pendingPlayId = null;
    try { youtubePlayer?.pauseVideo?.(); } catch {}
    stopYoutubePlaybackStats();
    setPlaybackIntent(false);
    updatePlayPauseUI();
    const status = document.getElementById("youtubeStatus");
    if (status) status.textContent = reason === "tab"
      ? "YouTube画面を離れたため、自動的に一時停止しました。"
      : "アプリがバックグラウンドになったため、自動的に一時停止しました。";
    return true;
  }

  let backgroundYoutubeAdvanceHandled = false;

  function advanceYoutubeForBackground() {
    if (!isYoutubeSong(state.currentSong) || backgroundYoutubeAdvanceHandled) return false;
    const wasPending = !!pendingPlayId;
    const playerState = Number(youtubePlayer?.getPlayerState?.());
    const playerStates = window.YT?.PlayerState || {};
    const playerIsActive = Number.isFinite(playerState) &&
      playerState !== playerStates.PAUSED && playerState !== playerStates.ENDED;
    if (!wasPending && !playerIsActive) return false;

    // visibilitychangeとpagehideが続けて発生しても、次曲送りは一度だけにする。
    backgroundYoutubeAdvanceHandled = true;
    youtubeRequestSerial++;
    pendingPlayId = null;
    try { youtubePlayer?.pauseVideo?.(); } catch {}
    stopYoutubePlaybackStats();

    // キュー／プレイリストの順序を保ちつつ、バックグラウンドではYouTube以外の曲を探す。
    const maxAttempts = Math.max(1, state.playlist.length + state.queue.length + 1);
    let advancedToLocalSong = false;
    for (let i = 0; i < maxAttempts; i++) {
      const previousSong = state.currentSong;
      nextTrack(true);
      if (state.currentSong === previousSong) break;
      if (!isYoutubeSong(state.currentSong)) {
        advancedToLocalSong = true;
        break;
      }
      // キューやプレイリスト内に続けてYouTubeがある場合は読み込み要求を無効化して次へ進む。
      youtubeRequestSerial++;
      pendingPlayId = null;
      try { youtubePlayer?.pauseVideo?.(); } catch {}
      stopYoutubePlaybackStats();
    }

    if (!advancedToLocalSong) {
      youtubeRequestSerial++;
      pendingPlayId = null;
      try { youtubePlayer?.pauseVideo?.(); } catch {}
      setPlaybackIntent(false);
      updatePlayPauseUI();
      const status = document.getElementById("youtubeStatus");
      if (status) status.textContent = "バックグラウンドへ移動しました。次に再生できる通常の曲がありません。";
    }
    return true;
  }

  function readYoutubeItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(YT_STORAGE_KEY) || "[]");
      const valid = Array.isArray(raw) ? raw.filter(x => x && /^[\w-]{11}$/.test(x.id)) : [];
      const retained = pruneYoutubeMetadata(valid);
      if (JSON.stringify(valid) !== JSON.stringify(retained)) {
        try { localStorage.setItem(YT_STORAGE_KEY, JSON.stringify(retained)); } catch {}
      }
      return retained;
    } catch { return []; }
  }

  function saveYoutubeLibraryItems() {
    try {
      localStorage.setItem(YT_LIBRARY_STORAGE_KEY, JSON.stringify(Array.from(youtubeLibraryItems.values())));
    } catch { toast("プレイリスト用のYouTube曲情報を保存できませんでした"); }
  }

  function saveYoutubeItems() {
    try { localStorage.setItem(YT_STORAGE_KEY, JSON.stringify(Array.from(youtubeItems.values()))); }
    catch { toast("YouTube動画を保存できませんでした"); }
    youtubeItems.forEach(item => youtubeLibraryItems.set(item.id, { ...item }));
    saveYoutubeLibraryItems();
  }

  function parseYoutubeId(value) {
    try {
      const url = new URL(String(value).trim());
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else if (/^\/(embed|shorts|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] || "";
      }
      return /^[\w-]{11}$/.test(id) ? id : null;
    } catch { return null; }
  }

  function ensureYoutubeSong(item) {
    const name = "yt:" + item.id;
    let song = state.playlist.find(x => x.name === name);
    if (!song) {
      song = { name, title: item.title || "YouTube動画", artist: item.author || "YouTube", duration: Number(item.duration) > 0 ? Number(item.duration) : null, mediaType: "youtube", youtubeId: item.id, url: "" };
      state.playlist.push(song);
    } else {
      song.title = item.title || song.title;
      song.artist = item.author || "YouTube";
      song.mediaType = "youtube";
      song.youtubeId = item.id;
      song.url = "";
      if (Number(item.duration) > 0) song.duration = Number(item.duration);
    }
    return song;
  }

  function restoreYoutubeSongs() {
    youtubeItems.clear();
    readYoutubeItems().forEach(item => {
      youtubeItems.set(item.id, item);
      youtubeLibraryItems.set(item.id, { ...item });
      ensureYoutubeSong(item);
      if (!item.author || !item.title || item.title === "YouTube動画 " + item.id || item.title === "動画情報を取得中...") fetchYoutubeVideoTitle(item);
    });
    // 登録解除後も、プレイリストや最後に再生した曲に残るYouTube曲だけを復元する。
    const retainedYoutubeNames = new Set(
      Object.values(state.playlists || {}).flat().filter(name => String(name).startsWith("yt:"))
    );
    const lastSongName = loadStr(STORAGE.lastSong, "");
    if (String(lastSongName).startsWith("yt:")) retainedYoutubeNames.add(lastSongName);
    if (String(state.currentSong?.name || "").startsWith("yt:")) retainedYoutubeNames.add(state.currentSong.name);
    youtubeLibraryItems.forEach(item => {
      if (retainedYoutubeNames.has("yt:" + item.id)) ensureYoutubeSong(item);
    });
    // 期限切れメタデータを削除しても、ユーザーが保存したプレイリスト参照は残す。
    retainedYoutubeNames.forEach(name => {
      const id = String(name).slice(3);
      if (!/^[\w-]{11}$/.test(id) || youtubeLibraryItems.has(id)) return;
      const placeholder = {
        id,
        title: "YouTube動画",
        author: "YouTube",
        addedAt: Date.now(),
        metadataSource: "placeholder"
      };
      youtubeLibraryItems.set(id, placeholder);
      ensureYoutubeSong(placeholder);
    });
    saveYoutubeLibraryItems();
    renderYoutubeList();
  }

  let youtubeRequestSerial = 0;

  function isYoutubeSong(song) {
    return !!song && (song.mediaType === "youtube" || String(song.name || "").startsWith("yt:"));
  }

  function getYoutubeItemForSong(song) {
    if (!isYoutubeSong(song)) return null;
    const id = song.youtubeId || String(song.name).slice(3);
    const item = youtubeItems.get(id) || youtubeLibraryItems.get(id) || { id, title: song.title || "YouTube動画" };
    if (item.metadataSource === "placeholder") fetchYoutubeVideoTitle(item);
    return item;
  }

  window.getYoutubePlaylistSongs = function() {
    return Array.from(youtubeItems.values()).map(item => ensureYoutubeSong(item));
  };

  function loadYoutubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      let settled = false;
      let script = null;
      const previous = window.onYouTubeIframeAPIReady;
      const readyHandler = () => {
        try { previous?.(); } catch {}
        finish();
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          if (script) script.remove();
          if (window.onYouTubeIframeAPIReady === readyHandler) {
            window.onYouTubeIframeAPIReady = previous || null;
          }
          youtubeApiPromise = null;
          reject(error);
        } else {
          resolve();
        }
      };
      const timeout = setTimeout(() => finish(new Error("YouTube APIの読み込みがタイムアウトしました")), 15000);
      window.onYouTubeIframeAPIReady = readyHandler;
      script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        script.onerror = () => finish(new Error("YouTube APIの読み込みに失敗しました"));
        document.head.appendChild(script);
      } else {
        script.onerror = () => finish(new Error("YouTube APIの読み込みに失敗しました"));
      }
    });
    return youtubeApiPromise;
  }

  let youtubeStatsTimer = null;
  let youtubeStatsLastTime = null;
  let youtubeIsSlidingRange = false;
  let youtubeLiveTiming = {
    videoId: "",
    lastDuration: null,
    lastSampleAt: 0,
    increasingSamples: 0,
    stableSamples: 0,
    isLive: false
  };

  function formatYoutubeControlTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
  }

  function detectYoutubeLiveStream(item, duration) {
    const videoId = item?.id || "";
    if (youtubeLiveTiming.videoId !== videoId) {
      youtubeLiveTiming = {
        videoId,
        lastDuration: null,
        lastSampleAt: 0,
        increasingSamples: 0,
        stableSamples: 0,
        isLive: false
      };
    }

    const now = Date.now();
    if (duration > 0) {
      if (youtubeLiveTiming.lastDuration !== null) {
        const elapsed = Math.max(0, (now - youtubeLiveTiming.lastSampleAt) / 1000);
        const delta = duration - youtubeLiveTiming.lastDuration;

        // 非表示タブでのタイマー遅延をライブ判定の根拠にしない。再表示後に通常間隔で測定し直す。
        if (document.visibilityState !== "visible") {
          youtubeLiveTiming.lastDuration = duration;
          youtubeLiveTiming.lastSampleAt = now;
          return youtubeLiveTiming.isLive;
        }

        if (elapsed >= 0.75) {
          // ライブ配信のgetDuration()は配信開始からの経過時間。時間経過と近い増加が
          // 連続して観測された場合だけライブと判定し、単発の大きな値変化を除外する。
          const minimumLiveIncrease = Math.max(0.5, elapsed * 0.65);
          const maximumLiveIncrease = elapsed * 1.5 + 1.0;
          const stableTolerance = Math.max(0.5, elapsed * 0.15);

          if (delta >= minimumLiveIncrease && delta <= maximumLiveIncrease) {
            youtubeLiveTiming.increasingSamples += 1;
            youtubeLiveTiming.stableSamples = 0;
            if (youtubeLiveTiming.increasingSamples >= 3) youtubeLiveTiming.isLive = true;
          } else if (Math.abs(delta) <= stableTolerance) {
            youtubeLiveTiming.stableSamples += 1;
            youtubeLiveTiming.increasingSamples = 0;
            // 一度ライブと確認できた配信は、一時的な時間値の停滞だけでは通常動画へ戻さない。
          } else {
            // シーク、再接続、メタデータ更新などの不連続な変化は判定材料から外す。
            youtubeLiveTiming.stableSamples = 0;
            youtubeLiveTiming.increasingSamples = 0;
          }
        }
      }
      youtubeLiveTiming.lastDuration = duration;
      youtubeLiveTiming.lastSampleAt = now;
    }
    return youtubeLiveTiming.isLive;
  }

  function getYoutubePlaybackStatsSnapshot() {
    const playerState = Number(youtubePlayer?.getPlayerState?.());
    let loadedFraction = null;
    try {
      const value = Number(youtubePlayer?.getVideoLoadedFraction?.());
      if (Number.isFinite(value)) loadedFraction = Math.max(0, Math.min(1, value));
    } catch {}
    return {
      source: "YouTube IFrame Player API",
      active: !!currentYoutubeItem && isYoutubeSong(state.currentSong),
      videoId: currentYoutubeItem?.id || null,
      playerState: Number.isFinite(playerState) ? playerState : null,
      currentTime: Number(youtubePlayer?.getCurrentTime?.()) || 0,
      duration: Number(youtubePlayer?.getDuration?.()) || 0,
      loadedFraction,
      visibilityState: document.visibilityState,
      liveDetection: {
        isLive: youtubeLiveTiming.isLive,
        classification: youtubeLiveTiming.isLive ? "live" : youtubeLiveTiming.stableSamples >= 3 ? "on-demand" : "undetermined",
        increasingSamples: youtubeLiveTiming.increasingSamples,
        stableSamples: youtubeLiveTiming.stableSamples
      }
    };
  }
  window.__musicPlayerGetYoutubePlaybackStats = getYoutubePlaybackStatsSnapshot;

  function updateYoutubePlaybackControls() {
    const progress = document.getElementById("youtubeProgress");
    const timeNow = document.getElementById("youtubeTimeNow");
    const timeAll = document.getElementById("youtubeTimeAll");
    const item = currentYoutubeItem;
    const playerVideoId = youtubePlayer?.getVideoData?.()?.video_id || "";
    const playerMatchesItem = !!item && (!playerVideoId || playerVideoId === item.id);
    const current = playerMatchesItem ? Number(youtubePlayer?.getCurrentTime?.()) || 0 : 0;
    const duration = playerMatchesItem ? Number(youtubePlayer?.getDuration?.()) || 0 : 0;
    const isLive = playerMatchesItem && detectYoutubeLiveStream(item, duration);
    const liveOffset = isLive ? Math.max(0, duration - current) : 0;

    if (item && duration > 0 && !isLive && youtubeLiveTiming.stableSamples >= 2) {
      const song = ensureYoutubeSong(item);
      const storedDuration = Number(song.duration) || 0;
      const itemDuration = Number(item.duration) || 0;
      if (Math.abs(storedDuration - duration) > 0.5 || Math.abs(itemDuration - duration) > 0.5) {
        song.duration = duration;
        item.duration = duration;
        if (youtubeItems.has(item.id)) youtubeItems.set(item.id, item);
        youtubeLibraryItems.set(item.id, { ...item });
        saveYoutubeItems();
      }
      if (typeof updateRenderedTrackDuration === "function") updateRenderedTrackDuration(song.name, duration);
    }

    if (timeNow) {
      timeNow.textContent = isLive
        ? (liveOffset > 0.5 ? "-" + formatYoutubeControlTime(liveOffset) : "0:00")
        : formatYoutubeControlTime(current);
    }
    if (timeAll) timeAll.textContent = isLive ? "-:--" : (duration > 0 ? formatYoutubeControlTime(duration) : "0:00");
    if (progress) {
      progress.disabled = isLive || !(duration > 0);
      if (!youtubeIsSlidingRange) progress.value = !isLive && duration > 0 ? String(Math.min(100, current / duration * 100)) : "0";
    }

    const songName = state.currentSong?.name || "";
    const favorite = document.getElementById("youtubeFavBtn");
    if (favorite) {
      const isFavorite = !!songName && state.favorites.includes(songName);
      favorite.textContent = isFavorite ? "⭐ お気に入り" : "☆ お気に入り";
      favorite.classList.toggle("active", isFavorite);
    }
    document.getElementById("youtubeShuffleBtn")?.classList.toggle("active", !!state.shuffle);
    document.getElementById("youtubeRepeatBtn")?.classList.toggle("active", !!state.repeat);
    const addButton = document.getElementById("youtubeAddPlaylistBtn");
    if (addButton) addButton.disabled = !isYoutubeSong(state.currentSong);
  }

  function seekYoutubeBy(offset) {
    if (!isYoutubeSong(state.currentSong) || !youtubePlayer?.seekTo) return;
    const duration = Number(youtubePlayer.getDuration?.()) || 0;
    const current = Number(youtubePlayer.getCurrentTime?.()) || 0;
    if (duration <= 0) return;
    youtubePlayer.seekTo(Math.max(0, Math.min(duration, current + offset)), true);
    updateYoutubePlaybackControls();
  }

  function stopYoutubePlaybackStats() {
    if (youtubeStatsTimer !== null) {
      clearInterval(youtubeStatsTimer);
      youtubeStatsTimer = null;
    }
    youtubeStatsLastTime = null;
  }

  function startYoutubePlaybackStats() {
    if (youtubeStatsTimer !== null || !youtubePlayer?.getCurrentTime) return;
    youtubeStatsLastTime = Number(youtubePlayer.getCurrentTime()) || 0;
    youtubeStatsTimer = setInterval(() => {
      if (!currentYoutubeItem || !isYoutubeSong(state.currentSong) ||
          youtubePlayer?.getPlayerState?.() !== YT.PlayerState.PLAYING) {
        stopYoutubePlaybackStats();
        return;
      }
      const currentTime = Number(youtubePlayer.getCurrentTime()) || 0;
      const delta = currentTime - youtubeStatsLastTime;
      youtubeStatsLastTime = currentTime;
      if (delta > 0 && delta <= 2) recordPlaybackTime(delta);
      updateYoutubePlaybackControls();
    }, 1000);
  }

  function recordYoutubePartialPlayIfNeeded() {
    if (!currentYoutubeItem || !isYoutubeSong(state.currentSong) || hasCountedCurrentSong) return;
    const current = Number(youtubePlayer?.getCurrentTime?.()) || 0;
    const duration = Number(youtubePlayer?.getDuration?.()) || 0;
    if (current > 30 || (duration > 0 && current / duration > 0.5)) return;
    const stats = getSongStats(state.currentSong.name);
    if (!stats) return;
    stats.partialPlays++;
    stats.lastPlayed = Date.now();
    saveState();
  }

  async function playYoutubeItem(item) {
    if (!item || !/^[\w-]{11}$/.test(item.id)) return;
    const requestId = ++youtubeRequestSerial;
    currentYoutubeItem = item;
    pendingPlayId = item.id;
    const tab = document.querySelector('.navTab[data-target="youtube"]');
    if (tab) tab.click();
    const title = document.getElementById("youtubeCurrentTitle");
    const status = document.getElementById("youtubeStatus");
    const addButton = document.getElementById("youtubeAddPlaylistBtn");
    if (title) title.textContent = item.title || "YouTube動画";
    if (addButton) addButton.disabled = false;
    const progress = document.getElementById("youtubeProgress");
    if (progress) { progress.value = "0"; progress.disabled = true; }
    const timeNow = document.getElementById("youtubeTimeNow");
    const timeAll = document.getElementById("youtubeTimeAll");
    if (timeNow) timeNow.textContent = "0:00";
    if (timeAll) timeAll.textContent = Number(item.duration) > 0 ? formatYoutubeControlTime(item.duration) : "0:00";
    updatePlayPauseUI();
    // YouTubeの再生開始まではAudio側の再生復帰フラグを立てない。
    setPlaybackIntent(false);
    try {
      await loadYoutubeApi();
      if (requestId !== youtubeRequestSerial || !currentYoutubeItem || currentYoutubeItem.id !== item.id) return;
      const mount = document.getElementById("youtubePlayer");
      if (!mount) throw new Error("YouTubeプレイヤー領域が見つかりません");
      if (!youtubePlayer) {
        youtubePlayer = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          // 初期化時にvideoIdを渡すと、停止操作後でも自動ロードされるため、
          // 再生要求が有効なonReady時だけ動画をロードする。
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: event => {
              youtubePlayerReady = true;
              const active = currentYoutubeItem;
              if (pendingPlayId && active && pendingPlayId === active.id && isYoutubeSong(state.currentSong)) {
                if (!isYoutubePlaybackContextActive()) {
                  document.visibilityState === "visible" ? pauseYoutubeForBackground("tab") : advanceYoutubeForBackground();
                  return;
                }
                event.target.loadVideoById(active.id);
                pendingPlayId = null;
              }
            },
            onStateChange: event => {
              if (event.data === YT.PlayerState.PLAYING && currentYoutubeItem && isYoutubeSong(state.currentSong)) {
                if (!isYoutubePlaybackContextActive()) {
                  document.visibilityState === "visible" ? pauseYoutubeForBackground("tab") : advanceYoutubeForBackground();
                  updatePlayPauseUI();
                  return;
                }
                // YouTube再生も既存の再生回数・再生時間統計へ反映する。
                setPlaybackIntent(true);
                if (!hasCountedCurrentSong) recordPlayCount();
                startYoutubePlaybackStats();
              } else {
                stopYoutubePlaybackStats();
              }
              if (event.data === YT.PlayerState.ENDED && currentYoutubeItem && isYoutubeSong(state.currentSong)) {
                stopYoutubePlaybackStats();
                // 同じ動画IDが後からアーカイブ再生されても、終了済みライブ判定を引き継がない。
                youtubeLiveTiming = {
                  videoId: currentYoutubeItem.id,
                  lastDuration: Number(youtubePlayer?.getDuration?.()) || youtubeLiveTiming.lastDuration,
                  lastSampleAt: Date.now(),
                  increasingSamples: 0,
                  stableSamples: 3,
                  isLive: false
                };
                setPlaybackIntent(false);
                nextTrack(true);
              }
              updatePlayPauseUI();
              updateYoutubePlaybackControls();
            },
            onAutoplayBlocked: () => {
              if (status) status.textContent = "ブラウザが自動再生をブロックしました。プレイヤーの再生ボタンを押してください。";
              setPlaybackIntent(false);
              updatePlayPauseUI();
            },
            onError: event => {
              const errorCode = Number(event?.data || 0);
              const failedVideoId = String(currentYoutubeItem?.id || "unknown");
              const playerError = new Error("YouTube Player API error: " + errorCode + " (videoId: " + failedVideoId + ")");
              window.__musicPlayerReportError?.("YOUTUBE", "iframe-player", playerError);
              const errorMessages = {
                2: "動画IDまたは再生パラメーターが正しくありません。",
                5: "動画をHTML5プレーヤーで再生できませんでした。",
                100: "動画が見つかりません。削除済み、または非公開の可能性があります。",
                101: "動画の所有者が外部サイトでの埋め込み再生を許可していません。",
                150: "動画の所有者が外部サイトでの埋め込み再生を許可していません。",
                153: "YouTubeへのリクエストに必要な識別情報が不足しています。"
              };
              const knownMessage = errorMessages[errorCode];
              if (status) {
                status.textContent = knownMessage
                  ? knownMessage + " (エラー " + errorCode + ")"
                  : "YouTubeから未分類の再生エラーが返されました (エラー " + errorCode + ")。原因は特定できません。YouTube側の制限や一時的な問題の可能性があります。";
              }
              setPlaybackIntent(false);
              updatePlayPauseUI();
            }
          }
        });
      } else if (youtubePlayerReady) {
        youtubePlayer.loadVideoById(item.id);
        pendingPlayId = null;
      } else {
        // プレイヤー生成直後でまだ準備ができていない場合は、最新の動画IDだけを保持する。
        pendingPlayId = item.id;
      }
      if (status) status.textContent = "YouTube公式プレイヤーで再生します。";
    } catch (error) {
      if (requestId !== youtubeRequestSerial) return;
      window.__musicPlayerReportError?.("YOUTUBE", "player-load", error);
      if (status) status.textContent = error.message || "YouTubeプレイヤーを読み込めませんでした。"
      setPlaybackIntent(false);
      updatePlayPauseUI();
    }
  }

  async function fetchYoutubeVideoTitle(item) {
    if (!item?.id || (youtubeItems.get(item.id) !== item && youtubeLibraryItems.get(item.id) !== item)) return;
    const fallbackTitle = "YouTube動画 " + item.id;
    const isPlaceholder = () => item.title === fallbackTitle || item.title === "動画情報を取得中..." || item.title === "YouTube動画";
    try {
      const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(item.id);
      const response = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json");
      if (!response.ok) throw new Error("動画情報を取得できませんでした");
      const data = await response.json();
      const title = String(data.title || "").trim();
      const author = String(data.author_name || "").trim();
      // 手動で変更した動画名は保持し、未取得の作者名だけを補完する。
      if (title && isPlaceholder()) item.title = title;
      if (author && item.author !== author) item.author = author;
      if (youtubeItems.get(item.id) !== item && youtubeLibraryItems.get(item.id) !== item) return;
      item.apiDataFetchedAt = Date.now();
      item.addedAt = item.addedAt || item.apiDataFetchedAt;
      item.metadataSource = "oembed";
      if (youtubeItems.get(item.id) === item) youtubeItems.set(item.id, item);
      if (youtubeLibraryItems.get(item.id) === item) youtubeLibraryItems.set(item.id, item);
      saveYoutubeItems();
      const song = ensureYoutubeSong(item);
      if (state.currentSong?.name === song.name) updateNowPlayingUI(song);
      const currentTitle = document.getElementById("youtubeCurrentTitle");
      if (currentTitle && currentYoutubeItem?.id === item.id) currentTitle.textContent = item.title || "YouTube動画";
      renderYoutubeList();
    } catch (error) {
      // oEmbedにアクセスできない場合も、URL登録と再生はそのまま利用できる。
    }
  }

  function setYoutubeSearchStatus(message) {
    const status = document.getElementById("youtubeSearchStatus");
    if (status) status.textContent = message;
  }

  function renderYoutubeSearchResults(items) {
    const list = document.getElementById("youtubeSearchResults");
    if (!list) return;
    list.innerHTML = "";
    if (!items.length) { list.textContent = "検索結果がありません。"; return; }
    items.forEach(video => {
      const id = video.id?.videoId;
      const snippet = video.snippet || {};
      if (!id || !/^[\w-]{11}$/.test(id)) return;
      const fetchedAt = Date.now();
      const item = {
        id,
        title: String(snippet.title || "YouTube動画"),
        author: String(snippet.channelTitle || "YouTube"),
        addedAt: fetchedAt,
        apiDataFetchedAt: fetchedAt,
        metadataSource: "invidious"
      };
      const row = document.createElement("div");
      row.className = "song";
      row.style.alignItems = "center";
      const main = document.createElement("div");
      main.className = "songMain";
      main.style.minWidth = "0";
      const title = document.createElement("div");
      title.className = "songName";
      title.textContent = item.title;
      const author = document.createElement("div");
      author.className = "songArtist";
      author.textContent = item.author;
      main.append(title, author);
      const actions = document.createElement("div");
      actions.className = "songRight";
      const play = document.createElement("button");
      play.className = "btn small"; play.type = "button"; play.textContent = "▶ 再生";
      play.addEventListener("click", () => {
        const saved = youtubeItems.get(id);
        if (saved) playSong(ensureYoutubeSong(saved));
        else { youtubeItems.set(id, item); ensureYoutubeSong(item); playSong(ensureYoutubeSong(item)); }
      });
      const add = document.createElement("button");
      add.className = "btn small ghost"; add.type = "button";
      add.textContent = youtubeItems.has(id) ? "登録済み" : "＋ 登録";
      add.disabled = youtubeItems.has(id);
      add.addEventListener("click", () => {
        if (youtubeItems.has(id)) return;
        youtubeItems.set(id, item); saveYoutubeItems(); ensureYoutubeSong(item); renderYoutubeList();
        add.textContent = "登録済み"; add.disabled = true; toast("YouTube動画を登録しました");
      });
      actions.append(play, add); row.append(main, actions); list.appendChild(row);
    });
  }

  async function fetchYoutubeSearchItems(query) {
    const params = new URLSearchParams({
      q: query,
      type: "video",
      page: "1",
      region: "JP",
      hl: "ja"
    });
    let lastError = null;
    for (let attempt = 0; attempt < YOUTUBE_SEARCH_INSTANCES.length; attempt++) {
      const instanceIndex = (youtubeSearchInstanceIndex + attempt) % YOUTUBE_SEARCH_INSTANCES.length;
      const baseUrl = YOUTUBE_SEARCH_INSTANCES[instanceIndex];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(baseUrl + "/api/v1/search?" + params.toString(), {
          headers: { "Accept": "application/json" },
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("検索結果の形式が正しくありません。");
        youtubeSearchInstanceIndex = instanceIndex;
        return data
          .filter(video => video?.type === "video" && /^[\w-]{11}$/.test(video.videoId || ""))
          .slice(0, 10)
          .map(video => ({
            id: { videoId: video.videoId },
            snippet: {
              title: video.title || "YouTube動画",
              channelTitle: video.author || "YouTube"
            }
          }));
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("検索サービスに接続できませんでした。時間をおいて再度お試しください。");
  }

  async function searchYoutubeVideos() {
    const query = String(document.getElementById("youtubeSearchInput")?.value || "").trim();
    const results = document.getElementById("youtubeSearchResults");
    if (!query) { setYoutubeSearchStatus("検索キーワードを入力してください。"); return; }
    const button = document.getElementById("youtubeSearchBtn");
    if (button) button.disabled = true;
    if (results) results.textContent = "検索しています...";
    setYoutubeSearchStatus("YouTubeを検索しています...");
    try {
      const items = await fetchYoutubeSearchItems(query);
      renderYoutubeSearchResults(items);
      setYoutubeSearchStatus(items.length + "件の検索結果");
    } catch (error) {
      if (results) results.textContent = "";
      setYoutubeSearchStatus(error.message || "検索に失敗しました。");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function initializeYoutubeSearch() {
    // YouTube画面を離れた場合は停止し、戻っても自動再開しない。
    document.querySelectorAll(".navTab").forEach(tab => {
      tab.addEventListener("click", () => {
        if (tab.dataset.target !== "youtube") pauseYoutubeForBackground("tab");
      });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") {
        advanceYoutubeForBackground();
      } else {
        backgroundYoutubeAdvanceHandled = false;
      }
    });
    window.addEventListener("pagehide", () => advanceYoutubeForBackground());

    const urlModeButton = document.getElementById("youtubeUrlModeBtn");
    const keywordModeButton = document.getElementById("youtubeKeywordModeBtn");
    const urlModePanel = document.getElementById("youtubeUrlMode");
    const keywordModePanel = document.getElementById("youtubeKeywordMode");
    const setInputMode = mode => {
      const isUrlMode = mode === "url";
      if (urlModePanel) urlModePanel.hidden = !isUrlMode;
      if (keywordModePanel) keywordModePanel.hidden = isUrlMode;
      urlModeButton?.classList.toggle("active", isUrlMode);
      keywordModeButton?.classList.toggle("active", !isUrlMode);
      urlModeButton?.setAttribute("aria-pressed", String(isUrlMode));
      keywordModeButton?.setAttribute("aria-pressed", String(!isUrlMode));
      if (!isUrlMode) setYoutubeSearchStatus("");
    };
    urlModeButton?.addEventListener("click", () => setInputMode("url"));
    keywordModeButton?.addEventListener("click", () => setInputMode("keyword"));
    setInputMode("url");
    document.getElementById("youtubeSearchBtn")?.addEventListener("click", searchYoutubeVideos);
    document.getElementById("youtubeSearchInput")?.addEventListener("keydown", event => { if (event.key === "Enter") searchYoutubeVideos(); });
  }

  function addYoutubeUrl(value) {
    const id = parseYoutubeId(value);
    if (!id) return toast("YouTubeの動画URLを確認してください");
    let item = youtubeItems.get(id);
    if (!item) {
      const archived = youtubeLibraryItems.get(id);
      item = archived
        ? { ...archived, addedAt: Date.now() }
        : { id, title: "動画情報を取得中...", addedAt: Date.now() };
      youtubeItems.set(id, item);
      saveYoutubeItems();
    }
    ensureYoutubeSong(item);
    renderYoutubeList();
    const input = document.getElementById("youtubeUrlInput");
    if (input) input.value = "";
    toast("YouTube動画を登録しました");
    const song = ensureYoutubeSong(item);
    playSong(song);
    fetchYoutubeVideoTitle(item);
  }

  function renameYoutubeItem(item) {
    if (!item || !youtubeItems.has(item.id)) return;
    showInSitePrompt(
      "YouTube動画の表示名を変更",
      "このアプリ内で使う別名を入力してください。YouTubeの公式タイトルは変更せず表示します。",
      item.customTitle || item.title || "YouTube動画",
      value => {
        const title = String(value || "").trim();
        if (!title || title === item.customTitle) return;
        item.customTitle = title;
        delete item.userTitle;
        youtubeItems.set(item.id, item);
        saveYoutubeItems();
        const song = ensureYoutubeSong(item);
        if (state.currentSong?.name === song.name) {
          updateNowPlayingUI(song);
          const currentTitle = document.getElementById("youtubeCurrentTitle");
          if (currentTitle) currentTitle.textContent = title;
        }
        renderYoutubeList();
        toast("動画名を変更しました");
      }
    );
  }

  function deleteYoutubeItem(item) {
    if (!item || !youtubeItems.has(item.id)) return;
    showInSiteConfirm(
      "登録した動画を削除しますか？",
      "登録一覧から削除し、キュー・お気に入り・プレイリストからも外します。",
      () => {
        const name = "yt:" + item.id;
        youtubeItems.delete(item.id);
        youtubeLibraryItems.delete(item.id);
        saveYoutubeItems();
        state.playlist = state.playlist.filter(song => song.name !== name);
        state.playlistOrder = (state.playlistOrder || []).filter(songName => songName !== name);
        state.queue = (state.queue || []).filter(songName => songName !== name);
        state.favorites = (state.favorites || []).filter(songName => songName !== name);
        Object.keys(state.playlists || {}).forEach(playlistName => {
          state.playlists[playlistName] = (state.playlists[playlistName] || []).filter(songName => songName !== name);
        });
        if (state.currentSong?.name === name) {
          recordYoutubePartialPlayIfNeeded();
          youtubeRequestSerial++;
          pendingPlayId = null;
          stopYoutubePlaybackStats();
          try { youtubePlayer?.stopVideo(); } catch {}
          currentYoutubeItem = null;
          setPlaybackIntent(false);
          try { audio.pause(); } catch {}
          state.currentSong = null;
          try { localStorage.removeItem(STORAGE.lastSong); } catch {}
          updateArtwork(null);
          updateTitleTextAndScroll(el.nowTitle, "未再生");
          updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
          updateTitleTextAndScroll(el.miniTitle, "停止中");
          document.querySelectorAll(".song.active").forEach(row => row.classList.remove("active"));
          updatePlayPauseUI();
          const currentTitle = document.getElementById("youtubeCurrentTitle");
          if (currentTitle) currentTitle.textContent = "動画を選択してください";
          const playButton = document.getElementById("youtubePlayPauseBtn");
          if (playButton) playButton.textContent = "▶ 再生";
        }
        saveState();
        renderAll();
        renderYoutubeList();
        toast("登録動画を削除しました");
      },
      "削除"
    );
  }

  function resetAllYoutubeItems() {
    if (!youtubeItems.size) {
      toast("登録したYouTube動画はありません");
      return;
    }
    showInSiteConfirm(
      "YouTube登録動画を一括リセットしますか？",
      "登録一覧からすべて解除し、再生キューとお気に入りからも削除します。プレイリストとプレイリスト内のYouTube曲情報は残ります。",
      () => {
        const removedNames = new Set(Array.from(youtubeItems.keys(), id => "yt:" + id));
        youtubeItems.clear();
        saveYoutubeItems();
        state.queue = (state.queue || []).filter(name => !removedNames.has(name));
        state.favorites = (state.favorites || []).filter(name => !removedNames.has(name));
        state.playlistOrder = (state.playlistOrder || []).filter(name => !removedNames.has(name));
        saveState();
        renderAll();
        renderYoutubeList();
        toast("YouTube登録動画を一括リセットしました");
      },
      "一括リセット"
    );
  }

  function renderYoutubeList() {
    const list = document.getElementById("youtubeVideoList");
    if (!list) return;
    list.innerHTML = "";
    if (!youtubeItems.size) {
      list.innerHTML = '<div style="color:var(--muted);font-size:.86rem;">登録した動画はありません</div>';
      return;
    }
    youtubeItems.forEach(item => {
      const song = ensureYoutubeSong(item);
      const row = document.createElement("div");
      row.className = "song" + (state.currentSong?.name === song.name ? " active" : "");
      row.dataset.name = song.name;
      row.innerHTML = `
        <div class="songMain"><div class="songName"></div><div class="songArtist"></div></div>
        <div class="songRight">
          <button class="queueBtn" type="button">＋キュー</button>
          <button class="starBtn${state.favorites.includes(song.name) ? " active" : ""}" type="button" aria-label="お気に入り">${state.favorites.includes(song.name) ? "★" : "☆"}</button>
          <div class="songMenuWrap">
            <button class="songMenuBtn" type="button" aria-label="動画の操作" aria-expanded="false">︙</button>
            <div class="songMenuPopup" hidden>
              <button class="songMenuItem addPlBtn" type="button">リスト追加</button>
              <button class="songMenuItem renameYoutubeBtn" type="button">表示名を変更</button>
              <button class="songMenuItem deleteYoutubeBtn" type="button">🗑 削除</button>
            </div>
          </div>
        </div>`;
      row.querySelector(".songName").textContent = item.title || "YouTube動画";
      const artistElement = row.querySelector(".songArtist");
      artistElement.textContent = item.customTitle
        ? "表示名: " + item.customTitle + " ・ " + (item.author || "YouTube")
        : (item.author || "YouTube");
      const sourceTag = document.createElement("span");
      sourceTag.className = "songSourceTag";
      sourceTag.textContent = getSongSourceLabel(song);
      artistElement.append(" ", sourceTag);
      const menuWrap = row.querySelector(".songMenuWrap");
      const menuBtn = row.querySelector(".songMenuBtn");
      const menu = row.querySelector(".songMenuPopup");
      menuWrap.addEventListener("click", e => e.stopPropagation());
      menuBtn.addEventListener("pointerdown", e => e.stopPropagation());
      menuBtn.addEventListener("click", e => {
        e.stopPropagation();
        document.querySelectorAll(".songMenuPopup:not([hidden])").forEach(open => {
          if (open !== menu) open.hidden = true;
        });
        menu.hidden = !menu.hidden;
        menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
      });
      const bindMenuAction = (selector, action) => {
        const button = row.querySelector(selector);
        button.addEventListener("pointerdown", e => e.stopPropagation());
        button.addEventListener("click", e => {
          e.stopPropagation();
          menu.hidden = true;
          menuBtn.setAttribute("aria-expanded", "false");
          action();
        });
      };
      bindMenuAction(".addPlBtn", () => addSongToPlaylist(song.name));
      bindMenuAction(".renameYoutubeBtn", () => renameYoutubeItem(item));
      bindMenuAction(".deleteYoutubeBtn", () => deleteYoutubeItem(item));
      row.querySelector(".queueBtn").addEventListener("pointerdown", e => e.stopPropagation());
      row.querySelector(".queueBtn").addEventListener("click", e => {
        e.stopPropagation();
        addToQueue(song.name);
      });
      row.querySelector(".starBtn").addEventListener("pointerdown", e => e.stopPropagation());
      row.querySelector(".starBtn").addEventListener("click", e => {
        e.stopPropagation();
        toggleFav(song.name);
        renderYoutubeList();
      });
      row.addEventListener("click", () => playSong(song));
      list.appendChild(row);
      setupSongNameScroll(row.querySelector(".songName"));
    });
  }

  const originalPlaySong = playSong;
  playSong = function(song, pushHistory = true, options = {}) {
    if (isYoutubeSong(song)) {
      const item = getYoutubeItemForSong(song);
      if (!item) return;
      if (!options.preservePlaylistContext) clearPlaylistContext();
      // 音楽ファイルから切り替える際、pauseイベントがYouTube曲の途中再生として記録されないようにする。
      if (isYoutubeSong(state.currentSong)) recordYoutubePartialPlayIfNeeded();
      else recordPartialPlayIfNeeded();
      hasCountedCurrentSong = false;
      if (pushHistory && (historyIndex === -1 || historyStack[historyIndex]?.name !== song.name)) {
        historyStack.splice(historyIndex + 1);
        historyStack.push(song);
        historyIndex = historyStack.length - 1;
      }
      state.currentSong = song;
      try { localStorage.setItem(STORAGE.lastSong, song.name); } catch {}
      updateNowPlayingUI(song);
      renderQueue();
      // Audio側のバックグラウンド自動復帰がpauseイベントに反応しないよう先に停止状態へ。
      setPlaybackIntent(false);
      try { audio.pause(); } catch {}
      playYoutubeItem(item);
      return;
    }

    // 保留中のYouTube API読み込み・再生要求を無効化し、古い動画が後から再生されないようにする。
    youtubeRequestSerial++;
    pendingPlayId = null;
    setPlaybackIntent(false);
    recordYoutubePartialPlayIfNeeded();
    stopYoutubePlaybackStats();
    if (youtubePlayer?.pauseVideo) {
      try { youtubePlayer.pauseVideo(); } catch {}
    }
    currentYoutubeItem = null;
    const youtubeButton = document.getElementById("youtubePlayPauseBtn");
    if (youtubeButton) youtubeButton.textContent = "▶ 再生";
    if (song) {
      const homeTab = document.querySelector('.navTab[data-target="home"]');
      if (homeTab && !homeTab.classList.contains("active")) homeTab.click();
    }
    return originalPlaySong(song, pushHistory, options);
  };

  const originalGetVisibleSongs = getVisibleSongs;
  getVisibleSongs = function() {
    return originalGetVisibleSongs().filter(song => song.mediaType !== "youtube");
  };

  const originalReloadPlaylistFromDB = reloadPlaylistFromDB;
  reloadPlaylistFromDB = async function(...args) {
    const result = await originalReloadPlaylistFromDB(...args);
    restoreYoutubeSongs();
    return result;
  };

  const originalPlayPause = playPause;
  playPause = async function() {
    // リロード直後はcurrentYoutubeItemが未設定なので、保存済みのcurrentSongから復元する。
    if (isYoutubeSong(state.currentSong)) {
      const item = getYoutubeItemForSong(state.currentSong);
      if (!item) return;
      if (!currentYoutubeItem || currentYoutubeItem.id !== item.id) {
        return playYoutubeItem(item);
      }
      if (!youtubePlayer || !window.YT?.PlayerState) return playYoutubeItem(item);
      const stateValue = youtubePlayer.getPlayerState?.();
      if (stateValue === YT.PlayerState.PLAYING) {
        youtubePlayer.pauseVideo();
        setPlaybackIntent(false);
      } else if (stateValue === YT.PlayerState.PAUSED || stateValue === YT.PlayerState.CUED) {
        youtubePlayer.playVideo();
        setPlaybackIntent(true);
      } else {
        // stopVideo後や再生終了後は、先頭から動画を読み直して再生する。
        youtubePlayer.loadVideoById(item.id);
        setPlaybackIntent(true);
      }
      updatePlayPauseUI();
      return;
    }
    return originalPlayPause();
  };

  const originalUpdatePlayPauseUI = updatePlayPauseUI;
  updatePlayPauseUI = function() {
    if (!currentYoutubeItem || !window.YT?.PlayerState) {
      originalUpdatePlayPauseUI();
      updateYoutubePlaybackControls();
      return;
    }
    let playing = false;
    try {
      playing = !!youtubePlayer && youtubePlayer.getPlayerState?.() === YT.PlayerState.PLAYING;
    } catch {}
    if (el.btnPlay) {
      el.btnPlay.textContent = playing ? "❚❚ 一時停止" : "▶ 再生";
      el.btnPlay.classList.toggle("playing", playing);
    }
    if (el.miniPlay) {
      el.miniPlay.textContent = playing ? "❚❚" : "▶";
      el.miniPlay.classList.toggle("playing", playing);
    }
    const button = document.getElementById("youtubePlayPauseBtn");
    if (button) button.textContent = playing ? "❚❚ 一時停止" : "▶ 再生";
    updateYoutubePlaybackControls();
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  };

  const originalPrevTrack = prevTrack;
  prevTrack = function() {
    if (isYoutubeSong(state.currentSong)) {
      const position = Number(youtubePlayer?.getCurrentTime?.()) || 0;
      if (position > 7 && youtubePlayer?.seekTo) {
        youtubePlayer.seekTo(0, true);
        return;
      }
      // 通常Audio側に残った古い再生位置が、YouTubeの前曲移動を妨げないようにする。
      // 元のprevTrack()はAudioの再生位置を先に判定するため、同期的に0へ戻してから委譲する。
      try { audio.currentTime = 0; } catch {}
    }
    return originalPrevTrack();
  };

  document.getElementById("btnResetYoutubeItems")?.addEventListener("click", resetAllYoutubeItems);
  document.getElementById("youtubeAddUrlBtn")?.addEventListener("click", () => addYoutubeUrl(document.getElementById("youtubeUrlInput")?.value || ""));
  document.getElementById("youtubeUrlInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addYoutubeUrl(event.currentTarget.value);
  });

  // 外部ページやアドレス欄からURLをドラッグ＆ドロップして入力できるようにする。
  const youtubeUrlInput = document.getElementById("youtubeUrlInput");
  if (youtubeUrlInput) {
    const clearYoutubeUrlDropState = () => youtubeUrlInput.classList.remove("youtubeUrlDropActive");
    youtubeUrlInput.addEventListener("dragenter", event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      youtubeUrlInput.classList.add("youtubeUrlDropActive");
    });
    youtubeUrlInput.addEventListener("dragover", event => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      youtubeUrlInput.classList.add("youtubeUrlDropActive");
    });
    youtubeUrlInput.addEventListener("dragleave", clearYoutubeUrlDropState);
    youtubeUrlInput.addEventListener("dragend", clearYoutubeUrlDropState);
    youtubeUrlInput.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      clearYoutubeUrlDropState();
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const uriList = transfer.getData("text/uri-list");
      const plainText = transfer.getData("text/plain");
      const droppedUrl = String(uriList || plainText || "")
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => line && !line.startsWith("#"));
      if (!droppedUrl) return;
      youtubeUrlInput.value = droppedUrl;
      youtubeUrlInput.focus();
    });
  }
  document.getElementById("youtubePlayPauseBtn")?.addEventListener("click", () => playPause());
  document.getElementById("youtubePrev")?.addEventListener("click", () => prevTrack());
  document.getElementById("youtubeNext")?.addEventListener("click", () => nextTrack(false));
  document.getElementById("youtubeRewind10")?.addEventListener("click", () => seekYoutubeBy(-10));
  document.getElementById("youtubeForward10")?.addEventListener("click", () => seekYoutubeBy(10));
  const youtubeProgress = document.getElementById("youtubeProgress");
  youtubeProgress?.addEventListener("pointerdown", () => { youtubeIsSlidingRange = true; });
  youtubeProgress?.addEventListener("pointerup", () => { youtubeIsSlidingRange = false; });
  youtubeProgress?.addEventListener("pointercancel", () => { youtubeIsSlidingRange = false; });
  youtubeProgress?.addEventListener("input", () => {
    const duration = Number(youtubePlayer?.getDuration?.()) || 0;
    if (duration > 0 && youtubePlayer?.seekTo && isYoutubeSong(state.currentSong)) {
      youtubePlayer.seekTo(duration * Number(youtubeProgress.value) / 100, true);
      updateYoutubePlaybackControls();
    }
  });
  document.getElementById("youtubeFavBtn")?.addEventListener("click", () => {
    if (!state.currentSong) return;
    toggleFav(state.currentSong.name);
    updateYoutubePlaybackControls();
  });
  document.getElementById("youtubeShuffleBtn")?.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    resetHomeCycle();
    saveState();
    el.btnMainShuffle?.classList.toggle("active", state.shuffle);
    updateYoutubePlaybackControls();
    renderQueue();
    toast("シャッフル: " + (state.shuffle ? "ON" : "OFF"));
  });
  document.getElementById("youtubeRepeatBtn")?.addEventListener("click", () => {
    state.repeat = !state.repeat;
    saveState();
    el.btnMainRepeat?.classList.toggle("active", state.repeat);
    updateYoutubePlaybackControls();
    toast("リピート: " + (state.repeat ? "ON" : "OFF"));
  });
  document.getElementById("youtubeAddPlaylistBtn")?.addEventListener("click", () => {
    if (isYoutubeSong(state.currentSong)) addSongToPlaylist(state.currentSong.name);
  });
  document.getElementById("btnAddToPlaylist")?.addEventListener("click", () => {
    if (!state.currentSong) { toast("先に曲を再生してください"); return; }
    addSongToPlaylist(state.currentSong.name);
  });

  initializeYoutubeSearch();
  restoreYoutubeSongs();
  updateYoutubePlaybackControls();
})();
