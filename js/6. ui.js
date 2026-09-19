// ui.js - UI管理および描画ロジック

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

function renderEqualizer(){
  if(!el.eqPresetRow || !el.eqBands) return;
  el.eqPresetRow.innerHTML = "";
  Object.keys(EQ_PRESETS).forEach(pName => {
    const b = document.createElement("button");
    b.className = "btn small" + (state.eqState.preset === pName ? " active" : "");
    b.textContent = pName;
    b.addEventListener("click", () => {
      state.eqState.preset = pName;
      animateEqPreset(EQ_PRESETS[pName]);
      updatePresetButtonsUI();
    });
    el.eqPresetRow.appendChild(b);
  });

  el.eqBands.innerHTML = "";
  const labels = ["60Hz", "250Hz", "1kHz", "4kHz", "12kHz"];
  labels.forEach((lbl, idx) => {
    const gainVal = Number(state.eqState.gains[idx] || 0);
    const vBand = document.createElement("div");
    vBand.className = "vBand";
    vBand.innerHTML = `
      <div class="vVal" id="eqVal_${idx}">${gainVal > 0 ? "+" + gainVal.toFixed(1) : gainVal.toFixed(1)}dB</div>
      <div class="vTrack">
        <input type="range" class="vSlider" id="eqSlider_${idx}" min="-12" max="12" step="0.5" value="${gainVal}">
      </div>
      <span style="font-size:.75rem; color:var(--muted); margin-top:4px">${lbl}</span>
    `;
    const slider = vBand.querySelector(".vSlider");

    slider.addEventListener("input", () => {
      if(eqAnimId) cancelAnimationFrame(eqAnimId);
      const v = Number(slider.value);
      state.eqState.preset = "Custom";
      state.eqState.gains[idx] = v;
      updatePresetButtonsUI();
      applyEqGains(0.05);
      updateEqUIValues();
      saveState();
    });
    el.eqBands.appendChild(vBand);
  });
}

function updatePresetButtonsUI(){
  if (!el.eqPresetRow) return;
  const btns = el.eqPresetRow.querySelectorAll("button");
  btns.forEach(b => {
    b.classList.toggle("active", b.textContent === state.eqState.preset);
  });
}

function updateEqUIValues(){
  state.eqState.gains.forEach((g, idx) => {
    const slider = document.getElementById(`eqSlider_${idx}`);
    const valDisp = document.getElementById(`eqVal_${idx}`);
    if(slider) slider.value = g;
    if(valDisp) valDisp.textContent = (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1)) + "dB";
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

function renderAll(){
  renderSongList();
  renderQueue();
  renderPlaylists();
  renderStats();
}

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
