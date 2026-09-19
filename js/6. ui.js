const titleObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const container = entry.target;
    container._isIntersecting = entry.isIntersecting;
    const textEl = container.querySelector(".scroll-text");
    if (textEl && textEl.classList.contains("scrolling")) {
      if (entry.isIntersecting && document.visibilityState === "visible") {
        textEl.style.animationPlayState = "running";
      } else {
        textEl.style.animationPlayState = "paused";
      }
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll(".scroll-container").forEach(c => titleObserver.observe(c));

document.addEventListener("visibilitychange", () => {
  document.querySelectorAll(".scroll-container").forEach(container => {
    const textEl = container.querySelector(".scroll-text");
    if (textEl && textEl.classList.contains("scrolling")) {
      if (document.visibilityState === "visible" && container._isIntersecting) {
        textEl.style.animationPlayState = "running";
      } else {
        textEl.style.animationPlayState = "paused";
      }
    }
  });
  if (document.visibilityState === "visible" && !audio.paused) {
    lastFrameTime = performance.now();
    startWaveAnimation();
  }
});

function updateTitleTextAndScroll(element, text) {
  if (!element) return;
  const container = element.closest(".scroll-container");
  element.classList.remove("scrolling");
  element.style.animationPlayState = "paused";
  element.textContent = text;

  requestAnimationFrame(() => {
    if (!container) return;
    const overflow = element.scrollWidth - container.clientWidth;
    if (overflow > 6) {
      element.style.setProperty("--scroll-dist", `-${overflow + 12}px`);
      element.classList.add("scrolling");
      if (container._isIntersecting && document.visibilityState === "visible") {
        element.style.animationPlayState = "running";
      }
    }
  });
}

function fmtTime(sec){
  if(!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toast(msg){
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("show"), 1400);
}

function applyTheme(){
  document.body.classList.remove("theme-light");
  [el.btnThemeSystem, el.btnThemeDark, el.btnThemeLight, el.btnThemeCustom].forEach(b => b?.classList.remove("active"));
  if (el.customThemeArea) el.customThemeArea.style.display = "none";

  document.body.style.removeProperty("--text");
  document.body.style.removeProperty("--muted");

  let activeMode = state.themeMode;
  if(activeMode === "system"){
    if (el.btnThemeSystem) el.btnThemeSystem.classList.add("active");
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    activeMode = isSystemDark ? "dark" : "light";
  }

  if(activeMode === "light"){
    document.body.classList.add("theme-light");
    document.body.style.background = "";
    document.body.style.color = "";
    if(state.themeMode === "light" && el.btnThemeLight) el.btnThemeLight.classList.add("active");
  } else if(activeMode === "custom"){
    if (el.btnThemeCustom) el.btnThemeCustom.classList.add("active");
    if (el.customThemeArea) el.customThemeArea.style.display = "block";

    const { c1, l1, c2, l2, text, lText, dir } = state.customTheme;
    const computedC1 = adjustColorLightness(c1 || "#1d3557", l1 !== undefined ? l1 : 100);
    const computedC2 = adjustColorLightness(c2 || "#121212", l2 !== undefined ? l2 : 100);
    
    const baseLText = lText !== undefined ? lText : 100;
    const computedText = adjustColorLightness(text || "#ffffff", baseLText);
    const computedMuted = adjustColorLightness(text || "#ffffff", Math.round(baseLText * 0.65));

    document.body.style.background = `linear-gradient(${dir || "180deg"}, ${computedC1} 0%, ${computedC2} 100%)`;
    document.body.style.backgroundAttachment = "fixed";
    document.body.style.color = computedText;
    
    document.body.style.setProperty("--text", computedText);
    document.body.style.setProperty("--muted", computedMuted);
  } else {
    document.body.style.background = "";
    document.body.style.color = "";
    if(state.themeMode === "dark" && el.btnThemeDark) el.btnThemeDark.classList.add("active");
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if(state.themeMode === "system") applyTheme();
});

function renderColorPickers(){
  const targets = [
    { grid: el.gridColor1, key: "c1" },
    { grid: el.gridColor2, key: "c2" },
    { grid: el.gridTextColor, key: "text" }
  ];

  targets.forEach(({ grid, key }) => {
    if(!grid) return;
    grid.innerHTML = "";
    const current = state.customTheme[key];
    COLOR_PALETTE_12.forEach(color => {
      const dot = document.createElement("div");
      dot.className = "colorDot" + (current === color ? " selected" : "");
      dot.style.background = color;
      dot.addEventListener("click", () => {
        state.customTheme[key] = color;
        saveState();
        applyTheme();
        renderColorPickers();
      });
      grid.appendChild(dot);
    });
  });

  if(el.sliderL1) el.sliderL1.value = state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100;
  if(el.sliderL2) el.sliderL2.value = state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100;
  if(el.sliderLText) el.sliderLText.value = state.customTheme.lText !== undefined ? state.customTheme.lText : 100;
  if(el.txtL1) el.txtL1.textContent = `${el.sliderL1.value}%`;
  if(el.txtL2) el.txtL2.textContent = `${el.sliderL2.value}%`;
  if(el.txtLText) el.txtLText.textContent = `${el.sliderLText.value}%`;

  const previewC1 = adjustColorLightness(state.customTheme.c1 || "#1d3557", state.customTheme.l1 !== undefined ? state.customTheme.l1 : 100);
  const previewC2 = adjustColorLightness(state.customTheme.c2 || "#121212", state.customTheme.l2 !== undefined ? state.customTheme.l2 : 100);
  document.querySelectorAll(".gradOption").forEach(opt => {
    opt.classList.toggle("selected", opt.dataset.deg === (state.customTheme.dir || "180deg"));
    const preview = opt.querySelector(".gradPreview");
    if (preview) preview.style.background = `linear-gradient(${opt.dataset.deg}, ${previewC1} 0%, ${previewC2} 100%)`;
  });
}

document.querySelectorAll(".gradOption").forEach(opt => {
  opt.addEventListener("click", () => {
    state.customTheme.dir = opt.dataset.deg;
    saveState();
    applyTheme();
    renderColorPickers();
  });
});

[{ slider: el.sliderL1, txt: el.txtL1, key: "l1" },
 { slider: el.sliderL2, txt: el.txtL2, key: "l2" },
 { slider: el.sliderLText, txt: el.txtLText, key: "lText" }].forEach(({ slider, txt, key }) => {
  if(!slider) return;
  slider.addEventListener("input", () => {
    const val = Number(slider.value);
    state.customTheme[key] = val;
    if (txt) txt.textContent = `${val}%`;
    saveState();
    applyTheme();
  });
});

function updateArtwork(song) {
  const drawCanvas = (canvas, size) => {
    if(!canvas) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    if (song?.coverUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, size, size);
        const scale = Math.max(size / img.width, size / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const dx = (size - drawW) / 2;
        const dy = (size - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
      };
      img.src = song.coverUrl;
      return;
    }

    ctx.fillStyle = "rgba(35, 35, 40, 0.9)";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(200, 200, 200, 0.3)";
    ctx.font = `bold ${Math.round(size / 6.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NO IMAGE", size / 2, size / 2);
  };

  drawCanvas(el.nowCoverCanvas, 160);
  drawCanvas(el.miniCoverCanvas, 32);
}

if (el.btnResetFiles) {
  el.btnResetFiles.addEventListener("click", () => {
    if (!confirm("保存された全トラックを削除しますか？")) return;
    if (db) {
      const tx = db.transaction("tracks", "readwrite");
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
    updateArtwork(null);
    updateTitleTextAndScroll(el.nowTitle, "未再生");
    updateTitleTextAndScroll(el.nowSub, "ファイルをドロップまたは選択してください");
    updateTitleTextAndScroll(el.miniTitle, "停止中");
    saveState();
    renderAll();
    toast("全ファイルをリセットしました");
  });
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
if (el.miniPlay) el.miniPlay.addEventListener("click", playPause);
if (el.btnPrev) el.btnPrev.addEventListener("click", prevTrack);
if (el.miniPrev) el.miniPrev.addEventListener("click", prevTrack);
if (el.btnNext) el.btnNext.addEventListener("click", () => nextTrack(false));
if (el.miniNext) el.miniNext.addEventListener("click", () => nextTrack(false));

if (el.btnRewind10) el.btnRewind10.addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
if (el.btnForward10) el.btnForward10.addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });

if (el.btnFav) {
  el.btnFav.addEventListener("click", () => {
    if(state.currentSong) toggleFav(state.currentSong.name);
  });
}

if (el.btnMainShuffle) {
  el.btnMainShuffle.addEventListener("click", () => {
    state.shuffle = !state.shuffle;
    saveState();
    el.btnMainShuffle.classList.toggle("active", state.shuffle);
    toast(`シャッフル: ${state.shuffle ? "ON" : "OFF"}`);
  });
  el.btnMainShuffle.classList.toggle("active", state.shuffle);
}

if (el.btnMainRepeat) {
  el.btnMainRepeat.addEventListener("click", () => {
    state.repeat = !state.repeat;
    saveState();
    el.btnMainRepeat.classList.toggle("active", state.repeat);
    toast(`リピート: ${state.repeat ? "ON" : "OFF"}`);
  });
  el.btnMainRepeat.classList.toggle("active", state.repeat);
}

if (el.pillFavs) {
  el.pillFavs.addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    el.pillFavs.classList.toggle("active", state.favOnly);
    renderSongList();
  });
}

if (el.search) {
  el.search.addEventListener("input", e => {
    state.search = e.target.value;
    renderSongList();
  });
}

if (el.playbackRate) {
  el.playbackRate.addEventListener("input", e => {
    currentRate = Number(e.target.value);
    if (el.customRateInput) el.customRateInput.value = currentRate.toFixed(2);
    applyPitchAndRate();
  });
}

if (el.customRateInput) {
  el.customRateInput.addEventListener("change", e => {
    let v = Number(e.target.value);
    if (v < 0.1) v = 0.1;
    if (v > 10) v = 10;
    currentRate = v;
    if (el.playbackRate) el.playbackRate.value = Math.min(2.0, Math.max(0.0, currentRate));
    applyPitchAndRate();
  });
}

if (el.pitchShift) {
  el.pitchShift.addEventListener("input", e => {
    state.pitchSemitones = Number(e.target.value);
    saveState();
    applyPitchAndRate();
  });
}

if (el.btnCrossfade) {
  el.btnCrossfade.addEventListener("click", () => {
    state.crossfade = !state.crossfade;
    saveState();
    el.btnCrossfade.textContent = `クロスフェード: ${state.crossfade ? "ON" : "OFF"}`;
  });
  el.btnCrossfade.textContent = `クロスフェード: ${state.crossfade ? "ON" : "OFF"}`;
}

if (el.btnSilenceSkip) {
  el.btnSilenceSkip.addEventListener("click", () => {
    state.silenceSkip = !state.silenceSkip;
    silenceTimer = 0;
    saveState();
    el.btnSilenceSkip.textContent = `無音スキップ: ${state.silenceSkip ? "ON" : "OFF"}`;
  });
  el.btnSilenceSkip.textContent = `無音スキップ: ${state.silenceSkip ? "ON" : "OFF"}`;
}

if (el.pannerSlider) {
  el.pannerSlider.addEventListener("input", e => {
    state.panValue = Number(e.target.value);
    if (pannerNode) pannerNode.pan.value = state.panValue;
    if (el.pannerValText) {
      if (state.panValue === 0) el.pannerValText.textContent = "中央";
      else if (state.panValue < 0) el.pannerValText.textContent = `左 (${Math.abs(Math.round(state.panValue * 100))}%)`;
      else el.pannerValText.textContent = `右 (${Math.round(state.panValue * 100)}%)`;
    }
  });
}

if (el.btnThemeSystem) el.btnThemeSystem.addEventListener("click", () => { state.themeMode = "system"; saveState(); applyTheme(); });
if (el.btnThemeDark) el.btnThemeDark.addEventListener("click", () => { state.themeMode = "dark"; saveState(); applyTheme(); });
if (el.btnThemeLight) el.btnThemeLight.addEventListener("click", () => { state.themeMode = "light"; saveState(); applyTheme(); });
if (el.btnThemeCustom) el.btnThemeCustom.addEventListener("click", () => { state.themeMode = "custom"; saveState(); applyTheme(); renderColorPickers(); });

function openSidebar() {
  state.menuOpen = true;
  if (el.sidebar) el.sidebar.classList.add("open");
  if (el.overlay) el.overlay.classList.add("open");
  document.body.classList.add("menu-open");
}

function closeSidebar() {
  state.menuOpen = false;
  if (el.sidebar) el.sidebar.classList.remove("open");
  if (el.overlay) el.overlay.classList.remove("open");
  document.body.classList.remove("menu-open");
  resetSidebarView();
}

function resetSidebarView() {
  if (el.mainMenuList) el.mainMenuList.style.display = "flex";
  document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
  if (el.btnSideBack) el.btnSideBack.style.display = "none";
  if (el.sideTitle) el.sideTitle.textContent = "メニュー";
}

if (el.btnMenu) el.btnMenu.addEventListener("click", openSidebar);
if (el.btnCloseMenu) el.btnCloseMenu.addEventListener("click", closeSidebar);
if (el.overlay) el.overlay.addEventListener("click", closeSidebar);

document.querySelectorAll(".menuItem").forEach(item => {
  item.addEventListener("click", () => {
    const secId = item.dataset.section;
    if (!secId) return;
    if (el.mainMenuList) el.mainMenuList.style.display = "none";
    document.querySelectorAll(".panelSection").forEach(p => p.classList.remove("active"));
    const target = document.getElementById(secId);
    if (target) target.classList.add("active");
    if (el.btnSideBack) el.btnSideBack.style.display = "inline-block";
    if (el.sideTitle) el.sideTitle.textContent = item.childNodes[0].textContent.trim();
  });
});

if (el.btnSideBack) {
  el.btnSideBack.addEventListener("click", resetSidebarView);
}

document.querySelectorAll(".navTab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".navTab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.target;

    const homeEl = document.getElementById("homeElements");
    const plEl = document.getElementById("playlistElements");
    const setEl = document.getElementById("settingsTabContainer");

    if (homeEl) homeEl.style.display = target === "home" ? "block" : "none";
    if (plEl) plEl.style.display = target === "playlist" ? "flex" : "none";
    if (setEl) setEl.style.display = target === "settings" ? "block" : "none";
  });
});

if (el.shell) {
  el.shell.addEventListener("dragover", e => {
    e.preventDefault();
    el.shell.classList.add("dragover");
  });
  el.shell.addEventListener("dragleave", () => el.shell.classList.remove("dragover"));
  el.shell.addEventListener("drop", e => {
    e.preventDefault();
    el.shell.classList.remove("dragover");
    if (e.dataTransfer.files) loadFiles(e.dataTransfer.files);
  });
}

window.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

  const isModalOpen = el.shortcutModal?.classList.contains("show") ||
                      el.plAlertModal?.classList.contains("show") ||
                      el.plSelectSheet?.classList.contains("show");

  if (e.key === "Escape") {
    if (isModalOpen) {
      hideShortcutModal();
      hidePlAlertModal();
      closePlSelectSheet();
    } else if (state.menuOpen) {
      closeSidebar();
    }
    return;
  }

  if (isModalOpen) return;

  if (e.code === "Space") {
    e.preventDefault();
    playPause();
  } else if (e.code === "ArrowLeft") {
    e.preventDefault();
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  } else if (e.code === "ArrowRight") {
    e.preventDefault();
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  } else if (e.code === "ArrowUp") {
    e.preventDefault();
    updateVolumeUI(Math.min(2.0, currentVolumeTarget + 0.05));
  } else if (e.code === "ArrowDown") {
    e.preventDefault();
    updateVolumeUI(Math.max(0.0, currentVolumeTarget - 0.05));
  } else if (e.key === "m" || e.key === "M") {
    if (el.btnMuteToggle) el.btnMuteToggle.click();
  } else if (e.key === "f" || e.key === "F") {
    if (el.btnFav) el.btnFav.click();
  } else if (e.key === "?") {
    showShortcutModal();
  }
});

(async () => {
  await initDB();
  await reloadPlaylistFromDB();
  applyTheme();
  renderEqualizer();
  renderColorPickers();
  setDMode(state.dMode);
  setWaveMode(state.waveMode);
  updateVolumeUI(currentVolumeTarget);
  applyPitchAndRate();
  setupMediaSessionRemoteControls();
})();
