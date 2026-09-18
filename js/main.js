import { state, el } from "./state.js";
import { loadJSON, saveState } from "./storage.js";
import { getVisibleSongs, toggleFav, addToQueue, shuffleQueue } from "./library.js";
import { renderSongList, renderQueue, renderStats, bindUI } from "./ui.js";

export async function initApp() {
  Object.assign(state, {
    favorites: loadJSON("mp_favs_v12", []),
    queue: loadJSON("mp_queue_v12", []),
    playCounts: loadJSON("mp_counts_v12", {}),
    playHistory: loadJSON("mp_history_v12", {}),
    playlists: loadJSON("mp_playlists_v12", {})
  });

  bindUI();
  renderSongList();
  renderQueue();
  renderStats();

  if (el.btnPlay) {
    el.btnPlay.addEventListener("click", () => {
      if (!state.currentSong && state.playlist.length) {
        state.currentSong = state.playlist[0];
      }
      if (state.currentSong) {
        if (document.querySelector("audio")?.paused) {
          document.querySelector("audio")?.play().catch(() => {});
        } else {
          document.querySelector("audio")?.pause();
        }
      }
    });
  }

  if (el.btnMainShuffle) {
    el.btnMainShuffle.classList.toggle("active", state.shuffle);
  }
  if (el.btnMainRepeat) {
    el.btnMainRepeat.classList.toggle("active", state.repeat);
  }
}

initApp();
