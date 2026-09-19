function decodeID3String(byteArray) {
  if (!byteArray || !byteArray.length) return "";
  const encoding = byteArray[0];
  const data = byteArray.subarray(1);
  try {
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder("utf-16").decode(data).replace(/\0/g, '').trim();
    } else {
      return new TextDecoder("utf-8").decode(data).replace(/\0/g, '').trim();
    }
  } catch {
    return "";
  }
}

function parseID3(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const buf = e.target.result;
      const view = new DataView(buf);
      let title = file.name.replace(/\.[^/.]+$/, "");
      let artist = "不明なアーティスト";
      let coverBlob = null;

      if (buf.byteLength > 10 && view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
        let offset = 10;
        const size = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9);
        while (offset < size + 10 && offset + 10 <= buf.byteLength) {
          const frameID = String.fromCharCode(view.getUint8(offset), view.getUint8(offset+1), view.getUint8(offset+2), view.getUint8(offset+3));
          const frameSize = view.getUint32(offset + 4);
          if (frameSize <= 0 || offset + 10 + frameSize > buf.byteLength) break;
          const frameData = new Uint8Array(buf, offset + 10, frameSize);
          
          try {
            if (frameID === "TIT2") {
              title = decodeID3String(frameData) || title;
            } else if (frameID === "TPE1") {
              artist = decodeID3String(frameData) || artist;
            } else if (frameID === "APIC") {
              const encoding = frameData[0];
              let p = 1;
              while (p < frameData.length && frameData[p] !== 0) p++;
              const mime = new TextDecoder("ascii").decode(frameData.subarray(1, p)) || "image/jpeg";
              let imgStart = p + 2;
              if (encoding === 1 || encoding === 2) {
                while (imgStart < frameData.length - 1) {
                  if (frameData[imgStart] === 0 && frameData[imgStart + 1] === 0) {
                    imgStart += 2;
                    break;
                  }
                  imgStart += 2;
                }
              } else {
                while (imgStart < frameData.length && frameData[imgStart] !== 0) imgStart++;
                imgStart += 1;
              }
              if (imgStart < frameData.length) {
                coverBlob = new Blob([frameData.subarray(imgStart)], { type: mime });
              }
            }
          } catch {}
          offset += 10 + frameSize;
        }
      }
      resolve({ title, artist, coverBlob });
    };
    reader.onerror = () => resolve({ title: file.name.replace(/\.[^/.]+$/, ""), artist: "不明なアーティスト", coverBlob: null });
    reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
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
