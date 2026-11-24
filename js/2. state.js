  }

  function parseOggCommentBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    const decodeBase64Bytes = value => {
      const normalized = String(value || "").replace(/\s+/g, "");
      if (!normalized || normalized.length > 12 * 1024 * 1024) return null;
      try {
        const binary = atob(normalized);
        const result = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
        return result;
      } catch {
        return null;
      }
    };

    const detectImageMime = (data, fallback = "") => {
      if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return "image/png";
      if (data.length >= 3 && data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return "image/jpeg";
      if (data.length >= 6 && String.fromCharCode(...data.subarray(0, 3)) === "GIF") return "image/gif";
      if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
      return String(fallback || "").toLowerCase().startsWith("image/") ? fallback : "application/octet-stream";
    };

    const parseFlacPicture = value => {
      const data = decodeBase64Bytes(value);
      if (!data || data.length < 32) return null;
      const pictureView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let position = 0;
      const readLength = () => {
        if (position + 4 > data.length) return null;
        const length = pictureView.getUint32(position, false);
        position += 4;
        if (length > data.length - position) return null;
        return length;
      };
      const pictureType = readLength();
      const mimeLength = readLength();
      if (pictureType === null || mimeLength === null) return null;
      const mime = new TextDecoder("utf-8").decode(data.subarray(position, position + mimeLength)).trim();
      position += mimeLength;
      const descriptionLength = readLength();
      if (descriptionLength === null) return null;
      position += descriptionLength;
      if (position + 16 > data.length) return null;
      position += 16;
      const imageLength = readLength();
      if (imageLength === null || imageLength === 0 || imageLength > data.length - position) return null;
      const imageData = data.subarray(position, position + imageLength);
      const detectedMime = detectImageMime(imageData, mime);
      if (!detectedMime.startsWith("image/")) return null;
      return new Blob([imageData], { type: detectedMime });
    };

    const parseCommentPacket = packet => {
      const data = new Uint8Array(packet);
      let offset;
      if (data.length >= 7 && data[0] === 0x03 &&
          String.fromCharCode(...data.subarray(1, 7)) === "vorbis") {
        offset = 7;
      } else if (data.length >= 8 &&
          String.fromCharCode(...data.subarray(0, 8)) === "OpusTags") {
        offset = 8;
      } else {
        return null;
      }

      const packetView = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const readLength = () => {
        if (offset + 4 > data.length) return null;
        const length = packetView.getUint32(offset, true);
        offset += 4;
        if (length > data.length - offset) return null;
        return length;
      };

      const vendorLength = readLength();
      if (vendorLength === null) return null;
      offset += vendorLength;
      if (offset + 4 > data.length) return null;
      const commentCount = packetView.getUint32(offset, true);
      offset += 4;
      if (commentCount > 20000) return null;

      let title = "";
      let pictureBase64 = "";
      let coverArtBase64 = "";
      let coverArtMime = "";
      const artists = [];
      const alternateArtists = [];
      let albumArtist = "";
      const decoder = new TextDecoder("utf-8");
      for (let i = 0; i < commentCount; i++) {
        const length = readLength();
        if (length === null) return null;
        let comment = decoder.decode(data.subarray(offset, offset + length));
        offset += length;
        if (i === 0) comment = comment.replace(/^\uFEFF/, "");
        const separator = comment.indexOf("=");
        if (separator <= 0) continue;
        const key = comment.slice(0, separator).trim().toUpperCase();
        const value = comment.slice(separator + 1).trim();
        if (!value) continue;

        if (key === "TITLE" && !title) title = value;
        else if (key === "METADATA_BLOCK_PICTURE" && !pictureBase64) pictureBase64 = value;
        else if (key === "COVERART" && !coverArtBase64) coverArtBase64 = value;
        else if (key === "COVERARTMIME" && !coverArtMime) coverArtMime = value;
        else if (key === "ARTIST") artists.push(value);
        else if ((key === "ARTISTS" || key === "PERFORMER") && !alternateArtists.includes(value)) {
          alternateArtists.push(value);
        } else if ((key === "ALBUMARTIST" || key === "ALBUM ARTIST") && !albumArtist) {
          albumArtist = value;
        }
      }

      let coverBlob = pictureBase64 ? parseFlacPicture(pictureBase64) : null;
      if (!coverBlob && coverArtBase64) {
        const imageData = decodeBase64Bytes(coverArtBase64);
        if (imageData?.length) {
          const mime = detectImageMime(imageData, coverArtMime || "image/jpeg");
          if (mime.startsWith("image/")) coverBlob = new Blob([imageData], { type: mime });
        }
      }
      const uniqueArtists = [...new Set(artists)];
      return {
        title,
        coverBlob,
        artist: uniqueArtists.length
          ? uniqueArtists.join(", ")
          : alternateArtists.length
            ? alternateArtists.join(", ")
            : albumArtist
      };
    };

    // Oggは複数の論理ストリームを同時に格納できるため、serial numberごとに
    // ページをまたぐパケットを再構成する。
    const streams = new Map();
    let pageOffset = 0;
    let bestMetadata = null;

    while (pageOffset + 27 <= bytes.length) {
      if (bytes[pageOffset] !== 0x4F || bytes[pageOffset + 1] !== 0x67 ||
          bytes[pageOffset + 2] !== 0x67 || bytes[pageOffset + 3] !== 0x53 ||
          bytes[pageOffset + 4] !== 0) break;

      const headerType = bytes[pageOffset + 5];
      const serial = view.getUint32(pageOffset + 14, true);
      const segmentCount = bytes[pageOffset + 26];
      const tableStart = pageOffset + 27;
      const payloadStart = tableStart + segmentCount;
      if (payloadStart > bytes.length) break;

      let stream = streams.get(serial);
      if (!stream || (headerType & 0x02)) {
        stream = { packetParts: [], packetLength: 0, completedPackets: 0, skipContinuation: false, done: false };
        streams.set(serial, stream);
      }

      if (!(headerType & 0x01)) {
        stream.packetParts = [];
        stream.packetLength = 0;
        stream.skipContinuation = false;
      } else if (!stream.packetParts.length && stream.packetLength === 0) {
        // 読み込み範囲の先頭が継続ページだった場合、途中からのパケットは捨てる。
        stream.skipContinuation = true;
      }

      let payloadOffset = payloadStart;
      let pageComplete = true;
      for (let i = 0; i < segmentCount; i++) {
        const segmentLength = bytes[tableStart + i];
        if (payloadOffset + segmentLength > bytes.length) {
          pageComplete = false;
          break;
        }

        const segment = bytes.subarray(payloadOffset, payloadOffset + segmentLength);
        payloadOffset += segmentLength;

        if (stream.done) continue;
        if (stream.skipContinuation) {
          if (segmentLength < 255) stream.skipContinuation = false;
          continue;
        }

        if (segmentLength) {
          stream.packetParts.push(segment);
          stream.packetLength += segmentLength;
        }

        if (segmentLength < 255) {
          const packet = new Uint8Array(stream.packetLength);
          let packetOffset = 0;
          for (const part of stream.packetParts) {
            packet.set(part, packetOffset);
            packetOffset += part.length;
          }

          const metadata = parseCommentPacket(packet);
          if (metadata) {
            if (metadata.artist) return metadata;
            if (!bestMetadata || (!bestMetadata.title && metadata.title)) bestMetadata = metadata;
          }

          stream.packetParts = [];
          stream.packetLength = 0;
          stream.completedPackets++;
          if (stream.completedPackets >= 64) stream.done = true;
        }
      }

      if (!pageComplete) break;
      pageOffset = payloadOffset;
    }

    return bestMetadata;
  }

  function parseID3(file) {
    return new Promise(resolve => {
      const defaultTitle = file.name.replace(/\.[^/.]+$/, "");
      const fallback = () => resolve({
        title: defaultTitle,
        artist: "不明なアーティスト",
        coverBlob: null
      });

      const parseBuffer = buf => {
        let title = defaultTitle;
        let artist = "不明なアーティスト";
        let coverBlob = null;

        if (buf.byteLength < 10) return { title, artist, coverBlob };
        const view = new DataView(buf);
        if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
          return { title, artist, coverBlob };
        }

        const majorVersion = view.getUint8(3);
        if (majorVersion !== 3 && majorVersion !== 4) return { title, artist, coverBlob };
        const tagFlags = view.getUint8(5);
        const tagSizeBytes = [view.getUint8(6), view.getUint8(7), view.getUint8(8), view.getUint8(9)];
        if (tagSizeBytes.some(byte => byte & 0x80)) return { title, artist, coverBlob };
        const tagSize = (tagSizeBytes[0] << 21) | (tagSizeBytes[1] << 14) | (tagSizeBytes[2] << 7) | tagSizeBytes[3];
        const tagEnd = Math.min(buf.byteLength, 10 + tagSize);
        let offset = 10;

        const readSyncsafe = position => {
          if (position + 4 > tagEnd) return null;
          const bytes = [view.getUint8(position), view.getUint8(position + 1), view.getUint8(position + 2), view.getUint8(position + 3)];
          if (bytes.some(byte => byte & 0x80)) return null;
          return (bytes[0] << 21) | (bytes[1] << 14) | (bytes[2] << 7) | bytes[3];
        };

        // ID3v2.3の拡張ヘッダーサイズは自身の4バイトを含まず、
        // ID3v2.4では4バイトを含む。どちらも境界を検証してから読み飛ばす。
        if (tagFlags & 0x40) {
          if (majorVersion === 3) {
            if (offset + 4 > tagEnd) return { title, artist, coverBlob };
            const extendedSize = view.getUint32(offset, false);
            const totalExtendedSize = 4 + extendedSize;
            if (extendedSize < 6 || offset + totalExtendedSize > tagEnd) return { title, artist, coverBlob };
            offset += totalExtendedSize;
          } else {
            const extendedSize = readSyncsafe(offset);
            if (extendedSize === null || extendedSize < 6 || offset + extendedSize > tagEnd) return { title, artist, coverBlob };
            offset += extendedSize;
          }
        }

        const deUnsynchronize = data => {
          const output = new Uint8Array(data.length);
          let write = 0;
          for (let i = 0; i < data.length; i++) {
            const value = data[i];
            output[write++] = value;
            if (value === 0xFF && data[i + 1] === 0x00 &&
                (i + 2 >= data.length || data[i + 2] === 0x00 || data[i + 2] >= 0xE0)) {
              i++;
            }
          }
          return output.subarray(0, write);
        };

        while (offset + 10 <= tagEnd) {
          const idBytes = [view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)];
          if (idBytes.every(byte => byte === 0)) break;
          const frameID = String.fromCharCode(...idBytes);
          if (!/^[A-Z0-9]{4}$/.test(frameID)) break;

          let frameSize;
          if (majorVersion === 4) {
            frameSize = readSyncsafe(offset + 4);
            if (frameSize === null) break;
          } else {
            frameSize = view.getUint32(offset + 4, false);
          }
          if (frameSize <= 0 || offset + 10 + frameSize > tagEnd) break;

          const formatFlags = view.getUint8(offset + 9);
          let frameData = new Uint8Array(buf, offset + 10, frameSize);
          offset += 10 + frameSize;

          // Unsynchronisationはフレームヘッダー直後から適用されるため、
          // グループ識別子やData Length Indicatorを取り除く前に元へ戻す。
          if ((majorVersion === 3 && (tagFlags & 0x80)) ||
              (majorVersion === 4 && ((tagFlags & 0x80) || (formatFlags & 0x02)))) {
            frameData = deUnsynchronize(frameData);
          }

          // 圧縮・暗号化フレームは復号できないため安全にスキップする。
          if (majorVersion === 3) {
            if (formatFlags & 0xC0) continue;
            if (formatFlags & 0x20) {
              if (!frameData.length) continue;
              frameData = frameData.subarray(1);
            }
          } else {
            if (formatFlags & 0x0C) continue;
            if (formatFlags & 0x40) {
              if (!frameData.length) continue;
              frameData = frameData.subarray(1);
            }
            if (formatFlags & 0x01) {
              if (frameData.length < 4) continue;
              frameData = frameData.subarray(4);
            }
          }

          try {
            if (frameID === "TIT2") {
              title = decodeID3String(frameData) || title;
            } else if (frameID === "TPE1") {
              artist = decodeID3String(frameData) || artist;
            } else if (frameID === "APIC") {
              const encoding = frameData[0];
              let p = 1;
              while (p < frameData.length && frameData[p] !== 0) p++;
              if (p >= frameData.length) continue;
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
        }
        return { title, artist, coverBlob };
      };

      const headerReader = new FileReader();
      headerReader.onload = event => {
        const header = event.target.result;
        if (header.byteLength < 10) {
          resolve(parseBuffer(header));
          return;
        }

        const view = new DataView(header);
        const isID3 = view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33;
        const isOgg = header.byteLength >= 4 &&
          view.getUint8(0) === 0x4F && view.getUint8(1) === 0x67 &&
          view.getUint8(2) === 0x67 && view.getUint8(3) === 0x53;
        if (isOgg) {
          const oggReader = new FileReader();
          oggReader.onload = oggEvent => {
            const metadata = parseOggCommentBuffer(oggEvent.target.result);
            resolve({
              title: metadata?.title || defaultTitle,
              artist: metadata?.artist || "不明なアーティスト",
              coverBlob: metadata?.coverBlob || null
            });
          };
          oggReader.onerror = fallback;
          const maxOggTagBytes = 8 * 1024 * 1024;
          const oggReadLength = Math.min(Number.isFinite(file.size) ? file.size : maxOggTagBytes, maxOggTagBytes);
          try {
            oggReader.readAsArrayBuffer(file.slice(0, oggReadLength));
          } catch {
            fallback();
          }
          return;
        }
        if (!isID3) {
          resolve(parseBuffer(header));
          return;
        }

        const sizeBytes = [view.getUint8(6), view.getUint8(7), view.getUint8(8), view.getUint8(9)];
        if (sizeBytes.some(byte => byte & 0x80)) {
          resolve(parseBuffer(header));
          return;
        }

        const tagSize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
        const availableSize = Number.isFinite(file.size) ? file.size : 10 + tagSize;
        const hasFooter = view.getUint8(3) === 4 && !!(view.getUint8(5) & 0x10);
        const readLength = Math.min(availableSize, 10 + tagSize + (hasFooter ? 10 : 0));
        if (readLength <= header.byteLength) {
          resolve(parseBuffer(header));
          return;
        }

        const tagReader = new FileReader();
        tagReader.onload = event => resolve(parseBuffer(event.target.result));
        tagReader.onerror = fallback;
        try {
          tagReader.readAsArrayBuffer(file.slice(0, readLength));
        } catch {
          fallback();
        }
      };
      headerReader.onerror = fallback;
      try {
        headerReader.readAsArrayBuffer(file.slice(0, 10));
      } catch {
        fallback();
      }
    });
  }

  let bufferedPlaybackEngine = null;
  let bufferedPlaybackMode = false;

  const mediaElement = document.createElement("video");
  mediaElement.preload = "auto";
  mediaElement.playsInline = true;
  mediaElement.controls = false;
  mediaElement.setAttribute("playsinline", "");
  mediaElement.setAttribute("webkit-playsinline", "");

  // ローカル音声だけ新しいPCM再生エンジンへ委譲し、動画・YouTubeは従来のHTMLMediaElementを使う。
  // Proxyは既存コードが参照するcurrentTime/duration/paused等とイベントAPIを維持する互換層。
  const audio = new Proxy(mediaElement, {
    get(target, property) {
      if (bufferedPlaybackMode && bufferedPlaybackEngine) {
        switch (property) {
          case "currentTime": return bufferedPlaybackEngine.currentTime;
          case "duration": return bufferedPlaybackEngine.duration;
          case "paused": return bufferedPlaybackEngine.paused;
          case "ended": return bufferedPlaybackEngine.ended;
          case "readyState": return bufferedPlaybackEngine.readyState;
          case "playbackRate": return bufferedPlaybackEngine.playbackRate;
          case "src":
          case "currentSrc": return bufferedPlaybackEngine.sourceUrl;
          case "error": return null;
          case "preservesPitch": return true;
          case "play":
            return async () => {
              if (typeof canUseBufferedPlayback === "function" && !canUseBufferedPlayback()) {
                const switched = await switchBufferedPlaybackToMediaElement(new Error("現在の速度・ピッチ設定はPCM経路の対応範囲外です"), false);
                if (!switched) {
                  throw new Error("フォールバックの再生位置を復元できなかったため、再生を保留しました。位置復元後にもう一度再生してください。");
                }
                return mediaElement.play();
              }
              try {
                return await bufferedPlaybackEngine.play();
              } catch (error) {
                const switched = await switchBufferedPlaybackToMediaElement(error, false);
                if (!switched) {
                  throw new Error("フォールバックの再生位置を復元できなかったため、再生を保留しました。位置復元後にもう一度再生してください。");
                }
                return mediaElement.play();
              }
            };
          case "pause":
            return () => bufferedPlaybackEngine.pause();
          case "load":
            return () => {};
          case "removeAttribute":
            return name => {
              if (String(name).toLowerCase() === "src") {
                bufferedPlaybackEngine.clear();
                bufferedPlaybackMode = false;
                if (typeof setGraphInputNode === "function") setGraphInputNode(sourceNode, filters?.[0] || null);
              }
              return target.removeAttribute(name);
            };
        }
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === "src") {
        const nextUrl = String(value || "");
        const isLocalAudio = !!nextUrl && state.currentSong?.mediaType === "audio" && !!bufferedPlaybackEngine;
        if (isLocalAudio) {
          bufferedPlaybackMode = true;
          bufferedPlaybackEngine.setSource(nextUrl);
          try {
            target.removeAttribute("src");
            target.load();
          } catch {}
          if (typeof setGraphInputNode === "function") setGraphInputNode(null);
          return true;
        }
        if (bufferedPlaybackEngine) bufferedPlaybackEngine.clear();
        bufferedPlaybackMode = false;
        if (typeof setGraphInputNode === "function") setGraphInputNode(sourceNode, filters?.[0] || null);
        return Reflect.set(target, property, value, target);
      }
      if (bufferedPlaybackMode && bufferedPlaybackEngine) {
        if (property === "currentTime") {
          bufferedPlaybackEngine.seek(value);
          return true;
        }
        if (property === "playbackRate") {
          bufferedPlaybackEngine.setPlaybackRate(value);
          return true;
        }
        if (property === "preservesPitch") return true;
      }
      return Reflect.set(target, property, value, target);
    }
  });

  let audioCtx = null, sourceNode = null, filters = [], masterGain = null, limiterNode = null, pannerNode = null, panner3DNode = null, analyser = null, analyserData = null;
  let channelSplitter = null, leftGainNode = null, rightGainNode = null, channelMerger = null;
  let spatialDirectGainNode = null, spatial3DGainNode = null;
  let micGainNode = null, micSourceNode = null, micStream = null;
  let micFeedbackGainNode = null, micFeedbackAnalyser = null, micFeedbackTimer = null;
  let micFeedbackData = null, micFeedbackPreviousData = null;
  let micReferenceAnalyser = null, micReferenceData = null;
  let micFeedbackHighSimilarityFrames = 0;
  let micFeedbackStableFrames = 0;
  let finalMixGainNode = null;
  let outputLevelGainNode = null;
  let loudnessCompressorNode = null, loudnessMakeupGainNode = null;
  let trackLoudnessGainNode = null, trackLoudnessAnalyser = null, trackLoudnessData = null;
  let trackLoudnessRms = 0, lastTrackLoudnessUpdateAt = 0;
  let waveOutputSplitter = null, waveLeftOutputAnalyser = null, waveRightOutputAnalyser = null;
  let waveLeftOutputData = null, waveRightOutputData = null;
  let micMonitorRequestId = 0;
  let outputSplitter = null, leftLevelAnalyser = null, rightLevelAnalyser = null;
  let leftLevelData = null, rightLevelData = null;
  let outputStreamDestination = null, outputBridgeAudio = null;
  const additionalOutputRuntimes = new Map();
  let audioGraphReady = false;
  let isSlidingRange = false;
  let currentRate = 1.0;
  let spatialAngle = 0;
  let targetSongForPlaylist = null;
  let lastUnmutedVolume = 1.0;
  let currentVolumeTarget = localStorage.getItem(STORAGE.volume) === null
    ? 1.0
    : Math.max(0, Math.min(2, loadNum(STORAGE.volume, 1.0)));
  let currentLeftVolumeTarget = localStorage.getItem(STORAGE.channelLeft) === null ? 1.0 : loadNum(STORAGE.channelLeft, 1.0);
  let currentRightVolumeTarget = localStorage.getItem(STORAGE.channelRight) === null ? 1.0 : loadNum(STORAGE.channelRight, 1.0);
  let currentMicMonitorVolumeTarget = loadNum(STORAGE.micMonitorVolume, 1.0);
  let eqAnimId = null;
  let wakeLock = null;
  
  const historyStack = [];
  let historyIndex = -1;
  let homeCycleOrder = [];
  let homeCycleIndex = -1;
  let homeCycleSourceKey = "";

  let sleepTimerId = null;
  let sleepIntervalId = null;
  let sleepTimerEnd = null;
  let sleepTimerPendingStop = false;
  let hasCountedCurrentSong = false;

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function loadJSON(k, fallback, validator = null) {
    try {
      const raw = localStorage.getItem(k);
      if (raw === null || raw === "") return fallback;
      const value = JSON.parse(raw);
      if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
      if (isPlainObject(fallback) && !isPlainObject(value)) return fallback;
      if (typeof validator === "function" && !validator(value)) return fallback;
      return value;
    } catch {
      return fallback;
    }
  }

  function normalizeStoredNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== "number" && !(typeof value === "string" && value.trim() !== "")) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function loadStringArray(k) {
    return loadJSON(k, []).filter(value => typeof value === "string" && value.length > 0 && value.length <= 1024);
  }

  function loadNonNegativeNumberMap(k) {
    const stored = loadJSON(k, {});
    const entries = Object.entries(stored)
      .filter(([key]) => key.length > 0)
      .map(([key, value]) => [key, normalizeStoredNumber(value, NaN)]);
    return Object.fromEntries(entries.filter(([, value]) => Number.isFinite(value)));
  }

  function loadPlayStatsMap(k) {
    const stored = loadJSON(k, {});
    const entries = [];
    for (const [key, value] of Object.entries(stored)) {
      if (!key || !isPlainObject(value)) continue;
      entries.push([key, {
        ...value,
        lastPlayed: normalizeStoredNumber(value.lastPlayed),
        totalPlayback: normalizeStoredNumber(value.totalPlayback),
        partialPlays: normalizeStoredNumber(value.partialPlays)
      }]);
    }
    return Object.fromEntries(entries);
  }

  function loadEqState(k, fallback) {
    const stored = loadJSON(k, fallback);
    if (
      typeof stored.preset !== "string" ||
      !Array.isArray(stored.gains) ||
      stored.gains.length !== 5
    ) return fallback;
    const gains = stored.gains.map(value => normalizeStoredNumber(value, NaN, -24, 24));
    if (!gains.every(Number.isFinite)) return fallback;
    return { ...stored, preset: stored.preset.slice(0, 40), gains };
  }

  function loadCustomTheme(k, fallback) {
    const stored = loadJSON(k, fallback);
    const color = (value, defaultValue) =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : defaultValue;
    const lightness = (value, defaultValue) => normalizeStoredNumber(value, defaultValue, 0, 100);
    const direction = ["45deg", "90deg", "135deg", "180deg"].includes(stored.dir)
      ? stored.dir
      : fallback.dir;
    return {
      ...fallback,
      ...stored,
      c1: color(stored.c1, fallback.c1),
      c2: color(stored.c2, fallback.c2),
      text: color(stored.text, fallback.text),
      l1: lightness(stored.l1, fallback.l1),
      l2: lightness(stored.l2, fallback.l2),
      lText: lightness(stored.lText, fallback.lText),
      dir: direction
    };
  }

  function loadPlaylists(k) {
    const stored = loadJSON(k, {});
    const entries = [];
    for (const [name, tracks] of Object.entries(stored)) {
      if (!name.trim() || name.length > 200 || !Array.isArray(tracks)) continue;
      entries.push([name, tracks.filter(track => typeof track === "string" && track.length > 0 && track.length <= 1024)]);
    }
    return Object.fromEntries(entries);
  }

  function loadPlaylistSettings(k) {
    const stored = loadJSON(k, {});
    const entries = [];
    for (const [name, settings] of Object.entries(stored)) {
      if (!name.trim() || !isPlainObject(settings)) continue;
      entries.push([name, {
        ...settings,
        shuffle: typeof settings.shuffle === "boolean" ? settings.shuffle : false,
        repeat: typeof settings.repeat === "boolean" ? settings.repeat : false
      }]);
    }
    return Object.fromEntries(entries);
  }

  function loadVisualizerSettings(k, fallback) {
    const stored = loadJSON(k, fallback);
    return {
      ...fallback,
      ...stored,
      lowPerformanceMode: typeof stored.lowPerformanceMode === "boolean" ? stored.lowPerformanceMode : fallback.lowPerformanceMode,
      showFps: typeof stored.showFps === "boolean" ? stored.showFps : fallback.showFps,
      showLoad: typeof stored.showLoad === "boolean" ? stored.showLoad : fallback.showLoad
    };
  }

  function loadVisualizerModeSettings(k) {
    const stored = loadJSON(k, {});
    const entries = [];
    for (const [mode, settings] of Object.entries(stored)) {
      if (!mode.trim() || !isPlainObject(settings)) continue;
      const normalized = { ...settings };
      if (Object.prototype.hasOwnProperty.call(normalized, "particleCount")) {
        const particleCount = normalizeStoredNumber(normalized.particleCount, NaN, 0, 1200);
        if (Number.isFinite(particleCount)) normalized.particleCount = Math.round(particleCount);
        else delete normalized.particleCount;
      }
      entries.push([mode, normalized]);
    }
    return Object.fromEntries(entries);
  }

  function loadSpeakerSettings(k, fallback) {
    const raw = localStorage.getItem(k);
    if (raw === null || raw === "") return { ...fallback };
    let stored;
    try {
      stored = JSON.parse(raw);
    } catch {
      return { ...fallback, outputRoutingBlocked: true };
    }
    if (!isPlainObject(stored)) return { ...fallback, outputRoutingBlocked: true };

    const settings = { ...fallback, ...stored };
    if (Object.prototype.hasOwnProperty.call(stored, "outputRoutingBlocked")) {
      settings.outputRoutingBlocked = typeof stored.outputRoutingBlocked === "boolean"
        ? stored.outputRoutingBlocked
        : true;
    }
    if (typeof stored.multipleOutputEnabled !== "boolean") settings.multipleOutputEnabled = fallback.multipleOutputEnabled;
    if (typeof stored.mainEnabled !== "boolean") settings.mainEnabled = fallback.mainEnabled;
    if (typeof stored.autoDelayEnabled !== "boolean") settings.autoDelayEnabled = fallback.autoDelayEnabled;
    if (!["stereo", "left", "right"].includes(settings.channelMode)) settings.channelMode = fallback.channelMode;
    for (const key of ["leftChannel", "rightChannel"]) {
      if (Object.prototype.hasOwnProperty.call(settings, key) && !["left", "right", "off"].includes(settings[key])) {
        delete settings[key];
      }
    }
    settings.mainDelayMs = normalizeStoredNumber(settings.mainDelayMs, 0, 0, 1000);
    for (const key of ["mainOutputLabel", "mainOutputGroupId"]) {
      if (typeof settings[key] !== "string") settings[key] = "";
      else settings[key] = settings[key].slice(0, 256);
    }
    if (Object.prototype.hasOwnProperty.call(settings, "lastRouteMeasurements")) {
      settings.lastRouteMeasurements = Array.isArray(settings.lastRouteMeasurements)
        ? settings.lastRouteMeasurements.filter(isPlainObject)
        : [];
    }
    return settings;
  }

  function loadBool(k, f){ const r = localStorage.getItem(k); return r === null ? f : r === "true"; }
  function loadNum(k, f){ const r = localStorage.getItem(k); const n = Number(r); return Number.isFinite(n) ? n : f; }
  function loadStr(k, f){ const r = localStorage.getItem(k); return r === null ? f : r; }
  function loadSpatialMode(){
    const savedMode = loadStr(STORAGE.dMode, "3D");
    return savedMode === "BINAURAL" ? "3D" : savedMode;
  }

  const state = {
    playlist: [],
    currentSong: null,
    favorites: loadStringArray(STORAGE.favorites),
    queue: loadStringArray(STORAGE.queue),
    playCounts: loadNonNegativeNumberMap(STORAGE.playCounts),
    playHistory: loadNonNegativeNumberMap(STORAGE.playHistory),
    playStats: loadPlayStatsMap(STORAGE.playStats),
    playbackMonthly: loadNonNegativeNumberMap(STORAGE.playbackMonthly),
    eqState: loadEqState(STORAGE.eqState, { preset: "Normal", gains: [0,0,0,0,0] }),
    shuffle: loadBool(STORAGE.shuffle, true),
    repeat: loadBool(STORAGE.repeat, false),
    favOnly: loadBool(STORAGE.favOnly, false),
    search: "",
    themeMode: loadStr(STORAGE.themeMode, "system"),
    accentColor: loadStr(STORAGE.accentColor, "#35D977"),
    customTheme: loadCustomTheme(STORAGE.customTheme, {
      c1: "#1d3557", l1: 100,
      c2: "#121212", l2: 100,
      text: "#ffffff", lText: 100,
      dir: "180deg"
    }),
    pitchSemitones: loadNum(STORAGE.pitch, 0),
    playlists: loadPlaylists(STORAGE.playlists),
    playlistOrder: loadStringArray(STORAGE.playlistOrder),
    crossfade: loadBool(STORAGE.crossfade, true),
    silenceSkip: loadBool(STORAGE.silenceSkip, true),
    dMode: loadSpatialMode(),
    waveMode: loadStr(STORAGE.waveMode, "2d"),
    waveParticleCount: Math.max(0, Math.min(1200, Math.round(loadNum(STORAGE.waveParticleCount, 0)))),
    clippingProtection: loadBool(STORAGE.clippingProtection, true),
    micMonitor: false,
    micMonitorVolume: currentMicMonitorVolumeTarget,
    micFeedbackProtection: true,
    micFeedbackStrength: Math.max(0, Math.min(1, loadNum(STORAGE.micFeedbackStrength, 1))),
    normalizeTrackVolume: loadBool(STORAGE.normalizeTrackVolume, true),
    outputLevelDb: Math.max(-12, Math.min(0, loadNum(STORAGE.outputLevelDb, 0))),
    loudnessCompression: Math.max(0, Math.min(100, Math.round(loadNum(STORAGE.loudnessCompression, 0)))),
    speakerPairSwap: loadBool(STORAGE.speakerPairSwap, false),
    visualizerSettings: loadVisualizerSettings(STORAGE.visualizerSettings, { lowPerformanceMode:false, showFps:false, showLoad:false }),
    visualizerModeSettings: loadVisualizerModeSettings(STORAGE.visualizerModeSettings),
    channelLeft: currentLeftVolumeTarget,
    channelRight: currentRightVolumeTarget,
    outputRoutes: loadJSON(STORAGE.outputRoutes, [])
      .filter(route => route && typeof route.deviceId === "string" && String(route.label || "").trim())
      .map(route => ({
      ...route,
      enabled: route.enabled !== false,
      delayMs: Math.max(0, Math.min(1000, Math.round((Number(route.delayMs) || 0) * 10) / 10))
    })),
    mainOutputDeviceId: loadStr(STORAGE.mainOutputDevice, ""),
    speakerSettings: loadSpeakerSettings(STORAGE.speakerSettings, { multipleOutputEnabled: false, outputRoutingBlocked: false, mainEnabled: true, channelMode: "stereo", autoDelayEnabled: true }),
    playlistSettings: loadPlaylistSettings(STORAGE.playlistSettings),
    activePlaylistName: null,
    playlistCycleOrder: [],
    playlistCycleIndex: -1,
    playlistCycleSeen: [],
    panValue: 0,
    homeLayout: loadStr(STORAGE.homeLayout, "default"),
    menuOpen: false
  };

  // 複数出力がOFFの間は、アプリ独自の保存先を使わずOS既定の出力先に従う。
  if (state.speakerSettings.multipleOutputEnabled !== true) {
    state.mainOutputDeviceId = "";
    // outputRoutingBlockedはユーザーが出力先を明示的に選び直すまで維持する。
  }

  const el = {
    shell: document.getElementById("shell"),
    folder: document.getElementById("folder"),
    btnResetFiles: document.getElementById("btnResetFiles"),
    btnResetSettings: document.getElementById("btnResetSettings"),
    search: document.getElementById("search"),
    list: document.getElementById("list"),
    nowTitle: document.getElementById("nowTitle"),
    nowSub: document.getElementById("nowSub"),
    miniTitle: document.getElementById("miniTitle"),
    miniCoverCanvas: document.getElementById("miniCoverCanvas"),
    miniTimeNow: document.getElementById("miniTimeNow"),
    miniTimeAll: document.getElementById("miniTimeAll"),
    nowCoverBox: document.getElementById("nowCoverBox"),
    btnVideoFullscreen: document.getElementById("btnVideoFullscreen"),
    pillSongs: document.getElementById("pillSongs"),
    pillFavs: document.getElementById("pillFavs"),
    btnShortcutHelp: document.getElementById("btnShortcutHelp"),
    statPlays: document.getElementById("statPlays"),
    statSongs: document.getElementById("statSongs"),
    btnResetStats: document.getElementById("btnResetStats"),
    playHistoryChart: document.getElementById("playHistoryChart"),
    statTotalPlayback: document.getElementById("statTotalPlayback"),
    statPartialPlays: document.getElementById("statPartialPlays"),
    statsPopularList: document.getElementById("statsPopularList"),
    statsRecentList: document.getElementById("statsRecentList"),
    queueList: document.getElementById("queueList"),
    eqPresetRow: document.getElementById("eqPresetRow"),
    eqBands: document.getElementById("eqBands"),
    btnMenu: document.getElementById("btnMenu"),
    btnCloseMenu: document.getElementById("btnCloseMenu"),
    btnSideBack: document.getElementById("btnSideBack"),
    sideTitle: document.getElementById("sideTitle"),
    overlay: document.getElementById("overlay"),
    sidebar: document.getElementById("sidebar"),
    sidebarInner: document.getElementById("sidebarInner"),
    mainMenuList: document.getElementById("mainMenuList"),
    btnPrev: document.getElementById("btnPrev"),
    btnRewind10: document.getElementById("btnRewind10"),
    btnPlay: document.getElementById("btnPlay"),
    btnForward10: document.getElementById("btnForward10"),
    btnNext: document.getElementById("btnNext"),
    btnFav: document.getElementById("btnFav"),
    btnMainShuffle: document.getElementById("btnMainShuffle"),
    btnMainRepeat: document.getElementById("btnMainRepeat"),
    miniPrev: document.getElementById("miniPrev"),
    miniPlay: document.getElementById("miniPlay"),
    miniNext: document.getElementById("miniNext"),
    btnMuteToggle: document.getElementById("btnMuteToggle"),
    volume: document.getElementById("volume"),
    volText: document.getElementById("volText"),
    playbackRate: document.getElementById("playbackRate"),
    customRateInput: document.getElementById("customRateInput"),
    rateText: document.getElementById("rateText"),
    pitchShift: document.getElementById("pitchShift"),
    pitchText: document.getElementById("pitchText"),
    progress: document.getElementById("progress"),
    miniProgress: document.getElementById("miniProgress"),
    timeNow: document.getElementById("timeNow"),
    timeAll: document.getElementById("timeAll"),
    wave: document.getElementById("wave"),
    waveModeBtns: document.getElementById("waveModeBtns"),
    waveModeSettingsBtns: document.getElementById("waveModeSettingsBtns"),
    btnQueueClear: document.getElementById("btnQueueClear"),
    btnQueueShuffle: document.getElementById("btnQueueShuffle"),
    btnEqReset: document.getElementById("btnEqReset"),
    toast: document.getElementById("toast"),
    btnThemeSystem: document.getElementById("btnThemeSystem"),
    btnThemeDark: document.getElementById("btnThemeDark"),
    btnThemeLight: document.getElementById("btnThemeLight"),
    btnThemeCustom: document.getElementById("btnThemeCustom"),
    accentColorInput: document.getElementById("accentColorInput"),
    btnResetAccentColor: document.getElementById("btnResetAccentColor"),
    customThemeArea: document.getElementById("customThemeArea"),
    customThemeBackgroundInput: document.getElementById("customThemeBackgroundInput"),
    btnClearCustomThemeBackground: document.getElementById("btnClearCustomThemeBackground"),
    customThemeBackgroundStatus: document.getElementById("customThemeBackgroundStatus"),
    gridColor1: document.getElementById("gridColor1"),
    gridColor2: document.getElementById("gridColor2"),
    gridTextColor: document.getElementById("gridTextColor"),
    sliderL1: document.getElementById("sliderL1"),
    sliderL2: document.getElementById("sliderL2"),
    sliderLText: document.getElementById("sliderLText"),
    txtL1: document.getElementById("txtL1"),
    txtL2: document.getElementById("txtL2"),
    txtLText: document.getElementById("txtLText"),
    gradDirectionList: document.getElementById("gradDirectionList"),
    nowCoverCanvas: document.getElementById("nowCoverCanvas"),
    btnCrossfade: document.getElementById("btnCrossfade"),
    btnSilenceSkip: document.getElementById("btnSilenceSkip"),
    btnClippingProtection: document.getElementById("btnClippingProtection"),
    btnMicMonitor: document.getElementById("btnMicMonitor"),
    micMonitorVolume: document.getElementById("micMonitorVolume"),
    micMonitorVolumeText: document.getElementById("micMonitorVolumeText"),
    btnMicFeedbackProtection: document.getElementById("btnMicFeedbackProtection"),
    micFeedbackStrength: document.getElementById("micFeedbackStrength"),
    micFeedbackStrengthText: document.getElementById("micFeedbackStrengthText"),
    normalizeTrackVolume: document.getElementById("normalizeTrackVolume"),
    outputLevelDb: document.getElementById("outputLevelDb"),
    outputLevelDbText: document.getElementById("outputLevelDbText"),
    loudnessCompression: document.getElementById("loudnessCompression"),
    loudnessCompressionNumber: document.getElementById("loudnessCompressionNumber"),
    loudnessCompressionText: document.getElementById("loudnessCompressionText"),
    micMonitorLatencyText: document.getElementById("micMonitorLatencyText"),
    micFeedbackStatus: document.getElementById("micFeedbackStatus"),
    waveParticleCount: document.getElementById("waveParticleCount"),
    waveParticleCountText: document.getElementById("waveParticleCountText"),
    btnSettingsResetSettings: document.getElementById("btnSettingsResetSettings"),
    settingsSearch: document.getElementById("settingsSearch"),
    visualizerLowPerformance: document.getElementById("visualizerLowPerformance"),
    visualizerShowFps: document.getElementById("visualizerShowFps"),
    visualizerShowLoad: document.getElementById("visualizerShowLoad"),
    visualizerFps: document.getElementById("visualizerFps"),
    visualizerLoad: document.getElementById("visualizerLoad"),
    outputDeviceName: document.getElementById("outputDeviceName"),
    btnSelectOutput: document.getElementById("btnSelectOutput"),
    btnSelectOutputDirect: document.getElementById("btnSelectOutputDirect"),
    btnRequestOutputPermissionMain: document.getElementById("btnRequestOutputPermissionMain"),
    outputDevicePermissionStatusMain: document.getElementById("outputDevicePermissionStatusMain"),
    outputDeviceModal: document.getElementById("outputDeviceModal"),
    outputDeviceList: document.getElementById("outputDeviceList"),
    btnCloseOutputDeviceModal: document.getElementById("btnCloseOutputDeviceModal"),
    btnCloseOutputDeviceModalBottom: document.getElementById("btnCloseOutputDeviceModalBottom"),
    outputDeviceAddModal: document.getElementById("outputDeviceAddModal"),
    outputDeviceAddList: document.getElementById("outputDeviceAddList"),
    btnAddOutputSpeaker: document.getElementById("btnAddOutputSpeaker"),
    btnOpenSpeakerAdd: document.getElementById("btnOpenSpeakerAdd"),
    btnAutoCalibrateSpeakers: document.getElementById("btnAutoCalibrateSpeakers"),
    mainOutputDelay: document.getElementById("mainOutputDelay"),
    mainOutputDelayText: document.getElementById("mainOutputDelayText"),
    btnMainOutputDelayDown: document.getElementById("btnMainOutputDelayDown"),
    btnMainOutputDelayUp: document.getElementById("btnMainOutputDelayUp"),
    btnDiscoverOutputSpeaker: document.getElementById("btnDiscoverOutputSpeaker"),
    outputDevicePermissionStatus: document.getElementById("outputDevicePermissionStatus"),
    btnRequestOutputPermission: document.getElementById("btnRequestOutputPermission"),
    btnCloseOutputDeviceAddModal: document.getElementById("btnCloseOutputDeviceAddModal"),
    btnCloseOutputDeviceAddModalBottom: document.getElementById("btnCloseOutputDeviceAddModalBottom"),
    btnRefreshOutputAddList: document.getElementById("btnRefreshOutputAddList"),
    additionalOutputSpeakers: document.getElementById("additionalOutputSpeakers"),
    channelLeft: document.getElementById("channelLeft"),
    channelRight: document.getElementById("channelRight"),
    channelLeftText: document.getElementById("channelLeftText"),
    channelRightText: document.getElementById("channelRightText"),
    playlistTrackSheet: document.getElementById("playlistTrackSheet"),
    playlistTrackSheetTitle: document.getElementById("playlistTrackSheetTitle"),
    playlistTrackList: document.getElementById("playlistTrackList"),
    btnClosePlaylistTrackSheet: document.getElementById("btnClosePlaylistTrackSheet"),
    btnPlaylistTrackAdd: document.getElementById("btnPlaylistTrackAdd"),
    btnPlaylistTrackShuffle: document.getElementById("btnPlaylistTrackShuffle"),
    btnPlaylistTrackRepeat: document.getElementById("btnPlaylistTrackRepeat"),
    btnPlaylistTrackPlay: document.getElementById("btnPlaylistTrackPlay"),
    dModeBtns: document.getElementById("dModeBtns"),
    dModeDesc: document.getElementById("dModeDesc"),
    pannerSlider: document.getElementById("pannerSlider"),
    pannerValText: document.getElementById("pannerValText"),
    newPlName: document.getElementById("newPlName"),
    btnCreatePl: document.getElementById("btnCreatePl"),
    playlistContainer: document.getElementById("playlistContainer"),
    plAlertModal: document.getElementById("plAlertModal"),
    btnClosePlModal: document.getElementById("btnClosePlModal"),
    shortcutModal: document.getElementById("shortcutModal"),
    btnCloseShortcutModal: document.getElementById("btnCloseShortcutModal"),
    timerStatus: document.getElementById("timerStatus"),
    customTimerInput: document.getElementById("customTimerInput"),
    btnSetCustomTimer: document.getElementById("btnSetCustomTimer"),
    plSelectSheet: document.getElementById("plSelectSheet"),
    plSelectList: document.getElementById("plSelectList"),
    btnClosePlSheet: document.getElementById("btnClosePlSheet"),
    btnBulkAddPl: document.getElementById("btnBulkAddPl")
  };
