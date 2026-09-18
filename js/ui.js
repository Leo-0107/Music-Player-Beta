import { state, el, escapeHTML } from "./state.js";
import { saveState } from "./storage.js";
import { getVisibleSongs, toggleFav, addToQueue } from "./library.js";

export function renderSongList() {
  if (!el.list) return;
  const vis = getVisibleSongs();
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
      </div>
    `;
    row.querySelector(".queueBtn").addEventListener("click", e => { e.stopPropagation(); addToQueue(song.name); });
    row.querySelector(".starBtn").addEventListener("click", e => { e.stopPropagation(); toggleFav(song.name); renderSongList(); });
    row.addEventListener("click", () => { if (song) {} });
    el.list.appendChild(row);
  });
}

export function renderQueue() {
  if (!el.queueList) return;
  el.queueList.innerHTML = "";
  if (!state.queue.length) {
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
    el.queueList.appendChild(row);
  });
}

export function renderStats() {
  let totalPlays = 0;
  Object.values(state.playCounts).forEach(c => totalPlays += c);
  if (el.statPlays) el.statPlays.textContent = totalPlays;
  if (el.statSongs) el.statSongs.textContent = state.playlist.length;
  if (el.pillSongs) el.pillSongs.textContent = `${state.playlist.length}曲`;
  if (el.pillFavs) el.pillFavs.textContent = `${state.favorites.length}☆`;
}

export function bindUI() {
  if (el.search) {
    el.search.addEventListener("input", e => {
      state.search = e.target.value;
      renderSongList();
    });
  }
  if (el.btnMainShuffle) {
    el.btnMainShuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      saveState();
      el.btnMainShuffle.classList.toggle("active", state.shuffle);
    });
  }
  if (el.btnMainRepeat) {
    el.btnMainRepeat.addEventListener("click", () => {
      state.repeat = !state.repeat;
      saveState();
      el.btnMainRepeat.classList.toggle("active", state.repeat);
    });
  }
}
