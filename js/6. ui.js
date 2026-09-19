// ui.js - UI管理および描画ロジック

// タイトルテキストの画面内判定用Observer
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

// スクロールコンテナの監視開始
document.querySelectorAll(".scroll-container").forEach(c => titleObserver.observe(c));

// タブの表示/非表示状態の切り替え制御
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

// タイトルのスクロールアニメーション設定
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

// 時間フォーマット（秒 -> mm:ss）
function fmtTime(sec){
  if(!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// トースト通知表示
function toast(msg){
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("show"), 1400);
}

// テーマ適用処理
function applyTheme(){
  document.body.classList.remove("theme-light");
  if (el.btnThemeSystem) el.btnThemeSystem.classList.remove("active");
  if (el.btnThemeDark) el.btnThemeDark.classList.remove("active");
  if (el.btnThemeLight) el.btnThemeLight.classList.remove("active");
  if (el.btnThemeCustom) el.btnThemeCustom.classList.remove("active");

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

// OSのダークモード変更イベント検知
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if(state.themeMode === "system") applyTheme();
});

// カラーピッカー描画
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
    if (opt.dataset.deg === (state.customTheme.dir || "180deg")) {
      opt.classList.add("selected");
    } else {
      opt.classList.remove("selected");
    }
    const preview = opt.querySelector(".gradPreview");
    if (preview) preview.style.background = `linear-gradient(${opt.dataset.deg}, ${previewC1} 0%, ${previewC2} 100%)`;
  });
}

// グラデーション方向クリック
document.querySelectorAll(".gradOption").forEach(opt => {
  opt.addEventListener("click", () => {
    state.customTheme.dir = opt.dataset.deg;
    saveState();
    applyTheme();
    renderColorPickers();
  });
});

// 明度スライダーイベント設定
if (el.sliderL1) {
  el.sliderL1.addEventListener("input", () => {
    const val = Number(el.sliderL1.value);
    state.customTheme.l1 = val;
    if (el.txtL1) el.txtL1.textContent = `${val}%`;
    saveState();
    applyTheme();
  });
}

if (el.sliderL2) {
  el.sliderL2.addEventListener("input", () => {
    const val = Number(el.sliderL2.value);
    state.customTheme.l2 = val;
    if (el.txtL2) el.txtL2.textContent = `${val}%`;
    saveState();
    applyTheme();
  });
}

if (el.sliderLText) {
  el.sliderLText.addEventListener("input", () => {
    const val = Number(el.sliderLText.value);
    state.customTheme.lText = val;
    if (el.txtLText) el.txtLText.textContent = `${val}%`;
    saveState();
    applyTheme();
  });
}

// アートワーク画像を描画
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

    if (song && song.coverUrl) {
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

// 楽曲要素の再生回数表示のみ更新
function updateSongItemPlayCountUI(songName, count) {
  if (!el.list) return;
  const songRows = el.list.querySelectorAll(".song");
  for (let i = 0; i < songRows.length; i++) {
    if (songRows[i].dataset.name === songName) {
      const metaEl = songRows[i].querySelector(".songMeta");
      if (metaEl) {
        metaEl.textContent = `再生数 ${count}回`;
      }
      break;
    }
  }
}

// 再生/停止状態のボタンUI更新
function updatePlayPauseUI(){
  const isPlaying = !audio.paused && audio.src;
  if (el.btnPlay) {
    el.btnPlay.textContent = isPlaying ? "❚❚ 一時停止" : "▶ 再生";
    if (isPlaying) {
      el.btnPlay.classList.add("playing");
    } else {
      el.btnPlay.classList.remove("playing");
    }
  }
  if (el.miniPlay) {
    el.miniPlay.textContent = isPlaying ? "❚❚" : "▶";
    if (isPlaying) {
      el.miniPlay.classList.add("playing");
    } else {
      el.miniPlay.classList.remove("playing");
    }
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

// 現在再生中の曲表示UI更新
function updateNowPlayingUI(song){
  if(song){
    updateTitleTextAndScroll(el.nowTitle, song.title);
    updateTitleTextAndScroll(el.miniTitle, song.title);
    updateTitleTextAndScroll(el.nowSub, song.artist);
    if (el.btnFav) {
      el.btnFav.textContent = state.favorites.includes(song.name) ? "★" : "☆";
      if (state.favorites.includes(song.name)) {
        el.btnFav.classList.add("active");
      } else {
        el.btnFav.classList.remove("active");
      }
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
  
  if (el.list) {
    const rows = el.list.querySelectorAll(".song");
    rows.forEach(n => {
      if (song && n.dataset.name === song.name) {
        n.classList.add("active");
      } else {
        n.classList.remove("active");
      }
    });
  }
  
  updatePlayPauseUI();
}

// 音量UIとGainの連動更新
function updateVolumeUI(targetVal, isMuteAction = false) {
  const prevVol = currentVolumeTarget;
  currentVolumeTarget = Math.max(0, targetVal);
  if (el.volume) el.volume.value = currentVolumeTarget;
  if (el.volText) el.volText.textContent = `${Math.round(currentVolumeTarget * 100)}%`;
  
  if (el.btnMuteToggle) {
    if (currentVolumeTarget === 0) {
      el.btnMuteToggle.textContent = "🔇";
    } else if (currentVolumeTarget < 0.5) {
      el.btnMuteToggle.textContent = "🔉";
    } else {
      el.btnMuteToggle.textContent = "🔊";
    }
  }

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

// イコライザーUIの生成と描画
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
    
    const vVal = document.createElement("div");
    vVal.className = "vVal";
    vVal.id = `eqVal_${idx}`;
    vVal.textContent = (gainVal > 0 ? "+" + gainVal.toFixed(1) : gainVal.toFixed(1)) + "dB";
    
    const vTrack = document.createElement("div");
    vTrack.className = "vTrack";
    
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "vSlider";
    slider.id = `eqSlider_${idx}`;
    slider.min = "-12";
    slider.max = "12";
    slider.step = "0.5";
    slider.value = gainVal;

    vTrack.appendChild(slider);

    const lblSpan = document.createElement("span");
    lblSpan.style.fontSize = ".75rem";
    lblSpan.style.color = "var(--muted)";
    lblSpan.style.marginTop = "4px";
    lblSpan.textContent = lbl;

    vBand.appendChild(vVal);
    vBand.appendChild(vTrack);
    vBand.appendChild(lblSpan);

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

// プリセットボタンの選択状態UI更新
function updatePresetButtonsUI(){
  if (!el.eqPresetRow) return;
  const btns = el.eqPresetRow.querySelectorAll("button");
  btns.forEach(b => {
    if (b.textContent === state.eqState.preset) {
      b.classList.add("active");
    } else {
      b.classList.remove("active");
    }
  });
}

// スライダーとdB数値表示の更新
function updateEqUIValues(){
  state.eqState.gains.forEach((g, idx) => {
    const slider = document.getElementById(`eqSlider_${idx}`);
    const valDisp = document.getElementById(`eqVal_${idx}`);
    if(slider) slider.value = g;
    if(valDisp) valDisp.textContent = (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1)) + "dB";
  });
}

// モーダル表示/非表示関数群
function showPlAlertModal() { if (el.plAlertModal) el.plAlertModal.classList.add("show"); }
function hidePlAlertModal() { if (el.plAlertModal) el.plAlertModal.classList.remove("show"); }
if (el.btnClosePlModal) el.btnClosePlModal.addEventListener("click", hidePlAlertModal);
if (el.plAlertModal) el.plAlertModal.addEventListener("click", e => { if(e.target === el.plAlertModal) hidePlAlertModal(); });

function showShortcutModal() { if (el.shortcutModal) el.shortcutModal.classList.add("show"); }
function hideShortcutModal() { if (el.shortcutModal) el.shortcutModal.classList.remove("show"); }
if (el.btnShortcutHelp) el.btnShortcutHelp.addEventListener("click", showShortcutModal);
if (el.btnCloseShortcutModal) el.btnCloseShortcutModal.addEventListener("click", hideShortcutModal);
if (el.shortcutModal) el.shortcutModal.addEventListener("click", e => { if(e.target === el.shortcutModal) hideShortcutModal(); });

// プレイリスト名スクロール初期化
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

// プレイリスト一覧の描画
function renderPlaylists(){
  const containers = [];
  if (el.playlistContainer) containers.push(el.playlistContainer);
  const mainPlContainer = document.getElementById("playlistContainerMain");
  if (mainPlContainer) containers.push(mainPlContainer);

  if (!containers.length) return;

  containers.forEach(container => {
    container.innerHTML = "";
    const names = Object.keys(state.playlists);
    if(!names.length) {
      const emptyMsg = document.createElement("div");
      emptyMsg.style.color = "var(--muted)";
      emptyMsg.style.fontSize = ".86rem";
      emptyMsg.textContent = "プレイリストがありません";
      container.appendChild(emptyMsg);
      return;
    }

    names.forEach(pName => {
      const card = document.createElement("div");
      card.className = "sectionCard plCard";

      const tracksInPl = Array.isArray(state.playlists[pName]) ? state.playlists[pName] : [];
      state.playlists[pName] = tracksInPl;

      const row1 = document.createElement("div");
      row1.className = "plRow1";

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "btn small ghost plToggleBtn";
      toggleBtn.type = "button";
      toggleBtn.setAttribute("aria-expanded", "false");
      toggleBtn.title = "曲を表示";
      toggleBtn.textContent = `▶ 曲一覧 (${tracksInPl.length})`;

      const titleContainer = document.createElement("div");
      titleContainer.className = "plTitleContainer";

      const titleText = document.createElement("div");
      titleText.className = "plTitleText";
      titleText.title = pName;
      titleText.textContent = pName;
      titleContainer.appendChild(titleText);

      const delBtn = document.createElement("button");
      delBtn.className = "btn small ghost delPlBtn";
      delBtn.type = "button";
      delBtn.title = "プレイリストを削除";
      delBtn.textContent = "✕";

      row1.appendChild(toggleBtn);
      row1.appendChild(titleContainer);
      row1.appendChild(delBtn);

      const row2 = document.createElement("div");
      row2.className = "plRow2";

      const bulkAddBtn = document.createElement("button");
      bulkAddBtn.className = "btn small bulkAddPlBtn";
      bulkAddBtn.type = "button";
      bulkAddBtn.textContent = "＋一覧から追加";

      const renameBtn = document.createElement("button");
      renameBtn.className = "btn small renamePlBtn";
      renameBtn.type = "button";
      renameBtn.textContent = "名前変更";

      const playAllBtn = document.createElement("button");
      playAllBtn.className = "btn small playPlBtn";
      playAllBtn.type = "button";
      playAllBtn.textContent = "▶ 全曲再生";

      row2.appendChild(bulkAddBtn);
      row2.appendChild(renameBtn);
      row2.appendChild(playAllBtn);

      card.appendChild(row1);
      card.appendChild(row2);

      const listDiv = document.createElement("div");
      listDiv.className = "plTrackList collapsed";

      if (!tracksInPl.length) {
        const noTrackMsg = document.createElement("div");
        noTrackMsg.style.color = "var(--muted)";
        noTrackMsg.style.fontSize = ".78rem";
        noTrackMsg.textContent = "曲がありません";
        listDiv.appendChild(noTrackMsg);
      } else {
        tracksInPl.forEach((songName, idx) => {
          const found = state.playlist.find(x => x.name === songName);
          const row = document.createElement("div");
          row.className = "plTrackItem";

          const titleSpan = document.createElement("span");
          titleSpan.style.overflow = "hidden";
          titleSpan.style.textOverflow = "ellipsis";
          titleSpan.style.whiteSpace = "nowrap";
          titleSpan.style.flex = "1";

          if (!found) {
            const warnSpan = document.createElement("span");
            warnSpan.style.color = "#f8d25c";
            warnSpan.style.marginRight = "4px";
            warnSpan.title = "ファイルが見つかりません";
            warnSpan.textContent = "▲ ";
            titleSpan.appendChild(warnSpan);
          }

          const strongTitle = document.createElement("strong");
          strongTitle.textContent = found ? found.title : songName.replace(/\.[^/.]+$/, '');
          titleSpan.appendChild(strongTitle);

          const actionDiv = document.createElement("div");
          actionDiv.style.display = "flex";
          actionDiv.style.gap = "6px";
          actionDiv.style.alignItems = "center";

          const playTrackBtn = document.createElement("button");
          playTrackBtn.className = "btn small playPlTrackBtn";
          playTrackBtn.type = "button";
          playTrackBtn.style.padding = "2px 8px";
          playTrackBtn.textContent = "▶";

          const removeSongBtn = document.createElement("button");
          removeSongBtn.className = "btn small ghost removePlSongBtn";
          removeSongBtn.type = "button";
          removeSongBtn.style.padding = "2px 6px";
          removeSongBtn.textContent = "✕";

          actionDiv.appendChild(playTrackBtn);
          actionDiv.appendChild(removeSongBtn);

          row.appendChild(titleSpan);
          row.appendChild(actionDiv);

          playTrackBtn.addEventListener("click", e => {
            e.stopPropagation();
            if (found) playSong(found);
          });
          row.addEventListener("click", () => {
            if (found) playSong(found);
          });
          removeSongBtn.addEventListener("click", e => {
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
        if (willOpen) {
          listDiv.classList.remove("collapsed");
        } else {
          listDiv.classList.add("collapsed");
        }
        toggleBtn.textContent = willOpen ? `▼ 曲一覧 (${tracksInPl.length})` : `▶ 曲一覧 (${tracksInPl.length})`;
        toggleBtn.setAttribute("aria-expanded", String(willOpen));
        toggleBtn.title = willOpen ? "曲を隠す" : "曲を表示";
      };

      toggleBtn.addEventListener("click", e => {
        e.stopPropagation();
        toggleList();
      });
      titleText.addEventListener("click", toggleList);

      bulkAddBtn.addEventListener("click", e => {
        e.stopPropagation();
        openBulkAddForPlaylist(pName);
      });

      playAllBtn.addEventListener("click", e => {
        e.stopPropagation();
        const songObjects = state.playlists[pName].map(n => state.playlist.find(x => x.name === n)).filter(Boolean);
        if(songObjects.length) {
          playSong(songObjects[0]);
        } else {
          toast("このプレイリストに再生できる曲がありません");
        }
      });

      renameBtn.addEventListener("click", e => {
        e.stopPropagation();
        const newName = prompt("新しいプレイリスト名を入力してください:", pName);
        if(newName !== null) {
          const trimmed = newName.trim();
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
        }
      });

      delBtn.addEventListener("click", e => {
        e.stopPropagation();
        if (!confirm(`プレイリスト「${pName}」を削除しますか？`)) return;
        delete state.playlists[pName];
        saveState();
        renderPlaylists();
      });

      container.appendChild(card);
      setupPlNameScroll(titleText);
    });
  });
}

// プレイリスト選択ボトムシート表示
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
    
    const nameDiv = document.createElement("div");
    nameDiv.style.fontWeight = "600";
    nameDiv.textContent = pName;
    
    const countDiv = document.createElement("div");
    countDiv.style.color = "var(--muted)";
    countDiv.style.fontSize = ".82rem";
    countDiv.textContent = `${count}曲`;

    item.appendChild(nameDiv);
    item.appendChild(countDiv);

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

// 楽曲名スクロール初期化
function setupSongNameScroll(element) {
  if (!element) return;

  element.classList.remove("songNameScrolling");
  element.style.removeProperty("--song-scroll-dist");
  element.style.removeProperty("--song-scroll-duration");

  requestAnimationFrame(() => {
    const available = element.parentElement ? element.parentElement.clientWidth : 0;
    const overflow = element.scrollWidth - available;
    if (overflow > 8) {
      element.style.setProperty("--song-scroll-dist", `-${overflow + 18}px`);
      element.style.setProperty("--song-scroll-duration", `${Math.max(7, Math.min(18, overflow / 12 + 6))}s`);
      element.classList.add("songNameScrolling");
    }
  });
}

// 楽曲メインリストの描画
function renderSongList(){
  const vis = getVisibleSongs();
  if (!el.list) return;
  el.list.innerHTML = "";
  vis.forEach(song => {
    const row = document.createElement("div");
    row.className = "song" + (state.currentSong && song.name === state.currentSong.name ? " active" : "");
    row.dataset.name = song.name;

    const mainDiv = document.createElement("div");
    mainDiv.className = "songMain";

    const nameDiv = document.createElement("div");
    nameDiv.className = "songName";
    nameDiv.textContent = song.title;

    const artistDiv = document.createElement("div");
    artistDiv.className = "songArtist";
    artistDiv.textContent = song.artist;

    const metaDiv = document.createElement("div");
    metaDiv.className = "songMeta";
    metaDiv.textContent = `再生数 ${state.playCounts[song.name] || 0}回`;

    mainDiv.appendChild(nameDiv);
    mainDiv.appendChild(artistDiv);
    mainDiv.appendChild(metaDiv);

    const rightDiv = document.createElement("div");
    rightDiv.className = "songRight";

    const addPlBtn = document.createElement("button");
    addPlBtn.className = "addPlBtn";
    addPlBtn.textContent = "リスト追加";

    const queueBtn = document.createElement("button");
    queueBtn.className = "queueBtn";
    queueBtn.textContent = "＋キュー";

    const starBtn = document.createElement("button");
    const isFav = state.favorites.includes(song.name);
    starBtn.className = "starBtn" + (isFav ? " active" : "");
    starBtn.textContent = isFav ? "★" : "☆";

    const delTrackBtn = document.createElement("button");
    delTrackBtn.className = "delTrackBtn";
    delTrackBtn.textContent = "🗑";

    rightDiv.appendChild(addPlBtn);
    rightDiv.appendChild(queueBtn);
    rightDiv.appendChild(starBtn);
    rightDiv.appendChild(delTrackBtn);

    row.appendChild(mainDiv);
    row.appendChild(rightDiv);

    addPlBtn.addEventListener("click", e => { e.stopPropagation(); addSongToPlaylist(song.name); });
    queueBtn.addEventListener("click", e => { e.stopPropagation(); addToQueue(song.name); });
    starBtn.addEventListener("click", e => { e.stopPropagation(); toggleFav(song.name); });
    delTrackBtn.addEventListener("click", e => { e.stopPropagation(); deleteSingleTrack(song); });
    row.addEventListener("click", () => playSong(song));

    el.list.appendChild(row);
    setupSongNameScroll(nameDiv);
  });
}

// リサイズ時のスクロール再計算タイマー
let songListResizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(songListResizeTimer);
  songListResizeTimer = setTimeout(() => {
    document.querySelectorAll(".songName").forEach(setupSongNameScroll);
    document.querySelectorAll(".plTitleText").forEach(setupPlNameScroll);
  }, 120);
});

// 再生キューの描画
function renderQueue(){
  if (!el.queueList) return;
  el.queueList.innerHTML = "";
  if(!state.queue.length){
    const emptyMsg = document.createElement("div");
    emptyMsg.style.color = "var(--muted)";
    emptyMsg.style.fontSize = ".86rem";
    emptyMsg.textContent = "キューは空です";
    el.queueList.appendChild(emptyMsg);
    return;
  }
  state.queue.forEach((name, idx) => {
    const s = state.playlist.find(x => x.name === name);
    const row = document.createElement("div");
    row.className = "song";

    const mainDiv = document.createElement("div");
    mainDiv.className = "songMain";

    const nameDiv = document.createElement("div");
    nameDiv.className = "songName";
    nameDiv.textContent = s ? s.title : name;

    const artistDiv = document.createElement("div");
    artistDiv.className = "songArtist";
    artistDiv.textContent = s ? s.artist : "不明";

    mainDiv.appendChild(nameDiv);
    mainDiv.appendChild(artistDiv);

    const rightDiv = document.createElement("div");
    rightDiv.className = "songRight";

    const delQueueBtn = document.createElement("button");
    delQueueBtn.className = "btn small danger delQueueBtn";
    delQueueBtn.textContent = "削除";

    rightDiv.appendChild(delQueueBtn);

    row.appendChild(mainDiv);
    row.appendChild(rightDiv);

    delQueueBtn.addEventListener("click", e => {
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

// 統計画面（グラフ・各種数値）の描画
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

// 全UIの一括更新
function renderAll(){
  renderSongList();
  renderQueue();
  renderPlaylists();
  renderStats();
}

// サイドバー開閉操作
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

// サイドバーメニュー項目の切り替え
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

// ナビゲーションタブ切り替え
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
