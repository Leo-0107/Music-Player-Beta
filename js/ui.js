import { state, el, escapeHTML } from "./state.js";
import { saveState } from "./storage.js";
import { getVisibleSongs, toggleFav, addToQueue } from "./library.js";

export function setupSongNameScroll(element) {
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
        <button class="delTrackBtn">🗑</button>
      </div>
    `;

    const addPlBtn = row.querySelector(".addPlBtn");
    const queueBtn = row.querySelector(".queueBtn");
    const starBtn = row.querySelector(".starBtn");
    const delTrackBtn = row.querySelector(".delTrackBtn");

    addPlBtn?.addEventListener("click", e => {
      e.stopPropagation();
      if (typeof window.addSongToPlaylist === "function") {
        window.addSongToPlaylist(song.name);
      }
    });

    queueBtn?.addEventListener("click", e => {
      e.stopPropagation();
      addToQueue(song.name);
      renderQueue();
    });

    starBtn?.addEventListener("click", e => {
      e.stopPropagation();
      toggleFav(song.name);
      renderSongList();
    });

    delTrackBtn?.addEventListener("click", e => {
      e.stopPropagation();
      if (typeof window.deleteSingleTrack === "function") {
        window.deleteSingleTrack(song);
      }
    });

    row.addEventListener("click", () => {
      if (typeof window.playSong === "function") {
        window.playSong(song);
      }
    });

    el.list.appendChild(row);
    setupSongNameScroll(row.querySelector(".songName"));
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
    const song = state.playlist.find(x => x.name === name);
    const row = document.createElement("div");
    row.className = "song";
    row.innerHTML = `
      <div class="songMain">
        <div class="songName">${escapeHTML(song ? song.title : name)}</div>
        <div class="songArtist">${escapeHTML(song ? song.artist : "不明")}</div>
      </div>
      <div class="songRight">
        <button class="btn small danger delQueueBtn">削除</button>
      </div>
    `;

    row.querySelector(".delQueueBtn")?.addEventListener("click", e => {
      e.stopPropagation();
      state.queue.splice(idx, 1);
      saveState();
      renderQueue();
    });

    row.addEventListener("click", () => {
      state.queue.splice(idx, 1);
      saveState();
      renderQueue();
      if (song && typeof window.playSong === "function") {
        window.playSong(song);
      }
    });

    el.queueList.appendChild(row);
    setupSongNameScroll(row.querySelector(".songName"));
  });
}

export function renderStats() {
  let totalPlays = 0;
  Object.values(state.playCounts).forEach(count => totalPlays += count);
  if (el.statPlays) el.statPlays.textContent = String(totalPlays);
  if (el.statSongs) el.statSongs.textContent = String(state.playlist.length);
  if (el.pillSongs) el.pillSongs.textContent = `${state.playlist.length}曲`;
  if (el.pillFavs) el.pillFavs.textContent = `${state.favorites.length}☆`;
}

export function bindUI() {
  if (el.search) {
    el.search.addEventListener("input", event => {
      state.search = event.target.value;
      renderSongList();
    });
  }

  if (el.btnMainShuffle) {
    el.btnMainShuffle.addEventListener("click", () => {
      state.shuffle = !state.shuffle;
      saveState();
      el.btnMainShuffle.classList.toggle("active", state.shuffle);
    });
    el.btnMainShuffle.classList.toggle("active", state.shuffle);
  }

  if (el.btnMainRepeat) {
    el.btnMainRepeat.addEventListener("click", () => {
      state.repeat = !state.repeat;
      saveState();
      el.btnMainRepeat.classList.toggle("active", state.repeat);
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
}
