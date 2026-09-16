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

  function animateEqPreset(targetGains) {
    if(eqAnimId) cancelAnimationFrame(eqAnimId);
    
    const startGains = [...state.eqState.gains];
    const duration = 300;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      startGains.forEach((start, i) => {
        state.eqState.gains[i] = start + (targetGains[i] - start) * ease;
      });

      applyEqGains(0.05);
      updateEqUIValues();

      if (progress < 1) {
        eqAnimId = requestAnimationFrame(step);
      } else {
        state.eqState.gains = [...targetGains];
        applyEqGains(0.05);
        updateEqUIValues();
        saveState();
      }
    }

    eqAnimId = requestAnimationFrame(step);
  }

  function applyEqGains(timeConstant = 0.1){
    if(!filters.length) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    state.eqState.gains.forEach((g, i) => {
      if(filters[i]) {
        if(audioCtx) {
          filters[i].gain.setTargetAtTime(g, now, timeConstant);
        } else {
          filters[i].gain.value = g;
        }
      }
    });
  }

  if (el.btnEqReset) {
    el.btnEqReset.addEventListener("click", () => {
      state.eqState.preset = "Normal";
      animateEqPreset([0,0,0,0,0]);
      updatePresetButtonsUI();
    });
  }

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

