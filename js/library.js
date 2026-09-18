export function getVisibleSongs() {
  let list = [...state.playlist];
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(song => {
      const title = (song.title || "").toLowerCase();
      const artist = (song.artist || "").toLowerCase();
      const name = (song.name || "").toLowerCase();
      return title.includes(q) || artist.includes(q) || name.includes(q);
    });
  }
  if (state.favOnly) {
    list = list.filter(song => state.favorites.includes(song.name));
  }
  return list;
}

export function toggleFav(name) {
  if (!name) return;
  const idx = state.favorites.indexOf(name);
  if (idx >= 0) state.favorites.splice(idx, 1);
  else state.favorites.push(name);
  saveState();
}

export function addToQueue(name) {
  if (!name) return;
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
