import { STORAGE, state } from "./state.js";

export function loadJSON(k, fallback) {
  try {
    const r = localStorage.getItem(k);
    return r ? JSON.parse(r) : fallback;
  } catch {
    return fallback;
  }
}

export function loadBool(k, fallback) {
  const r = localStorage.getItem(k);
  return r === null ? fallback : r === "true";
}

export function loadNum(k, fallback) {
  const r = localStorage.getItem(k);
  const n = Number(r);
  return Number.isFinite(n) ? n : fallback;
}

export function loadStr(k, fallback) {
  const r = localStorage.getItem(k);
  return r === null ? fallback : r;
}

export function saveState() {
  localStorage.setItem(STORAGE.favorites, JSON.stringify(state.favorites));
  localStorage.setItem(STORAGE.queue, JSON.stringify(state.queue));
  localStorage.setItem(STORAGE.playCounts, JSON.stringify(state.playCounts));
  localStorage.setItem(STORAGE.playHistory, JSON.stringify(state.playHistory));
  localStorage.setItem(STORAGE.eqState, JSON.stringify(state.eqState));
  localStorage.setItem(STORAGE.pitch, String(state.pitchSemitones));
  localStorage.setItem(STORAGE.shuffle, String(state.shuffle));
  localStorage.setItem(STORAGE.repeat, String(state.repeat));
  localStorage.setItem(STORAGE.favOnly, String(state.favOnly));
  localStorage.setItem(STORAGE.themeMode, state.themeMode);
  localStorage.setItem(STORAGE.customTheme, JSON.stringify(state.customTheme));
  localStorage.setItem(STORAGE.playlists, JSON.stringify(state.playlists));
  localStorage.setItem(STORAGE.crossfade, String(state.crossfade));
  localStorage.setItem(STORAGE.silenceSkip, String(state.silenceSkip));
  localStorage.setItem(STORAGE.dMode, state.dMode);
  localStorage.setItem(STORAGE.waveMode, state.waveMode);
}

export let db = null;
export const activeObjectURLMap = new Map();

export function initDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open("Music Player v3.8", 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks", { keyPath: "name" });
      };
      req.onsuccess = e => { db = e.target.result; resolve(); };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function saveTrackToDB(trackData) {
  if (!db) return;
  try {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(trackData);
  } catch {}
}

export function deleteTrackFromDB(name) {
  return new Promise(resolve => {
    if (!db) return resolve();
    try {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function loadTracksFromDB() {
  return new Promise(resolve => {
    if (!db) return resolve([]);
    try {
      const tx = db.transaction("tracks", "readonly");
      const req = tx.objectStore("tracks").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export function parseID3(file) {
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
          const frameID = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
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

function decodeID3String(byteArray) {
  if (!byteArray || !byteArray.length) return "";
  const encoding = byteArray[0];
  const data = byteArray.subarray(1);
  try {
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder("utf-16").decode(data).replace(/\0/g, "").trim();
    }
    return new TextDecoder("utf-8").decode(data).replace(/\0/g, "").trim();
  } catch {
    return "";
  }
}
