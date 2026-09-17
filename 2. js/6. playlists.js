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

