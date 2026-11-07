// YouTube連携 v1
// 公式IFrame Player APIを利用し、音声抽出や非公式ストリーム取得は行わない。
(() => {
  const YT_STORAGE_KEY = "mp_youtube_v1";
  const YT_LIBRARY_STORAGE_KEY = "mp_youtube_library_v1";
  const YT_API_KEY_STORAGE = "mp_youtube_api_key_v1";
  function readYoutubeLibraryItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(YT_LIBRARY_STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter(x => x && /^[\\w-]{11}$/.test(x.id)) : [];
    } catch { return []; }
  }
  const youtubeLibraryItems = new Map(readYoutubeLibraryItems().map(item => [item.id, item]));
  const youtubeItems = new Map();
  let youtubePlayer = null;
  let youtubePlayerReady = false;
  let youtubeApiPromise = null;
  let currentYoutubeItem = null;
  let pendingPlayId = null;

  function readYoutubeItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(YT_STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter(x => x && /^[\w-]{11}$/.test(x.id)) : [];
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
      song = { name, title: item.title || "YouTube動画", artist: item.author || "YouTube", duration: null, mediaType: "youtube", youtubeId: item.id, url: "" };
      state.playlist.push(song);
    } else {
      song.title = item.title || song.title;
      song.artist = item.author || "YouTube";
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
      youtubeLibraryItems.set(item.id, { ...item });
      ensureYoutubeSong(item);
      if (!item.author || !item.title || item.title === "YouTube動画 " + item.id || item.title === "動画情報を取得中...") fetchYoutubeVideoTitle(item);
    });
    // 登録解除後も、プレイリストに残したYouTube曲を再生できるよう情報を復元する。
    youtubeLibraryItems.forEach(item => ensureYoutubeSong(item));
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
    return youtubeItems.get(id) || youtubeLibraryItems.get(id) || { id, title: song.title || "YouTube動画" };
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
                event.target.loadVideoById(active.id);
                pendingPlayId = null;
              }
            },
            onStateChange: event => {
              if (event.data === YT.PlayerState.PLAYING && currentYoutubeItem && isYoutubeSong(state.currentSong)) {
                // YouTube再生も既存の再生回数・再生時間統計へ反映する。
                setPlaybackIntent(true);
                if (!hasCountedCurrentSong) recordPlayCount();
                startYoutubePlaybackStats();
              } else {
                stopYoutubePlaybackStats();
              }
              if (event.data === YT.PlayerState.ENDED && currentYoutubeItem && isYoutubeSong(state.currentSong)) {
                stopYoutubePlaybackStats();
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
      if (status) status.textContent = error.message || "YouTubeプレイヤーを読み込めませんでした。";
      setPlaybackIntent(false);
      updatePlayPauseUI();
    }
  }

  async function fetchYoutubeVideoTitle(item) {
    if (!item?.id || youtubeItems.get(item.id) !== item) return;
    const fallbackTitle = "YouTube動画 " + item.id;
    const isPlaceholder = () => item.title === fallbackTitle || item.title === "動画情報を取得中...";
    try {
      const url = "https://www.youtube.com/watch?v=" + encodeURIComponent(item.id);
      const response = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(url) + "&format=json");
      if (!response.ok) throw new Error("動画情報を取得できませんでした");
      const data = await response.json();
      const title = String(data.title || "").trim();
      const author = String(data.author_name || "").trim();
      let changed = false;
      // 手動で変更した動画名は保持し、未取得の作者名だけを補完する。
      if (title && isPlaceholder()) { item.title = title; changed = true; }
      if (author && item.author !== author) { item.author = author; changed = true; }
      if (!changed || youtubeItems.get(item.id) !== item) return;
      youtubeItems.set(item.id, item);
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

  function getYoutubeApiKey() {
    try { return localStorage.getItem(YT_API_KEY_STORAGE) || ""; } catch { return ""; }
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
      const item = { id, title: String(snippet.title || "YouTube動画"), author: String(snippet.channelTitle || "YouTube"), addedAt: Date.now() };
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

  async function searchYoutubeVideos() {
    const query = String(document.getElementById("youtubeSearchInput")?.value || "").trim();
    const apiKey = getYoutubeApiKey();
    const results = document.getElementById("youtubeSearchResults");
    if (!query) { setYoutubeSearchStatus("検索キーワードを入力してください。"); return; }
    if (!apiKey) { setYoutubeSearchStatus("先に「検索APIの設定」からAPIキーを保存してください。"); return; }
    const button = document.getElementById("youtubeSearchBtn");
    if (button) button.disabled = true;
    if (results) results.textContent = "検索しています...";
    setYoutubeSearchStatus("YouTubeを検索しています...");
    try {
      const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: "10", q: query, key: apiKey });
      const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString());
      const data = await response.json();
      if (!response.ok) {
        const reason = data.error?.errors?.[0]?.reason || "";
        if (response.status === 403 && reason === "quotaExceeded") throw new Error("YouTube APIの検索上限に達しました。時間をおいて再度お試しください。");
        if (response.status === 403) throw new Error("APIキーまたはYouTube Data API v3の設定を確認してください。");
        throw new Error(data.error?.message || "検索に失敗しました。");
      }
      renderYoutubeSearchResults(Array.isArray(data.items) ? data.items : []);
      setYoutubeSearchStatus((data.items?.length || 0) + "件の検索結果");
    } catch (error) {
      if (results) results.textContent = "";
      setYoutubeSearchStatus(error.message || "検索に失敗しました。");
    } finally { if (button) button.disabled = false; }
  }

  function initializeYoutubeSearch() {
    const keyInput = document.getElementById("youtubeApiKeyInput");
    if (keyInput) keyInput.value = getYoutubeApiKey();
    document.getElementById("youtubeSaveApiKeyBtn")?.addEventListener("click", () => {
      const value = String(keyInput?.value || "").trim();
      if (!value) { setYoutubeSearchStatus("APIキーを入力してください。"); return; }
      try { localStorage.setItem(YT_API_KEY_STORAGE, value); } catch { setYoutubeSearchStatus("APIキーを保存できませんでした。"); return; }
      setYoutubeSearchStatus("APIキーを保存しました。キーワードを検索できます。");
    });
    document.getElementById("youtubeClearApiKeyBtn")?.addEventListener("click", () => {
      try { localStorage.removeItem(YT_API_KEY_STORAGE); } catch {}
      if (keyInput) keyInput.value = "";
      setYoutubeSearchStatus("保存したAPIキーを削除しました。");
    });
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
      "YouTube動画の名前を変更",
      "新しい動画名を入力してください。",
      item.title || "YouTube動画",
      value => {
        const title = String(value || "").trim();
        if (!title || title === item.title) return;
        item.title = title;
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
              <button class="songMenuItem renameYoutubeBtn" type="button">名前変更</button>
              <button class="songMenuItem deleteYoutubeBtn" type="button">🗑 削除</button>
            </div>
          </div>
        </div>`;
      row.querySelector(".songName").textContent = item.title || "YouTube動画";
      row.querySelector(".songArtist").textContent = item.author || "YouTube";
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
    if (!currentYoutubeItem || !window.YT?.PlayerState) return originalUpdatePlayPauseUI();
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
  document.getElementById("youtubePlayPauseBtn")?.addEventListener("click", () => playPause());
  document.getElementById("youtubeStopBtn")?.addEventListener("click", () => {
    if (!isYoutubeSong(state.currentSong)) return;
    // API読み込み中の停止も有効にし、停止後に遅れて再生が始まらないようにする。
    youtubeRequestSerial++;
    pendingPlayId = null;
    stopYoutubePlaybackStats();
    try { youtubePlayer?.stopVideo(); } catch {}
    setPlaybackIntent(false);
    updatePlayPauseUI();
  });
  document.getElementById("youtubeAddPlaylistBtn")?.addEventListener("click", () => {
    if (currentYoutubeItem) addSongToPlaylist("yt:" + currentYoutubeItem.id);
  });

  initializeYoutubeSearch();
  restoreYoutubeSongs();
})();
