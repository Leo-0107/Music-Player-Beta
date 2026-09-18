import { state, el, escapeHTML } from "./state.js";
import { saveState } from "./storage.js";

export function getVisibleSongs() {
  let list = [...state.playlist];
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(song => song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q) || song.name.toLowerCase().includes(q));
  }
  if (state.favOnly) {
    list = list.filter(song => state.favorites.includes(song.name));
  }
  return list;
}

export function toggleFav(name) {
  const idx = state.favorites.indexOf(name);
  if (idx >= 0) state.favorites.splice(idx, 1);
  else state.favorites.push(name);
  saveState();
}

export function addToQueue(name) {
  state.queue.push(name);
  saveState();
}

export function shuffleQueue() {
  for (let i = state.queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  }
  saveState();
}
