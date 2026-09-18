// js/main.js
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

if (el.waveModeBtns) {
  el.waveModeBtns.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => setWaveMode(btn.dataset.wave));
  });
}

if (el.dModeBtns) {
  el.dModeBtns.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => setDMode(btn.dataset.d));
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if(state.themeMode === "system") applyTheme();
});

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

if (el.btnEqReset) {
  el.btnEqReset.addEventListener("click", () => {
    state.eqState.preset = "Normal";
    animateEqPreset([0,0,0,0,0]);
    updatePresetButtonsUI();
  });
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

if (el.folder) {
  el.folder.addEventListener("change", e => {
    loadFiles(e.target.files);
    el.folder.value = "";
  });
}

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

if (el.btnClosePlModal) el.btnClosePlModal.addEventListener("click", hidePlAlertModal);
if (el.plAlertModal) el.plAlertModal.addEventListener("click", e => { if(e.target === el.plAlertModal) hidePlAlertModal(); });

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

window.addEventListener("resize", () => {
  clearTimeout(songListResizeTimer);
  songListResizeTimer = setTimeout(() => {
    document.querySelectorAll(".songName").forEach(setupSongNameScroll);
    document.querySelectorAll(".plTitleText").forEach(setupPlNameScroll);
  }, 120);
});

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

function setSleepTimer(minutes) {
  if (sleepTimerId) clearTimeout(sleepTimerId);
  if (sleepIntervalId) clearInterval(sleepIntervalId);

  if (minutes === "off" || minutes <= 0) {
    if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
    toast("スリープタイマーを解除しました");
    return;
  }

  const ms = minutes * 60 * 1000;
  sleepTimerEnd = Date.now() + ms;

  const updateTimerText = () => {
    const remain = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
    if (remain <= 0) {
      if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
      clearInterval(sleepIntervalId);
      return;
    }
    const m = Math.floor(remain / 60);
    const s = remain % 60;
    if (el.timerStatus) el.timerStatus.textContent = `自動停止まで: ${m}分${s}秒`;
  };

  updateTimerText();
  sleepIntervalId = setInterval(updateTimerText, 1000);

  sleepTimerId = setTimeout(() => {
    audio.pause();
    releaseWakeLock();
    toast("スリープタイマーにより再生を停止しました");
    if (el.timerStatus) el.timerStatus.textContent = "タイマーOFF";
  }, ms);

  toast(`${minutes}分後に自動停止します`);
}

document.querySelectorAll("[data-timer]").forEach(btn => {
  btn.addEventListener("click", () => {
    const t = btn.dataset.timer;
    if (t === "off") setSleepTimer("off");
    else setSleepTimer(Number(t));
  });
});

if (el.btnSetCustomTimer && el.customTimerInput) {
  el.btnSetCustomTimer.addEventListener("click", () => {
    const v = Number(el.customTimerInput.value);
    if (v > 0) setSleepTimer(v);
  });
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