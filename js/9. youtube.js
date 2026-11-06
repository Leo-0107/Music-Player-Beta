// YouTube連携 v1
// 公式IFrame Player APIを利用し、音声抽出や非公式ストリーム取得は行わない。
(() => {
  const YT_STORAGE_KEY = "mp_youtube_v1";
  const youtubeItems = new Map();
  let youtubePlayer = null;
  let youtubeApiPromise = null;
  let currentYoutubeItem = null;
  let pendingPlayId = null;

  function readYoutubeItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(YT_STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter(x => x && /^[\w-]{11}$/.test(x.id)) : [];
    } catch { return []; }
  }

  function saveYoutubeItems() {
    try { localStorage.setItem(YT_STORAGE_KEY, JSON.stringify(Array.from(youtubeItems.values()))); }
    catch { toast("YouTube動画を保存できませんでした"); }
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
      song = { name, title: item.title || "YouTube動画", artist: "YouTube", duration: null, mediaType: "youtube", youtubeId: item.id, url: "" };
      state.playlist.push(song);
    } else {
      song.title = item.title || song.title;
      song.artist = "YouTube";
      song.mediaType = "youtube";
      song.youtubeId = item.id;
      song.url = "";
    }
    return song;
  }

  function restoreYoutubeSongs() {
    youtubeItems.clear();
    readYoutubeItems().forEach(item => {
      youtubeItems.set(item.id, item);
      ensureYoutubeSong(item);
    });
    renderYoutubeList();
  }

  let youtubeRequestSerial = 0;

  function isYoutubeSong(song) {
    return !!song && (song.mediaType === "youtube" || String(song.name || "").startsWith("yt:"));
  }

  function getYoutubeItemForSong(song) {
    if (!isYoutubeSong(song)) return null;
    const id = song.youtubeId || String(song.name).slice(3);
    return youtubeItems.get(id) || { id, title: song.title || "YouTube動画" };
  }

  function loadYoutubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (youtubeApiPromise) return youtubeApiPromise;
    youtubeApiPromise = new Promise((resolve, reject) => {
      let settled = false;
      const previous = window.onYouTubeIframeAPIReady;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) {
          youtubeApiPromise = null;
          reject(error);
        } else {
          resolve();
        }
      };
      const timeout = setTimeout(() => finish(new Error("YouTube APIの読み込みがタイムアウトしました")), 15000);
      window.onYouTubeIframeAPIReady = () => {
        try { previous?.(); } catch {}
        finish();
      };
      let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
      script.onerror = () => finish(new Error("YouTube APIの読み込みに失敗しました"));
    });
    return youtubeApiPromise;
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
    updatePlayPauseUI();
    setPlaybackIntent(true);
    try {
      await loadYoutubeApi();
      if (requestId !== youtubeRequestSerial || !currentYoutubeItem || currentYoutubeItem.id !== item.id) return;
      const mount = document.getElementById("youtubePlayer");
      if (!mount) throw new Error("YouTubeプレイヤー領域が見つかりません");
      if (!youtubePlayer) {
        youtubePlayer = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          videoId: item.id,
          playerVars: { playsinline: 1, rel: 0 },
          events: {
            onReady: event => {
              const active = currentYoutubeItem;
              if (active && isYoutubeSong(state.currentSong)) {
                pendingPlayId = active.id;
                event.target.loadVideoById(active.id);
              }
            },
            onStateChange: event => {
              if (event.data === YT.PlayerState.ENDED && currentYoutubeItem && isYoutubeSong(state.currentSong)) {
                setPlaybackIntent(false);
                nextTrack(true);
              }
              const button = document.getElementById("youtubePlayPauseBtn");
              if (button && currentYoutubeItem) button.textContent = event.data === YT.PlayerState.PLAYING ? "❚❚ 一時停止" : "▶ 再生";
              updatePlayPauseUI();
            },
            onError: () => {
              if (status) status.textContent = "この動画は再生できないか、埋め込みが許可されていません。";
              setPlaybackIntent(false);
              updatePlayPauseUI();
            }
          }
        });
      } else {
        youtubePlayer.loadVideoById(item.id);
      }
      if (status) status.textContent = "YouTube公式プレイヤーで再生します。";
    } catch (error) {
      if (requestId !== youtubeRequestSerial) return;
      if (status) status.textContent = error.message || "YouTubeプレイヤーを読み込めませんでした。";
      setPlaybackIntent(false);
      updatePlayPauseUI();
    }
  }

  function addYoutubeUrl(value) {
    const id = parseYoutubeId(value);
    if (!id) return toast("YouTubeの動画URLを確認してください");
    let item = youtubeItems.get(id);
    if (!item) {
      item = { id, title: "YouTube動画 " + id, addedAt: Date.now() };
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
      const row = document.createElement("div");
      row.className = "song";
      row.innerHTML = '<div class="songMain"><div class="songName"></div><div class="songArtist">YouTube</div></div><div class="songRight"><button class="btn small" type="button">▶ 再生</button><button class="btn small ghost" type="button">リスト追加</button></div>';
      row.querySelector(".songName").textContent = item.title || "YouTube動画";
      const buttons = row.querySelectorAll("button");
      buttons[0].addEventListener("click", () => playSong(ensureYoutubeSong(item)));
      buttons[1].addEventListener("click", () => {
        const song = ensureYoutubeSong(item);
        addSongToPlaylist(song.name);
      });
      list.appendChild(row);
    });
  }

  const originalPlaySong = playSong;
  playSong = function(song, pushHistory = true, options = {}) {
    if (isYoutubeSong(song)) {
      const item = getYoutubeItemForSong(song);
      if (!item) return;
      if (!options.preservePlaylistContext) clearPlaylistContext();
      if (pushHistory && (historyIndex === -1 || historyStack[historyIndex]?.name !== song.name)) {
        historyStack.splice(historyIndex + 1);
        historyStack.push(song);
        historyIndex = historyStack.length - 1;
      }
      state.currentSong = song;
      try { localStorage.setItem(STORAGE.lastSong, song.name); } catch {}
      updateNowPlayingUI(song);
      renderQueue();
      try { audio.pause(); } catch {}
      playYoutubeItem(item);
      return;
    }

    // 保留中のYouTube API読み込み・再生要求を無効化し、古い動画が後から再生されないようにする。
    youtubeRequestSerial++;
    pendingPlayId = null;
    if (youtubePlayer?.pauseVideo) {
      try { youtubePlayer.pauseVideo(); } catch {}
    }
    currentYoutubeItem = null;
    const youtubeButton = document.getElementById("youtubePlayPauseBtn");
    if (youtubeButton) youtubeButton.textContent = "▶ 再生";
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
    if (currentYoutubeItem) {
      if (!youtubePlayer) return playYoutubeItem(currentYoutubeItem);
      const stateValue = youtubePlayer.getPlayerState?.();
      if (stateValue === YT.PlayerState.PLAYING) {
        youtubePlayer.pauseVideo();
        setPlaybackIntent(false);
      } else {
        youtubePlayer.playVideo();
        setPlaybackIntent(true);
      }
      const button = document.getElementById("youtubePlayPauseBtn");
      if (button) button.textContent = stateValue === YT.PlayerState.PLAYING ? "▶ 再生" : "❚❚ 一時停止";
      updatePlayPauseUI();
      return;
    }
    return originalPlayPause();
  };

  const originalUpdatePlayPauseUI = updatePlayPauseUI;
  updatePlayPauseUI = function() {
    if (!currentYoutubeItem) return originalUpdatePlayPauseUI();
    const playing = !!youtubePlayer && youtubePlayer.getPlayerState?.() === YT.PlayerState.PLAYING;
    if (el.btnPlay) {
      el.btnPlay.textContent = playing ? "❚❚ 一時停止" : "▶ 再生";
      el.btnPlay.classList.toggle("playing", playing);
    }
    if (el.miniPlay) {
      el.miniPlay.textContent = playing ? "❚❚" : "▶";
      el.miniPlay.classList.toggle("playing", playing);
    }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  };

  const originalPrevTrack = prevTrack;
  prevTrack = function() {
    if (currentYoutubeItem) {
      try { audio.currentTime = 0; } catch {}
    }
    return originalPrevTrack();
  };

  document.getElementById("youtubeAddUrlBtn")?.addEventListener("click", () => addYoutubeUrl(document.getElementById("youtubeUrlInput")?.value || ""));
  document.getElementById("youtubeUrlInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addYoutubeUrl(event.currentTarget.value);
  });
  document.getElementById("youtubePlayPauseBtn")?.addEventListener("click", () => playPause());
  document.getElementById("youtubeStopBtn")?.addEventListener("click", () => {
    try { youtubePlayer?.stopVideo(); } catch {}
    setPlaybackIntent(false);
  });
  document.getElementById("youtubeAddPlaylistBtn")?.addEventListener("click", () => {
    if (currentYoutubeItem) addSongToPlaylist("yt:" + currentYoutubeItem.id);
  });

  restoreYoutubeSongs();
})();
