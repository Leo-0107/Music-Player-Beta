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
