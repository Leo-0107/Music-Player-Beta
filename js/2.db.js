// js/db.js
const dbName = "Music Player v3.8";
let db = null;

function cleanUpObjectURLs() {
  const currentName = state.currentSong?.name;
  for (const [name, urls] of activeObjectURLMap.entries()) {
    if (name !== currentName) {
      if (urls.url) URL.revokeObjectURL(urls.url);
      if (urls.coverUrl) URL.revokeObjectURL(urls.coverUrl);
      activeObjectURLMap.delete(name);
    }
  }
}

function revokeAllObjectURLs() {
  for (const [name, urls] of activeObjectURLMap.entries()) {
    if (urls.url) URL.revokeObjectURL(urls.url);
    if (urls.coverUrl) URL.revokeObjectURL(urls.coverUrl);
  }
  activeObjectURLMap.clear();
}

function initDB() {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains("tracks")) d.createObjectStore("tracks", { keyPath: "name" });
      };
      req.onsuccess = e => { db = e.target.result; resolve(); };
      req.onerror = () => {
        toast("データベースの接続に失敗しました");
        resolve();
      };
    } catch (e) {
      toast("IndexedDBがサポートされていないかアクセスできません");
      resolve();
    }
  });
}

function saveTrackToDB(trackData) {
  if (!db) return;
  try {
    const tx = db.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(trackData);
    tx.onerror = () => toast("トラックの保存中にエラーが発生しました");
  } catch (e) {}
}

function deleteTrackFromDB(name) {
  return new Promise(resolve => {
    if (!db) return resolve();
    try {
      const tx = db.transaction("tracks", "readwrite");
      tx.objectStore("tracks").delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        toast("トラックの削除に失敗しました");
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

function loadTracksFromDB() {
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