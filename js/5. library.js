        tx.objectStore("tracks").clear();
      }
      revokeAllObjectURLs();
      state.playlist = [];
      state.playlistOrder = [];
      state.currentSong = null;
      state.queue = [];
      state.playlists = {};
      audio.pause();
      audio.src = "";
      if (el.folder) el.folder.value = "";
      const directoryInput = document.getElementById("folderDirectory");
      if (directoryInput) directoryInput.value = "";
      updateArtwork(null);
      updateTitleTextAndScroll(el.nowTitle, "未再生");
      updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
      updateTitleTextAndScroll(el.miniTitle, "停止中");
      saveState();
      renderAll();
      toast("全ファイルをリセットしました");
    });
  }

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
    if(!confirm(`「${song.title}」を削除しますか？`)) return;

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
        localStorage.removeItem(STORAGE.lastPosition);
      } catch (e) {}
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

  let playbackMemorySaveTimer = null;

  function savePlaybackMemory(force = false) {
    if (force && playbackMemorySaveTimer) { clearTimeout(playbackMemorySaveTimer); playbackMemorySaveTimer = null; }
    const write = () => {
      try {
        localStorage.setItem(STORAGE.lastSong, state.currentSong?.name || "");
        localStorage.setItem(STORAGE.lastPosition, String(Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0));
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
    const savedPosition = loadNum(STORAGE.lastPosition, 0);
    if (!songName) return;
    const song = state.playlist.find(item => item.name === songName);
    if (!song) return;
    state.currentSong = song;
    audio.src = song.url;
    updateArtwork(song);
    updateNowPlayingUI(song);
    const applyPosition = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(Math.max(0, savedPosition), Math.max(0, audio.duration - 0.05));
      }
      if (el.progress && audio.duration) el.progress.value = (audio.currentTime / audio.duration) * 100;
      if (el.miniProgress && audio.duration) el.miniProgress.value = (audio.currentTime / audio.duration) * 100;
      if (el.timeNow) el.timeNow.textContent = fmtTime(audio.currentTime);
      if (el.timeAll) el.timeAll.textContent = fmtTime(audio.duration);
    };
    if (audio.readyState >= 1) applyPosition();
    else audio.addEventListener("loadedmetadata", applyPosition, { once: true });
  }

  audio.addEventListener("timeupdate", () => savePlaybackMemory(false));
  audio.addEventListener("pause", () => savePlaybackMemory(true));
  audio.addEventListener("ended", () => savePlaybackMemory(true));
  window.addEventListener("pagehide", () => savePlaybackMemory(true));
  window.addEventListener("beforeunload", () => savePlaybackMemory(true));

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
    silenceTimer = 0;
    try {
      localStorage.setItem(STORAGE.lastSong, song.name);
      localStorage.setItem(STORAGE.lastPosition, "0");
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
    if(state.shuffle){
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
      const elAtPoint = document.elementFromPoint(e.clientX, e.clientY);
      const target = elAtPoint?.closest(selector);
      if (!target || target === row || target.parentElement !== container) return;
      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) {
        if (target.nextSibling !== row) container.insertBefore(row, target.nextSibling);
      } else {
        if (target !== row.nextSibling) container.insertBefore(row, target);
      }
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
        if (found) playSong(found);
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
        if (found && !suppressNextSongClick && !row._suppressClick) playSong(found);
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
    const newName = prompt("新しいプレイリスト名を入力してください:", pName);
    const trimmed = newName?.trim();
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
    if (openPlaylistTrackSheetName === pName) openPlaylistTrackSheetName = trimmed;
    saveState();
    renderPlaylists();
    if (openPlaylistTrackSheetName === trimmed) renderPlaylistTrackSheet(trimmed);
  }

  function deletePlaylist(pName) {
    showInSiteConfirm(`「${pName}」を削除しますか？`, "プレイリストだけが削除され、曲ファイル自体は削除されません。", () => {
      delete state.playlists[pName];
      if (openPlaylistTrackSheetName === pName) closePlaylistTrackSheet();
      saveState();
      renderPlaylists();
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
          <button class="btn small ghost plMenuBtn" type="button" title="プレイリストメニュー" aria-label="プレイリストメニュー">︙</button>
          <div class="plMenuPopup" hidden>
            <button type="button" class="plMenuItem" data-pl-rename>名前変更</button>
            <button type="button" class="plMenuItem dangerText" data-pl-delete>プレイリストの削除</button>
          </div>`;

        const detail = document.createElement("div");
        detail.className = "plCardHint";
        detail.innerHTML = `<span>${tracksInPl.length}曲</span><span>タップで曲一覧</span>`;

        card.appendChild(row);
        card.appendChild(detail);
        container.appendChild(card);

        setupPlNameScroll(row.querySelector(".plTitleText"));

        const menuBtn = row.querySelector(".plMenuBtn");
        const menu = row.querySelector(".plMenuPopup");
        menuBtn.addEventListener("click", e => {
          e.stopPropagation();
          document.querySelectorAll(".plMenuPopup:not([hidden])").forEach(m => { m.hidden = true; });
          menu.hidden = !menu.hidden;
        });
        row.querySelector("[data-pl-rename]").addEventListener("click", e => {
          e.stopPropagation();
          menu.hidden = true;
          renamePlaylist(pName);
        });
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
  if (el.btnPlaylistTrackPlay) el.btnPlaylistTrackPlay.addEventListener("click", () => {
    const pName = openPlaylistTrackSheetName;
    if (!pName || !state.playlists[pName]?.length) return toast("このプレイリストに再生できる曲がありません");
    const first = state.playlists[pName].map(n => state.playlist.find(x => x.name === n)).find(Boolean);
    if (first) playSong(first);
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
    if(state.currentSong?.name === name) {
      if (el.btnFav) {
        el.btnFav.textContent = state.favorites.includes(name) ? "★" : "☆";
        el.btnFav.classList.toggle("active", state.favorites.includes(name));
      }
    }
  }

  function renderQueue(){
    if (!el.queueList) return;
    el.queueList.innerHTML = "";
    if(!state.queue.length){
      el.queueList.innerHTML = `<div style="color:var(--muted); font-size:.86rem">キューは空です</div>`;
      return;
    }
    state.queue.forEach((name, idx) => {
      const s = state.playlist.find(x => x.name === name);
      const row = document.createElement("div");
      row.className = "song";
      row.innerHTML = `
        <div class="songMain">
          <div class="songName">${escapeHTML(s ? s.title : name)}</div>
          <div class="songArtist">${escapeHTML(s ? s.artist : "不明")}</div>
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
        if(s) playSong(s);
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

  if (el.btnResetStats) {
    el.btnResetStats.addEventListener("click", () => {