  async function loadFiles(fileList){
    const files = Array.from(fileList || []);
    if(!files.length) return;

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
      } catch (e) {
        toast("Zipファイルの解析エラーが発生しました");
      }
    }

    for (const f of directAudioFiles) {
      const meta = await parseID3(f);
      const storageName = f.webkitRelativePath || f.name;
      saveTrackToDB({
        name: storageName,
        title: meta.title,
        artist: meta.artist,
        blob: f,
        coverBlob: meta.coverBlob
      });
    }

    saveState();
    await reloadPlaylistFromDB();
    toast(`読み込み完了！`);
  }

  const folderDirectoryInput = document.getElementById("folderDirectory");
  const btnAddMusic = document.getElementById("btnAddMusic");

  function showAddSourcePicker() {
    const existing = document.getElementById("sourcePickerModal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "sourcePickerModal";
    modal.className = "sourcePickerModal";
    modal.innerHTML = `
      <div class="sourcePickerCard" role="dialog" aria-modal="true" aria-labelledby="sourcePickerTitle">
        <div class="sectionTitle" id="sourcePickerTitle">追加方法を選択</div>
        <div class="sourcePickerMessage">読み込みたいものを選んでください。</div>
        <div class="sourcePickerActions">
          <button type="button" class="btn small" data-source-file>🎵 音楽ファイル / ZIP</button>
          <button type="button" class="btn small" data-source-folder>📁 フォルダ</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const close = () => modal.remove();

    modal.querySelector("[data-source-file]").addEventListener("click", () => {
      close();
      if (el.folder) el.folder.click();
    });
    modal.querySelector("[data-source-folder]").addEventListener("click", () => {
      close();
      if (folderDirectoryInput) folderDirectoryInput.click();
    });
    modal.addEventListener("click", e => {
      if (e.target === modal) close();
    });
  }

  if (btnAddMusic) {
    btnAddMusic.addEventListener("click", showAddSourcePicker);
  }

  if (el.folder) {
    el.folder.addEventListener("change", e => {
      loadFiles(e.target.files);
      el.folder.value = "";
    });
  }

  if (folderDirectoryInput) {
    folderDirectoryInput.addEventListener("change", e => {
      loadFiles(e.target.files);
      folderDirectoryInput.value = "";
    });
  }

  // --- アクティブURLの保護型リロード ---
  async function reloadPlaylistFromDB() {
    cleanUpObjectURLs();
    const tracks = await loadTracksFromDB();
    const loadedSongs = tracks.map(t => {
      let songUrls = activeObjectURLMap.get(t.name);
      if (!songUrls) {
        const url = URL.createObjectURL(t.blob);
        let coverUrl = null;
        if (t.coverBlob) {
          coverUrl = URL.createObjectURL(t.coverBlob);
        }
        songUrls = { url, coverUrl };
        activeObjectURLMap.set(t.name, songUrls);
      }
      return {
        name: t.name,
        title: t.title || t.name,
        artist: t.artist || "不明なアーティスト",
        url: songUrls.url,
        coverUrl: songUrls.coverUrl
      };
    });

    const savedOrder = Array.isArray(state.playlistOrder) ? state.playlistOrder : [];
    const orderMap = new Map(savedOrder.map((name, index) => [name, index]));
    loadedSongs.sort((a, b) => {
      const ai = orderMap.has(a.name) ? orderMap.get(a.name) : Number.MAX_SAFE_INTEGER;
      const bi = orderMap.has(b.name) ? orderMap.get(b.name) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.title.localeCompare(b.title, "ja", {numeric:true});
    });
    state.playlist = loadedSongs;
    state.playlistOrder = loadedSongs.map(s => s.name);
    saveState();
    renderAll();
  }

  async function deleteSingleTrack(song) {
    if(!song) return;
    showInSiteConfirm(`「${song.title}」を削除しますか？`, "この曲を保存データから削除します。プレイリストからも外れます。", async () => {

    const urls = activeObjectURLMap.get(song.name);
    if (urls) {
      if (urls.url) URL.revokeObjectURL(urls.url);
      if (urls.coverUrl) URL.revokeObjectURL(urls.coverUrl);
      activeObjectURLMap.delete(song.name);
    }

    await deleteTrackFromDB(song.name);
    
    if (state.currentSong?.name === song.name) {
      audio.pause();
      audio.src = "";
      state.currentSong = null;
      try {
        localStorage.removeItem(STORAGE.lastSong);
      } catch (e) {}
      updateArtwork(null);
      updateTitleTextAndScroll(el.nowTitle, "未再生");
      updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
      updateTitleTextAndScroll(el.miniTitle, "停止中");
    }

    state.queue = state.queue.filter(q => q !== song.name);
    state.favorites = state.favorites.filter(f => f !== song.name);
    Object.keys(state.playlists).forEach(name => {
      state.playlists[name] = (state.playlists[name] || []).filter(trackName => trackName !== song.name);
    });
    
    await reloadPlaylistFromDB();
    toast("曲を削除しました");
    });
  }

  let playbackMemorySaveTimer = null;

  function savePlaybackMemory(force = false) {
    if (force && playbackMemorySaveTimer) { clearTimeout(playbackMemorySaveTimer); playbackMemorySaveTimer = null; }
    const write = () => {
      try {
        localStorage.setItem(STORAGE.lastSong, state.currentSong?.name || "");
      } catch (e) {}
    };
    if (force) { write(); return; }
    if (playbackMemorySaveTimer) return;
    playbackMemorySaveTimer = setTimeout(() => {
      playbackMemorySaveTimer = null;
      write();
    }, 700);
  }

  function restoreLastPlaybackMemory() {
    const songName = loadStr(STORAGE.lastSong, "");
    if (!songName) return;
    const song = state.playlist.find(item => item.name === songName);
    if (!song) return;
    state.currentSong = song;
    audio.src = song.url;
    updateArtwork(song);
    updateNowPlayingUI(song);
    if (el.progress && audio.duration) el.progress.value = 0;
    if (el.miniProgress && audio.duration) el.miniProgress.value = 0;
    if (el.timeNow) el.timeNow.textContent = fmtTime(0);
    if (el.timeAll && audio.duration) el.timeAll.textContent = fmtTime(audio.duration);
  }

  audio.addEventListener("timeupdate", () => savePlaybackMemory(false));
  audio.addEventListener("pause", () => savePlaybackMemory(true));
  audio.addEventListener("ended", () => savePlaybackMemory(true));
  window.addEventListener("pagehide", () => savePlaybackMemory(true));
  window.addEventListener("beforeunload", () => savePlaybackMemory(true));

  function getPlaylistNames(pName) {
    const raw = Array.isArray(state.playlists[pName]) ? state.playlists[pName] : [];
    const available = new Set(state.playlist.map(song => song.name));
    const unique = [];
    const seen = new Set();
    raw.forEach(name => {
      if (!seen.has(name) && available.has(name)) {
        seen.add(name);
        unique.push(name);
      }
    });
    return unique;
  }

  function getPlaylistSettings(pName) {
    if (!state.playlistSettings[pName] || typeof state.playlistSettings[pName] !== "object") {
      state.playlistSettings[pName] = { shuffle: false, repeat: false };
    }
    return state.playlistSettings[pName];
  }

  function clearPlaylistContext() {
    state.activePlaylistName = null;
    state.playlistCycleOrder = [];
    state.playlistCycleIndex = -1;
    state.playlistCycleSeen = [];
  }

  function shuffleNames(names) {
    const copy = names.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function activatePlaylistContext(pName, startName = null) {
    const names = getPlaylistNames(pName);
    if (!names.length) {
      clearPlaylistContext();
      return false;
    }
    const settings = getPlaylistSettings(pName);
    let order = settings.shuffle ? shuffleNames(names) : names.slice();
    if (startName && order.includes(startName)) {
      const startIndex = order.indexOf(startName);
      order = order.slice(startIndex).concat(order.slice(0, startIndex));
    }
    state.activePlaylistName = pName;
    state.playlistCycleOrder = order;
    state.playlistCycleIndex = startName && order.includes(startName) ? 0 : -1;
    state.playlistCycleSeen = startName ? [startName] : [];
    saveState();
    return true;
  }

  function playSongFromPlaylist(song, pName, pushHistory = true) {
    if (!song || !state.playlists[pName]) return;
    activatePlaylistContext(pName, song.name);
    playSong(song, pushHistory, { preservePlaylistContext: true });
    closePlaylistTrackSheet();
  }

  function getNextPlaylistSong() {
    const pName = state.activePlaylistName;
    if (!pName) return null;
    const names = getPlaylistNames(pName);
    if (!names.length) return null;
    const settings = getPlaylistSettings(pName);

    if (!Array.isArray(state.playlistCycleOrder) ||
        state.playlistCycleOrder.length < names.length ||
        !names.every(name => state.playlistCycleOrder.includes(name)) ||
        new Set(state.playlistCycleOrder).size !== state.playlistCycleOrder.length) {
      activatePlaylistContext(pName, state.currentSong?.name || names[0]);
    }

    let nextIndex = state.playlistCycleIndex + 1;
    if (nextIndex >= state.playlistCycleOrder.length) {
      if (!settings.repeat) return null;
      const current = state.currentSong?.name || null;
      let order = settings.shuffle ? shuffleNames(names) : names.slice();
      if (order.length > 1 && current && order[0] === current) {
        [order[0], order[1]] = [order[1], order[0]];
      }
      state.playlistCycleOrder = order;
      state.playlistCycleIndex = 0;
      state.playlistCycleSeen = [order[0]];
      return state.playlist.find(song => song.name === order[0]) || null;
    }

    state.playlistCycleIndex = nextIndex;
    const nextName = state.playlistCycleOrder[nextIndex];
    if (nextName) state.playlistCycleSeen.push(nextName);
    return state.playlist.find(song => song.name === nextName) || null;
  }

  function resetHomeCycle() {
    homeCycleOrder = [];
    homeCycleIndex = -1;
    homeCycleSourceKey = "";
  }

  function ensureHomeCycle() {
    const visible = getVisibleSongs();
    const names = visible.map(song => song.name);
    const sourceKey = `${state.shuffle ? "shuffle" : "order"}|${names.join("\u0001")}`;
    const valid = homeCycleOrder.length >= names.length &&
      names.every(name => homeCycleOrder.includes(name)) &&
      new Set(homeCycleOrder).size === homeCycleOrder.length;
    const currentName = state.currentSong?.name || null;

    if (sourceKey !== homeCycleSourceKey || !valid) {
      homeCycleOrder = state.shuffle ? shuffleNames(names) : names.slice();
      homeCycleSourceKey = sourceKey;
      homeCycleIndex = currentName ? homeCycleOrder.indexOf(currentName) : -1;
      if (homeCycleIndex < 0 && homeCycleOrder.length) homeCycleIndex = -1;
      return;
    }

    if (currentName) {
      const currentIndex = homeCycleOrder.indexOf(currentName);
      if (currentIndex >= 0 && currentIndex !== homeCycleIndex) homeCycleIndex = currentIndex;
    }
  }

  function getNextHomeSong() {
    ensureHomeCycle();
    if (!homeCycleOrder.length) return null;
    let nextIndex = homeCycleIndex + 1;
    if (nextIndex >= homeCycleOrder.length) {
      homeCycleOrder = state.shuffle ? shuffleNames(homeCycleOrder) : homeCycleOrder.slice();
      const currentName = state.currentSong?.name || null;
      if (homeCycleOrder.length > 1 && currentName && homeCycleOrder[0] === currentName) {
        [homeCycleOrder[0], homeCycleOrder[1]] = [homeCycleOrder[1], homeCycleOrder[0]];
      }
      homeCycleIndex = 0;
    } else {
      homeCycleIndex = nextIndex;
    }
    const nextName = homeCycleOrder[homeCycleIndex];
    return state.playlist.find(song => song.name === nextName) || null;
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

  function playSong(song, pushHistory = true, options = {}){
    if(!song) return;
    if (!options.preservePlaylistContext) clearPlaylistContext();
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
    silenceTimer = 0;
    try {
      localStorage.setItem(STORAGE.lastSong, song.name);
    } catch (e) {}
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
    renderQueue();
    resumeAudioCtx();
    audio.play().then(() => {
      requestWakeLock();
      lastFrameTime = performance.now();
      startWaveAnimation();
    }).catch(()=>{});
  }

  // --- DOMのピンポイント更新 ---
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

  function updatePlayPauseUI(){
    const isPlaying = !audio.paused && audio.src;
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

  function playPause(){
    if(!state.currentSong && state.playlist.length) return playSong(getVisibleSongs()[0]);
    if(audio.paused) {
      ensureGraph();
      audio.play().then(() => {
        requestWakeLock();
        lastFrameTime = performance.now();
        startWaveAnimation();
      }).catch(()=>{});
    } else {
      audio.pause();
      releaseWakeLock();
    }
    updatePlayPauseUI();
  }

  function prevTrack(){
    if (state.activePlaylistName) {
      const order = state.playlistCycleOrder || [];
      let idx = state.playlistCycleIndex - 1;
      if (idx < 0) {
        if (!getPlaylistSettings(state.activePlaylistName).repeat) return;
        idx = order.length - 1;
      }
      const name = order[idx];
      const song = state.playlist.find(s => s.name === name);
      if (song) {
        state.playlistCycleIndex = idx;
        playSong(song, false, { preservePlaylistContext: true });
      }
      return;
    }

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

  function nextTrack(isAuto = false){
    if (state.activePlaylistName) {
      if (state.queue.length) {
        const name = state.queue.shift();
        saveState();
        renderQueue();
        const s = state.playlist.find(x => x.name === name);
        if (s) return playSong(s, true, { preservePlaylistContext: true });
      }
      const next = getNextPlaylistSong();
      if (next) {
        saveState();
        renderQueue();
        return playSong(next, true, { preservePlaylistContext: true });
      }
      clearPlaylistContext();
      audio.pause();
      updatePlayPauseUI();
      renderQueue();
      return;
    }

    if(!isAuto && historyIndex < historyStack.length - 1) {
      historyIndex++;
      playSong(historyStack[historyIndex], false);
      return;
    }

    if (isAuto && historyIndex < historyStack.length - 1) {
      historyStack.splice(historyIndex + 1);
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
    const next = getNextHomeSong();
    if (next) return playSong(next);
  }

  function updateVolumeUI(targetVal, isMuteAction = false) {
    const prevVol = currentVolumeTarget;
    currentVolumeTarget = Math.max(0, Math.min(2, snapToDefault(targetVal, 1, 0.07)));
    if (el.volume) el.volume.value = currentVolumeTarget;
    if (el.volText) el.volText.textContent = `${Math.round(currentVolumeTarget * 100)}%`;
    if (el.btnMuteToggle) el.btnMuteToggle.textContent = currentVolumeTarget === 0 ? "🔇" : currentVolumeTarget < 0.5 ? "🔉" : "🔊";

    audio.volume = Math.min(1.0, Math.max(0.0, currentVolumeTarget));

    if(masterGain && audioCtx) {
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);

      if (currentVolumeTarget > prevVol) {
        masterGain.gain.setTargetAtTime(currentVolumeTarget, now, 0.35);
      } else {
        masterGain.gain.setTargetAtTime(currentVolumeTarget, now, isMuteAction ? 0.02 : 0.05);
      }
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

  function showPlAlertModal() { if (el.plAlertModal) el.plAlertModal.classList.add("show"); }
  function hidePlAlertModal() { if (el.plAlertModal) el.plAlertModal.classList.remove("show"); }
  if (el.btnClosePlModal) el.btnClosePlModal.addEventListener("click", hidePlAlertModal);
  if (el.plAlertModal) el.plAlertModal.addEventListener("click", e => { if(e.target === el.plAlertModal) hidePlAlertModal(); });

  function showShortcutModal() { if (el.shortcutModal) el.shortcutModal.classList.add("show"); }
  function hideShortcutModal() { if (el.shortcutModal) el.shortcutModal.classList.remove("show"); }
  if (el.btnShortcutHelp) el.btnShortcutHelp.addEventListener("click", showShortcutModal);
  if (el.btnCloseShortcutModal) el.btnCloseShortcutModal.addEventListener("click", hideShortcutModal);
  if (el.shortcutModal) el.shortcutModal.addEventListener("click", e => { if(e.target === el.shortcutModal) hideShortcutModal(); });

  function createPlaylist() {
    if (!el.newPlName) return;
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

  function setupPlNameScroll(element) {
    if (!element) return;

    element.classList.remove("scrolling");
    element.style.removeProperty("--pl-scroll-dist");
    element.style.removeProperty("--pl-scroll-duration");

    requestAnimationFrame(() => {
      const container = element.parentElement;
      if (!container) return;
      const overflow = element.scrollWidth - container.clientWidth;
      if (overflow > 4) {
        element.style.setProperty("--pl-scroll-dist", `-${overflow + 14}px`);
        element.style.setProperty("--pl-scroll-duration", `${Math.max(6, Math.min(18, overflow / 15 + 5))}s`);
        element.classList.add("scrolling");
      }
    });
  }

  const LONG_PRESS_MS = 520;
  let suppressNextSongClick = false;

  function reorderPlaylistCards(names) {
    const next = {};
    names.forEach(name => {
      if (Object.prototype.hasOwnProperty.call(state.playlists, name)) next[name] = state.playlists[name];
    });
    Object.keys(state.playlists).forEach(name => {
      if (!Object.prototype.hasOwnProperty.call(next, name)) next[name] = state.playlists[name];
    });
    state.playlists = next;
    saveState();
  }

  function reorderPlaylistTracks(pName, names) {
    if (!state.playlists[pName]) return;
    state.playlists[pName] = names.slice();
    saveState();
  }

  function reorderSongsByVisibleOrder(names) {
    const visibleSet = new Set(names);
    const ordered = [];
    let nameIndex = 0;
    state.playlist.forEach(song => {
      if (visibleSet.has(song.name)) {
        const replacement = state.playlist.find(s => s.name === names[nameIndex]);
        ordered.push(replacement || song);
        nameIndex++;
      } else {
        ordered.push(song);
      }
    });
    state.playlist = ordered;
    state.playlistOrder = ordered.map(s => s.name);
    saveState();
  }

  function attachLongPressReorder(row, container, selector, getKey, onDropOrder) {
    if (!row || !container) return;
    let timer = null;
    let dragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    const ignoreSelector = 'button, input, textarea, select, a, .noReorder';

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    row.addEventListener("contextmenu", e => { e.preventDefault(); });

    row.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest(ignoreSelector)) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      timer = setTimeout(() => {
        dragging = true;
        suppressNextSongClick = true;
        row._suppressClick = true;
        row.classList.add("longPressDragging");
        document.body.classList.add("reorder-dragging");
        try { row.setPointerCapture(pointerId); } catch {}
      }, LONG_PRESS_MS);
    });

    row.addEventListener("pointermove", e => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) clearTimer();
        return;
      }
      e.preventDefault();
      const rows = Array.from(container.querySelectorAll(selector)).filter(item => item !== row);
      if (!rows.length) return;

      let insertBefore = null;
      let nearestDistance = Infinity;
      for (const candidate of rows) {
        const rect = candidate.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const distance = Math.abs(e.clientY - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          insertBefore = e.clientY < center ? candidate : candidate.nextElementSibling;
        }
      }

      if (insertBefore === row) insertBefore = row.nextElementSibling;
      if (insertBefore) container.insertBefore(row, insertBefore);
      else container.appendChild(row);
    });

    const finish = e => {
      clearTimer();
      if (!dragging) return;
      dragging = false;
      try { row.releasePointerCapture(pointerId); } catch {}
      row.classList.remove("longPressDragging");
      document.body.classList.remove("reorder-dragging");
      const orderedKeys = Array.from(container.querySelectorAll(selector)).map(getKey).filter(Boolean);
      onDropOrder(orderedKeys);
      setTimeout(() => {
        row._suppressClick = false;
        suppressNextSongClick = false;
      }, 120);
      renderPlaylistsAfterReorder(container, selector);
    };

    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
    row.addEventListener("lostpointercapture", () => {
      if (dragging) finish(new Event("pointerup"));
    });
    row._isLongPressReorderBound = true;
  }

  function renderPlaylistsAfterReorder(container, selector) {
    if (selector === ".plCard") {
      renderPlaylists();
    } else if (selector === ".plTrackItem") {
      if (openPlaylistTrackSheetName) renderPlaylistTrackSheet(openPlaylistTrackSheetName);
    } else if (selector === ".song") {
      renderSongList();
    }
  }

  let openPlaylistTrackSheetName = null;

  function syncSheetScrollLock() {
    const locked = !!el.playlistTrackSheet?.classList.contains("show") || !!el.plSelectSheet?.classList.contains("show");
    document.body.classList.toggle("sheet-open", locked);
  }

  function closePlaylistTrackSheet() {
    openPlaylistTrackSheetName = null;
    if (el.playlistTrackSheet) el.playlistTrackSheet.classList.remove("show");
    syncSheetScrollLock();
  }

  function openPlaylistTrackSheet(pName) {
    if (!state.playlists[pName]) return;
    openPlaylistTrackSheetName = pName;
    if (el.playlistTrackList) el.playlistTrackList.scrollTop = 0;
    renderPlaylistTrackSheet(pName);
    syncPlaylistSheetControls(pName);
    if (el.playlistTrackSheet) el.playlistTrackSheet.classList.add("show");
    syncSheetScrollLock();
  }

  function renderPlaylistTrackSheet(pName) {
    if (!el.playlistTrackList || !state.playlists[pName]) return;
    if (el.playlistTrackSheetTitle) el.playlistTrackSheetTitle.textContent = `${pName} (${state.playlists[pName].length}曲)`;
    el.playlistTrackList.innerHTML = "";
    const names = state.playlists[pName];
    if (!names.length) {
      el.playlistTrackList.innerHTML = `<div style="color:var(--muted); font-size:.84rem; text-align:center; padding:18px 8px;">曲がありません</div>`;
      return;
    }
    names.forEach(songName => {
      const found = state.playlist.find(x => x.name === songName);
      const row = document.createElement("div");
      row.className = "plTrackItem";
      row.dataset.name = songName;
      const displayTitle = found ? found.title : songName.replace(/\.[^/.]+$/, '');
      row.innerHTML = `
        <span class="plTrackText">
          ${!found ? '<span style="color:#f8d25c; margin-right:4px;" title="ファイルが見つかりません">▲</span>' : ''}
          <strong>${escapeHTML(displayTitle)}</strong>
        </span>
        <div class="plTrackActions">
          <button class="btn small playPlTrackBtn" type="button">▶</button>
          <button class="btn small ghost removePlSongBtn" type="button">✕</button>
        </div>`;
      row.querySelector(".playPlTrackBtn").addEventListener("click", e => {
        e.stopPropagation();
        if (found) playSongFromPlaylist(found, pName);
      });
      row.querySelector(".removePlSongBtn").addEventListener("click", e => {
        e.stopPropagation();
        const idx = state.playlists[pName].indexOf(songName);
        if (idx >= 0) state.playlists[pName].splice(idx, 1);
        saveState();
        renderPlaylistTrackSheet(pName);
        renderPlaylists();
      });
      row.addEventListener("click", () => {
        if (found && !suppressNextSongClick && !row._suppressClick) playSongFromPlaylist(found, pName);
      });
      el.playlistTrackList.appendChild(row);
      attachLongPressReorder(
        row,
        el.playlistTrackList,
        ".plTrackItem",
        r => r.dataset.name,
        ordered => reorderPlaylistTracks(pName, ordered)
      );
    });
  }

  function renamePlaylist(pName) {
    if (!Object.prototype.hasOwnProperty.call(state.playlists, pName)) return;
    showInSitePrompt("プレイリストの名前を変更", "新しいプレイリスト名を入力してください。", pName, trimmedValue => {
      const trimmed = trimmedValue.trim();
      if (!trimmed || trimmed === pName) return;
      if (state.playlists[trimmed]) {
        toast("その名前のプレイリストは既にあります");
        return;
      }
      const next = {};
      Object.keys(state.playlists).forEach(name => {
        next[name === pName ? trimmed : name] = state.playlists[name];
      });
      state.playlists = next;
      if (state.playlistSettings[pName]) {
        state.playlistSettings[trimmed] = state.playlistSettings[pName];
        delete state.playlistSettings[pName];
      }
      if (state.activePlaylistName === pName) state.activePlaylistName = trimmed;
      if (openPlaylistTrackSheetName === pName) openPlaylistTrackSheetName = trimmed;
      saveState();
      renderPlaylists();
      if (openPlaylistTrackSheetName === trimmed) renderPlaylistTrackSheet(trimmed);
      toast(`「${pName}」を「${trimmed}」に変更しました`);
    });
  }

  function deletePlaylist(pName) {
    if (!Object.prototype.hasOwnProperty.call(state.playlists, pName)) return;
    document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(menu => { menu.hidden = true; });
    showInSiteConfirm(`「${pName}」を削除しますか？`, "プレイリストだけが削除され、曲ファイル自体は削除されません。", () => {
      if (!Object.prototype.hasOwnProperty.call(state.playlists, pName)) return;
      delete state.playlists[pName];
      delete state.playlistSettings[pName];
      if (state.activePlaylistName === pName) clearPlaylistContext();
      if (openPlaylistTrackSheetName === pName) closePlaylistTrackSheet();
      saveState();
      renderPlaylists();
      renderQueue();
      toast(`「${pName}」を削除しました`);
    });
  }

  function renderPlaylists(){
    const containers = [
      el.playlistContainer,
      document.getElementById("playlistContainerMain")
    ].filter(Boolean);

    if (!containers.length) return;

    containers.forEach(container => {
      container.innerHTML = "";
      const names = Object.keys(state.playlists);
      if(!names.length) {
        container.innerHTML = `<div style="color:var(--muted); font-size:.86rem">プレイリストがありません</div>`;
        return;
      }

      names.forEach(pName => {
        const card = document.createElement("div");
        card.className = "sectionCard plCard";
        card.dataset.name = pName;

        const tracksInPl = Array.isArray(state.playlists[pName]) ? state.playlists[pName] : [];
        state.playlists[pName] = tracksInPl;

        const row = document.createElement("div");
        row.className = "plSingleRow";
        row.innerHTML = `
          <div class="plTitleContainer">
            <div class="plTitleText" title="${escapeHTML(pName)}">${escapeHTML(pName)}</div>
          </div>
          <button class="btn small ghost plOpenBtn" type="button" title="曲一覧を開く" aria-label="曲一覧を開く">${tracksInPl.length}曲・曲一覧</button>
          <button class="btn small ghost plMenuBtn" type="button" title="プレイリストメニュー" aria-label="プレイリストメニュー">︙</button>
          <div class="plMenuPopup" hidden>
            <button type="button" class="plMenuItem" data-pl-rename>名前変更</button>
            <button type="button" class="plMenuItem dangerText" data-pl-delete>プレイリストの削除</button>
          </div>`;

        card.appendChild(row);
        container.appendChild(card);

        setupPlNameScroll(row.querySelector(".plTitleText"));

        const openBtn = row.querySelector(".plOpenBtn");
        openBtn.addEventListener("pointerdown", e => e.stopPropagation());
        openBtn.addEventListener("click", e => {
          e.stopPropagation();
          document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(m => { m.hidden = true; });
          openPlaylistTrackSheet(pName);
        });

        const menuBtn = row.querySelector(".plMenuBtn");
        const menu = row.querySelector(".plMenuPopup");
        menuBtn.addEventListener("pointerdown", e => e.stopPropagation());
        menuBtn.addEventListener("click", e => {
          e.stopPropagation();
          document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(m => { m.hidden = true; });
          menu.hidden = !menu.hidden;
        });
        row.querySelector("[data-pl-rename]").addEventListener("pointerdown", e => e.stopPropagation());
        row.querySelector("[data-pl-rename]").addEventListener("click", e => {
          e.stopPropagation();
          menu.hidden = true;
          renamePlaylist(pName);
        });
        row.querySelector("[data-pl-delete]").addEventListener("pointerdown", e => e.stopPropagation());
        row.querySelector("[data-pl-delete]").addEventListener("click", e => {
          e.stopPropagation();
          menu.hidden = true;
          deletePlaylist(pName);
        });

        card.addEventListener("click", e => {
          if (e.target.closest("button, .plMenuPopup") || card._suppressClick) return;
          document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(m => { m.hidden = true; });
          openPlaylistTrackSheet(pName);
        });

        attachLongPressReorder(
          card,
          container,
          ".plCard",
          r => r.dataset.name,
          ordered => reorderPlaylistCards(ordered)
        );
      });
    });
  }

  document.addEventListener("click", e => {
    if (e.target.closest(".plMenuBtn, .plMenuPopup")) return;
    document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(menu => { menu.hidden = true; });
  });

  if (el.btnClosePlaylistTrackSheet) el.btnClosePlaylistTrackSheet.addEventListener("click", closePlaylistTrackSheet);
  if (el.playlistTrackSheet) el.playlistTrackSheet.addEventListener("click", e => {
    if (e.target === el.playlistTrackSheet) closePlaylistTrackSheet();
  });
  if (el.btnPlaylistTrackAdd) el.btnPlaylistTrackAdd.addEventListener("click", () => {
    if (openPlaylistTrackSheetName) openBulkAddForPlaylist(openPlaylistTrackSheetName);
  });
  function syncPlaylistSheetControls(pName) {
    const settings = getPlaylistSettings(pName);
    if (el.btnPlaylistTrackShuffle) el.btnPlaylistTrackShuffle.classList.toggle("active", !!settings.shuffle);
    if (el.btnPlaylistTrackRepeat) el.btnPlaylistTrackRepeat.classList.toggle("active", !!settings.repeat);
  }

  if (el.btnPlaylistTrackShuffle) el.btnPlaylistTrackShuffle.addEventListener("click", () => {
    const pName = openPlaylistTrackSheetName;
    if (!pName) return;
    const settings = getPlaylistSettings(pName);
    settings.shuffle = !settings.shuffle;
    saveState();
    if (state.activePlaylistName === pName && state.currentSong) activatePlaylistContext(pName, state.currentSong.name);
    syncPlaylistSheetControls(pName);
    renderQueue();
  });

  if (el.btnPlaylistTrackRepeat) el.btnPlaylistTrackRepeat.addEventListener("click", () => {
    const pName = openPlaylistTrackSheetName;
    if (!pName) return;
    const settings = getPlaylistSettings(pName);
    settings.repeat = !settings.repeat;
    saveState();
    syncPlaylistSheetControls(pName);
    renderQueue();
  });

  if (el.btnPlaylistTrackPlay) el.btnPlaylistTrackPlay.addEventListener("click", () => {
    const pName = openPlaylistTrackSheetName;
    if (!pName || !state.playlists[pName]?.length) return toast("このプレイリストに再生できる曲がありません");
    const firstName = getPlaylistNames(pName)[0];
    const first = state.playlist.find(x => x.name === firstName);
    if (first) playSongFromPlaylist(first, pName);
  });

  function addSongToPlaylist(songName) {
    const plNames = Object.keys(state.playlists);
    if(!plNames.length) {
      toast("先にプレイリストを作成してください");
      return;
    }
    targetSongForPlaylist = songName;
    renderPlSelectSheet();
    if (el.plSelectSheet) el.plSelectSheet.classList.add("show");
    syncSheetScrollLock();
  }

  let bulkTargetPlaylist = null;

  function renderPlSelectSheet() {
    if (!el.plSelectList) return;
    el.plSelectList.innerHTML = "";
    bulkTargetPlaylist = null;
    targetSongForPlaylist = targetSongForPlaylist || null;
    const title = document.getElementById("plSelectSheetTitle");
    const bulkBtn = el.btnBulkAddPl;
    if (bulkBtn) bulkBtn.style.display = "none";
    if (title) title.textContent = "プレイリストを選択";

    const plNames = Object.keys(state.playlists);
    plNames.forEach(pName => {
      const item = document.createElement("div");
      item.className = "plSelectItem";
      const count = state.playlists[pName].length;
      item.innerHTML = `
        <div style="font-weight:600;">${escapeHTML(pName)}</div>
        <div style="color:var(--muted); font-size:.82rem;">${count}曲</div>
      `;
      item.addEventListener("click", () => {
        if(targetSongForPlaylist) {
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
    const songs = getVisibleSongs();
    if (!songs.length) {
      el.plSelectList.innerHTML = `<div style="color:var(--muted); font-size:.84rem; text-align:center; padding:12px;">追加できる曲がありません</div>`;
    } else {
      songs.forEach(song => {
        const item = document.createElement("label");
        item.className = "bulkPlItem";
        const checked = current.has(song.name) ? " checked" : "";
        item.innerHTML = `
          <input type="checkbox" class="bulkSongCheck" value="${escapeHTML(song.name)}"${checked}>
          <span class="bulkSongName">${escapeHTML(song.title)}</span>
        `;
        el.plSelectList.appendChild(item);
      });
    }

    if (el.plSelectSheet) el.plSelectSheet.classList.add("show");
    syncSheetScrollLock();
  }

  function closePlSelectSheet() {
    if (el.plSelectSheet) el.plSelectSheet.classList.remove("show");
    syncSheetScrollLock();
    targetSongForPlaylist = null;
    bulkTargetPlaylist = null;
    if (el.btnBulkAddPl) el.btnBulkAddPl.style.display = "none";
  }

  if (el.btnBulkAddPl) {
    el.btnBulkAddPl.addEventListener("click", () => {
      if (!bulkTargetPlaylist) return;
      const checks = el.plSelectList?.querySelectorAll(".bulkSongCheck") || [];
      const targetPlaylist = bulkTargetPlaylist;
      const selected = Array.from(checks).filter(cb => cb.checked).map(cb => cb.value);
      const existing = new Set(state.playlists[targetPlaylist] || []);
      selected.forEach(name => existing.add(name));
      state.playlists[targetPlaylist] = Array.from(existing);
      saveState();
      renderPlaylists();
      toast(`${selected.length}曲を「${targetPlaylist}」に追加しました`);
      closePlSelectSheet();
      if (targetPlaylist === openPlaylistTrackSheetName) {
        renderPlaylistTrackSheet(targetPlaylist);
        if (el.playlistTrackSheet) el.playlistTrackSheet.classList.add("show");
      }
    });
  }

  if (el.btnClosePlSheet) el.btnClosePlSheet.addEventListener("click", closePlSelectSheet);
  if (el.plSelectSheet) {
    el.plSelectSheet.addEventListener("click", e => {
      if(e.target === el.plSelectSheet) closePlSelectSheet();
    });
  }

  function setupSongNameScroll(element) {
    if (!element) return;

    element.classList.remove("songNameScrolling");
    element.style.removeProperty("--song-scroll-dist");
    element.style.removeProperty("--song-scroll-duration");

    requestAnimationFrame(() => {
      const available = element.parentElement?.clientWidth || 0;
      const overflow = element.scrollWidth - available;
      if (overflow > 8) {
        element.style.setProperty("--song-scroll-dist", `-${overflow + 18}px`);
        element.style.setProperty("--song-scroll-duration", `${Math.max(7, Math.min(18, overflow / 12 + 6))}s`);
        element.classList.add("songNameScrolling");
      }
    });
  }

  function renderSongList(){
    const vis = getVisibleSongs();
    if (!el.list) return;
    el.list.innerHTML = "";
    vis.forEach(song => {
      const row = document.createElement("div");
      row.className = "song" + (song.name === state.currentSong?.name ? " active" : "");
      row.dataset.name = song.name;
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${escapeHTML(song.title)}</div>
          <div class="songArtist">${escapeHTML(song.artist)}</div>
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
      row.addEventListener("click", () => {
        if (suppressNextSongClick || row._suppressClick) {
          suppressNextSongClick = false;
          return;
        }
        playSong(song);
      });
      el.list.appendChild(row);
      setupSongNameScroll(row.querySelector(".songName"));
      attachLongPressReorder(
        row,
        el.list,
        ".song",
        r => r.dataset.name,
        ordered => reorderSongsByVisibleOrder(ordered)
      );
    });
  }

  let songListResizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(songListResizeTimer);
    songListResizeTimer = setTimeout(() => {
      document.querySelectorAll(".songName").forEach(setupSongNameScroll);
      document.querySelectorAll(".plTitleText").forEach(setupPlNameScroll);
    }, 120);
  });

  function normalizeQueue(){
    const before = Array.isArray(state.queue) ? state.queue.slice() : [];
    const clean = [];
    const seen = new Set();
    before.forEach(name => {
      if (!name || seen.has(name)) return;
      if (!state.playlist.some(song => song.name === name)) return;
      seen.add(name);
      clean.push(name);
    });
    const changed = clean.length !== before.length || clean.some((name, i) => name !== before[i]);
    state.queue = clean;
    if (changed) saveState();
  }

  function addToQueue(name){
    normalizeQueue();
    if (!name) return;
    if (!state.playlist.some(song => song.name === name)) return;
    if (state.queue.includes(name)) {
      state.queue = [name, ...state.queue.filter(item => item !== name)];
      saveState();
      renderQueue();
      toast("その曲を次に再生する位置へ移しました");
      return;
    }
    state.queue = [name, ...state.queue.filter(item => item !== name)];
    saveState();
    renderQueue();
    toast("次に再生する曲として追加しました");
  }

  function getPlannedQueue(limit = 10) {
    normalizeQueue();
    const manual = [];
    const seen = new Set();
    state.queue.forEach(name => {
      if (!seen.has(name) && state.playlist.some(song => song.name === name)) {
        seen.add(name);
        manual.push(name);
      }
    });

    const result = manual.slice();
    let plannedCount = 0;
    const addCandidate = name => {
      if (!name || name === state.currentSong?.name || seen.has(name) || plannedCount >= limit) return;
      seen.add(name);
      result.push(name);
      plannedCount++;
    };

    if (state.activePlaylistName) {
      const order = Array.isArray(state.playlistCycleOrder) ? state.playlistCycleOrder : [];
      for (let i = state.playlistCycleIndex + 1; i < order.length && plannedCount < limit; i++) {
        addCandidate(order[i]);
      }
      if (plannedCount < limit && getPlaylistSettings(state.activePlaylistName).repeat) {
        const names = getPlaylistNames(state.activePlaylistName);
        for (const name of names) {
          if (plannedCount >= limit) break;
          addCandidate(name);
        }
      }
    } else {
      ensureHomeCycle();
      if (homeCycleOrder.length) {
        const startIndex = homeCycleIndex + 1;
        for (let offset = 0; offset < homeCycleOrder.length && plannedCount < limit; offset++) {
          addCandidate(homeCycleOrder[(startIndex + offset) % homeCycleOrder.length]);
        }
      }
    }
    return result;
  }

  function restartUpcomingRandomFrom(selectedName) {
    if (!selectedName) return;

    const manualNames = Array.isArray(state.queue) ? state.queue.slice() : [];
    let cycleOrder = [];
    let selectedIndex = -1;

    if (state.activePlaylistName) {
      cycleOrder = Array.isArray(state.playlistCycleOrder) ? state.playlistCycleOrder.slice() : [];
      selectedIndex = cycleOrder.indexOf(selectedName);
    } else {
      ensureHomeCycle();
      cycleOrder = homeCycleOrder.slice();
      selectedIndex = cycleOrder.indexOf(selectedName);
    }

    if (selectedIndex < 0) return;

    const remaining = cycleOrder.filter(name => name !== selectedName && !manualNames.includes(name));
    const used = new Set([...manualNames, ...remaining, selectedName]);

    const sourceSongs = state.activePlaylistName
      ? getPlaylistNames(state.activePlaylistName)
          .map(name => state.playlist.find(song => song.name === name))
          .filter(Boolean)
      : getVisibleSongs();

    const candidates = sourceSongs.filter(song => !used.has(song.name));
    if (candidates.length) {
      remaining.push(candidates[Math.floor(Math.random() * candidates.length)].name);
    }

    const nextOrder = [selectedName, ...remaining];

    if (state.activePlaylistName) {
      state.playlistCycleOrder = nextOrder;
      state.playlistCycleIndex = 0;
      state.playlistCycleSeen = [selectedName];
    } else {
      homeCycleOrder = nextOrder;
      homeCycleIndex = 0;
    }

    saveState();
  }

  function renderQueue(){
    if (!el.queueList) return;
    el.queueList.innerHTML = "";
    const names = getPlannedQueue(10);
    if (!names.length) {
      el.queueList.innerHTML = `<div style="color:var(--muted); font-size:.86rem">再生予定はありません</div>`;
      return;
    }
    const manualSet = new Set(state.queue);
    let plannedIndex = -1;
    names.forEach((name) => {
      const s = state.playlist.find(x => x.name === name);
      if (!s) return;
      const row = document.createElement("div");
      const isManual = manualSet.has(name);
      if (!isManual) plannedIndex++;
      const currentPlannedIndex = plannedIndex;
      row.className = "song queuePreviewRow";
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${escapeHTML(s.title)}</div>
          <div class="songArtist">${escapeHTML(s.artist)}</div>
        </div>
        <div class="songRight">
          <span class="queuePlanBadge">${isManual ? "次に再生" : "予定"}</span>
          ${isManual ? '<button class="btn small danger delQueueBtn">削除</button>' : ''}
        </div>
      `;
      if (isManual) {
        row.querySelector(".delQueueBtn")?.addEventListener("click", e => {
          e.stopPropagation();
          const idx = state.queue.indexOf(name);
          if (idx >= 0) state.queue.splice(idx, 1);
          saveState();
          renderQueue();
        });
      }
      row.addEventListener("click", () => {
        const wasManual = state.queue.includes(name);
        if (wasManual) {
          const idx = state.queue.indexOf(name);
          if (idx >= 0) state.queue.splice(idx, 1);
          saveState();
          playSong(s, true, { preservePlaylistContext: !!state.activePlaylistName });
          return;
        }

        if (currentPlannedIndex > 0) {
          restartUpcomingRandomFrom(name);
        }
        playSong(s, true, { preservePlaylistContext: !!state.activePlaylistName });
      });
      el.queueList.appendChild(row);
    });
  }

  function toggleFav(name){
    const idx = state.favorites.indexOf(name);
    if(idx >= 0) state.favorites.splice(idx, 1);
    else state.favorites.push(name);
    resetHomeCycle();
    saveState();
    renderSongList();
    if(state.currentSong?.name === name) {
      if (el.btnFav) {
        el.btnFav.textContent = state.favorites.includes(name) ? "★" : "☆";
        el.btnFav.classList.toggle("active", state.favorites.includes(name));
      }
    }
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
      for(let i = state.queue.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      saveState();
      renderQueue();
      toast("キューをシャッフルしました");
    });
  }

  function renderStats(){
    let totalPlays = 0;
    Object.values(state.playCounts).forEach(c => totalPlays += c);
    if (el.statPlays) el.statPlays.textContent = totalPlays;
    if (el.statSongs) el.statSongs.textContent = state.playlist.length;
    if (el.pillSongs) el.pillSongs.textContent = `${state.playlist.length}曲`;
    if (el.pillFavs) el.pillFavs.textContent = `${state.favorites.length}☆`;

    if(!el.playHistoryChart) return;
    const ctx = el.playHistoryChart.getContext("2d");
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = el.playHistoryChart.clientWidth || 300;
    const h = 180;
    el.playHistoryChart.width = w * dpr;
    el.playHistoryChart.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dates = [];
    for(let i=6; i>=0; i--){
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const counts = dates.map(d => state.playHistory[d] || 0);
    const maxVal = Math.max(...counts, 5);

    const paddingLeft = 30, paddingBottom = 25, paddingTop = 15, paddingRight = 15;
    const chartW = w - paddingLeft - paddingRight;
    const chartH = h - paddingTop - paddingBottom;

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, paddingTop);
    ctx.lineTo(paddingLeft, h - paddingBottom);
    ctx.lineTo(w - paddingRight, h - paddingBottom);
    ctx.stroke();

    const stepX = chartW / (dates.length - 1);
    const points = counts.map((val, idx) => {
      const x = paddingLeft + idx * stepX;
      const y = h - paddingBottom - (val / maxVal) * chartH;
      return { x, y, val, label: dates[idx].slice(5) };
    });

    ctx.beginPath();
    ctx.strokeStyle = "#1DB954";
    ctx.lineWidth = 2;
    points.forEach((pt, i) => {
      if(i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();

    points.forEach(pt => {
      ctx.fillStyle = "#1DB954";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(pt.label, pt.x, h - 8);
      if(pt.val > 0) ctx.fillText(pt.val, pt.x, pt.y - 8);
    });
  }

function showInSiteConfirm(title, message, onConfirm, confirmText = "確認") {
    const existing = document.getElementById("inSiteConfirmModal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "inSiteConfirmModal";
    modal.className = "inSiteConfirmModal";
    modal.innerHTML = `
      <div class="inSiteConfirmCard" role="dialog" aria-modal="true" aria-labelledby="inSiteConfirmTitle">
        <div class="sectionTitle" id="inSiteConfirmTitle"></div>
        <div class="inSiteConfirmMessage"></div>
        <div class="inSiteConfirmActions">
          <button type="button" class="btn small" data-confirm-cancel>キャンセル</button>
          <button type="button" class="btn small danger" data-confirm-ok></button>
        </div>
      </div>`;
    modal.querySelector("#inSiteConfirmTitle").textContent = title;
    modal.querySelector(".inSiteConfirmMessage").textContent = message;
    modal.querySelector("[data-confirm-ok]").textContent = confirmText;
    document.body.appendChild(modal);
    document.body.classList.add("site-modal-open");
    const close = () => { modal.remove(); if (!document.querySelector(".inSiteConfirmModal")) document.body.classList.remove("site-modal-open"); };
    modal.querySelector("[data-confirm-cancel]").addEventListener("click", close);
    modal.querySelector("[data-confirm-ok]").addEventListener("click", () => { close(); onConfirm?.(); });
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    requestAnimationFrame(() => modal.querySelector("[data-confirm-ok]")?.focus());
  }

  function showInSitePrompt(title, message, initialValue, onConfirm) {
    const existing = document.getElementById("inSitePromptModal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "inSitePromptModal";
    modal.className = "inSiteConfirmModal";
    modal.innerHTML = `
      <div class="inSiteConfirmCard" role="dialog" aria-modal="true" aria-labelledby="inSitePromptTitle">
        <div class="sectionTitle" id="inSitePromptTitle"></div>
        <div class="inSiteConfirmMessage"></div>
        <input type="text" class="inSitePromptInput" data-prompt-input maxlength="120" autocomplete="off">
        <div class="inSiteConfirmActions">
          <button type="button" class="btn small" data-prompt-cancel>キャンセル</button>
          <button type="button" class="btn small" data-prompt-ok>変更する</button>
        </div>
      </div>`;
    modal.querySelector("#inSitePromptTitle").textContent = title;
    modal.querySelector(".inSiteConfirmMessage").textContent = message;
    const input = modal.querySelector("[data-prompt-input]");
    input.value = initialValue || "";
    document.body.appendChild(modal);
    document.body.classList.add("site-modal-open");
    const close = () => { modal.remove(); if (!document.querySelector(".inSiteConfirmModal")) document.body.classList.remove("site-modal-open"); };
    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        input.classList.add("invalid");
        input.focus();
        return;
      }
      close();
      onConfirm?.(value);
    };
    modal.querySelector("[data-prompt-cancel]").addEventListener("click", close);
    modal.querySelector("[data-prompt-ok]").addEventListener("click", submit);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  if (el.btnResetStats) {
    el.btnResetStats.addEventListener("click", () => {
