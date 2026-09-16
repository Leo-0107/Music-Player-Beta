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
      if(!confirm("再生統計データをリセットしますか？")) return;
      state.playCounts = {};
      state.playHistory = {};
      saveState();
      renderStats();
      renderSongList();
      toast("再生統計をリセットしました");
    });
  }

  function renderAll(){
    renderSongList();
    renderQueue();
    renderPlaylists();
    renderStats();
  }

  audio.addEventListener("play", () => {
    updatePlayPauseUI();
    lastFrameTime = performance.now();
    startWaveAnimation();
  });

  audio.addEventListener("pause", () => {
    updatePlayPauseUI();
  });

  audio.addEventListener("playing", () => {
    updatePlayPauseUI();
  });

  audio.addEventListener("waiting", () => {
    updatePlayPauseUI();
  });

  audio.addEventListener("timeupdate", () => {
    if(!audio.duration) return;
    const cur = audio.currentTime, dur = audio.duration;
    if(!isSlidingRange) {
      if (el.progress) el.progress.value = (cur / dur) * 100;
      if (el.miniProgress) el.miniProgress.value = (cur / dur) * 100;
    }
    if (el.timeNow) el.timeNow.textContent = fmtTime(cur);
    if (el.timeAll) el.timeAll.textContent = fmtTime(dur);

    if (cur > 30 || (dur > 0 && cur / dur > 0.5)) {
      recordPlayCount();
    }

    updateMediaSessionPosition();
  });

  audio.addEventListener("ended", () => {
    releaseWakeLock();
    if(state.repeat) {
      audio.currentTime = 0;
      audio.play().then(() => requestWakeLock()).catch(()=>{});
    } else {
      nextTrack(true);
    }
  });

  if (el.progress) {
    el.progress.addEventListener("pointerdown", () => isSlidingRange = true);
    el.progress.addEventListener("pointerup", () => isSlidingRange = false);
    el.progress.addEventListener("input", () => {
      if(audio.duration) audio.currentTime = (Number(el.progress.value) / 100) * audio.duration;
    });
  }

  if (el.miniProgress) {
    el.miniProgress.addEventListener("pointerdown", () => isSlidingRange = true);
    el.miniProgress.addEventListener("pointerup", () => isSlidingRange = false);
    el.miniProgress.addEventListener("input", () => {
      if(audio.duration) audio.currentTime = (Number(el.miniProgress.value) / 100) * audio.duration;
    });
  }

  if (el.btnPlay) el.btnPlay.addEventListener("click", playPause);
