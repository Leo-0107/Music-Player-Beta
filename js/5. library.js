        tx.objectStore("tracks").clear();
      }
      revokeAllObjectURLs();
      state.playlist = [];
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
    state.playlist = tracks.map(t => {
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
    }).sort((a,b) => a.title.localeCompare(b.title, "ja", {numeric:true}));
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
    silenceTimer = 0;
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

        const tracksInPl = Array.isArray(state.playlists[pName]) ? state.playlists[pName] : [];
        state.playlists[pName] = tracksInPl;

        const row1 = document.createElement("div");
        row1.className = "plRow1";
        row1.innerHTML = `
          <button class="btn small ghost plToggleBtn" type="button" aria-expanded="false" title="曲を表示">▶ 曲一覧 (${tracksInPl.length})</button>
          <div class="plTitleContainer">
            <div class="plTitleText" title="${escapeHTML(pName)}">${escapeHTML(pName)}</div>
          </div>
          <button class="btn small ghost delPlBtn" type="button" title="プレイリストを削除">✕</button>
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
                ${!found ? '<span style="color:#f8d25c; margin-right:4px;" title="ファイルが見つかりません">▲</span>' : ''}
                <strong>${escapeHTML(displayTitle)}</strong>
              </span>
              <div style="display:flex; gap:6px; align-items:center;">
                <button class="btn small playPlTrackBtn" type="button" style="padding:2px 8px;">▶</button>
                <button class="btn small ghost removePlSongBtn" type="button" style="padding:2px 6px;">✕</button>
              </div>
            `;

            row.querySelector(".playPlTrackBtn").addEventListener("click", e => {
              e.stopPropagation();
              if (found) playSong(found);
            });
            row.addEventListener("click", () => {
              if (found) playSong(found);
            });
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

        const toggleList = () => {
          const willOpen = listDiv.classList.contains("collapsed");
          listDiv.classList.toggle("collapsed", !willOpen);
          const toggleBtn = row1.querySelector(".plToggleBtn");
          if (toggleBtn) {
            toggleBtn.textContent = willOpen ? `▼ 曲一覧 (${tracksInPl.length})` : `▶ 曲一覧 (${tracksInPl.length})`;
            toggleBtn.setAttribute("aria-expanded", String(willOpen));
            toggleBtn.title = willOpen ? "曲を隠す" : "曲を表示";
          }
        };

        row1.querySelector(".plToggleBtn").addEventListener("click", e => {
          e.stopPropagation();
          toggleList();
        });
        row1.querySelector(".plTitleText").addEventListener("click", toggleList);

        row2.querySelector(".bulkAddPlBtn").addEventListener("click", e => {
          e.stopPropagation();
          openBulkAddForPlaylist(pName);
        });

        row2.querySelector(".playPlBtn").addEventListener("click", e => {
          e.stopPropagation();
          const songObjects = state.playlists[pName].map(n => state.playlist.find(x => x.name === n)).filter(Boolean);
          if(songObjects.length) playSong(songObjects[0]);
          else toast("このプレイリストに再生できる曲がありません");
        });

        row2.querySelector(".renamePlBtn").addEventListener("click", e => {
          e.stopPropagation();
          const newName = prompt("新しいプレイリスト名を入力してください:", pName);
          const trimmed = newName?.trim();
          if(trimmed && trimmed !== pName) {
            if (state.playlists[trimmed]) {
              toast("その名前のプレイリストは既にあります");
              return;
            }
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
        setupPlNameScroll(row1.querySelector(".plTitleText"));
      });
    });
  }

  function addSongToPlaylist(songName) {
    const plNames = Object.keys(state.playlists);
    if(!plNames.length) {
      toast("先にプレイリストを作成してください");
      return;
    }
    targetSongForPlaylist = songName;
    renderPlSelectSheet();
    if (el.plSelectSheet) el.plSelectSheet.classList.add("show");
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
      row.addEventListener("click", () => playSong(song));
      el.list.appendChild(row);
      setupSongNameScroll(row.querySelector(".songName"));
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
