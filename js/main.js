import { state, el } from "./state.js";
import { loadJSON } from "./storage.js";
import { audio, ensureGraph, applyPitchAndRate, updateVolumeUI } from "./audio.js";
import { renderSongList, renderQueue, renderStats, bindUI } from "./ui.js";

export async function initApp() {
  Object.assign(state, {
    favorites: loadJSON("mp_favs_v12", []),
    queue: loadJSON("mp_queue_v12", []),
    playCounts: loadJSON("mp_counts_v12", {}),
    playHistory: loadJSON("mp_history_v12", {}),
    playlists: loadJSON("mp_playlists_v12", {})
  });

  ensureGraph();
  applyPitchAndRate();
  updateVolumeUI(1);

  bindUI();
  renderSongList();
  renderQueue();
  renderStats();

  if (el.btnPlay) {
    el.btnPlay.addEventListener("click", () => {
      if (!state.currentSong && state.playlist.length) {
        state.currentSong = state.playlist[0];
      }
      if (!state.currentSong) return;
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
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
