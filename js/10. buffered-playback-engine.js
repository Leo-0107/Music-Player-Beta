// Music Player PCM playback engine (local audio only).
// Decodes the complete local track before audible playback so the media decoder is not
// responsible for delivering real-time audio frames. Existing Web Audio effects remain downstream.
class BufferedPlaybackEngine {
  constructor() {
    this.sourceUrl = "";
    this.buffer = null;
    this.sourceNode = null;
    this.offset = 0;
    this.startedAt = 0;
    this.playbackRate = 1;
    this.paused = true;
    this.ended = false;
    this._readyState = 0;
    this.decodePromise = null;
    this.generation = 0;
    this.playRequestId = 0;
    this.playRequested = false;
    this.timeUpdateTimer = null;
    this.maxPcmBytes = this.getMemoryBudget();
  }

  get readyState() {
    return this._readyState;
  }

  get duration() {
    return this.buffer?.duration || Number(state.currentSong?.duration) || NaN;
  }

  get currentTime() {
    if (this.paused || !audioCtx || !this.startedAt) return this.offset;
    const elapsed = Math.max(0, audioCtx.currentTime - this.startedAt);
    return Math.max(0, Math.min(this.duration || this.offset, this.offset + elapsed * this.playbackRate));
  }

  getMemoryBudget() {
    const deviceMemory = Math.max(1, Number(navigator.deviceMemory) || 4);
    return Math.max(96, Math.min(384, deviceMemory * 48)) * 1024 * 1024;
  }

  dispatch(type) {
    try { mediaElement.dispatchEvent(new Event(type)); } catch (e) {}
  }

  setSource(url) {
    this.clear();
    this.sourceUrl = String(url || "");
    this.offset = 0;
    this._readyState = this.sourceUrl ? 1 : 0;
    this.dispatch("loadstart");
  }

  async prepare() {
    if (this.buffer) return this.buffer;
    if (this.decodePromise) return this.decodePromise;
    if (!this.sourceUrl) throw new Error("PCM source URL is empty");

    const generation = this.generation;
    this.decodePromise = (async () => {
      const response = await fetch(this.sourceUrl);
      if (!response.ok) throw new Error("Local audio data could not be read");
      const compressed = await response.arrayBuffer();
      if (generation !== this.generation) throw new Error("PCM preparation was cancelled");
      if (compressed.byteLength > this.maxPcmBytes) {
        throw new Error("Compressed source exceeds the PCM memory budget");
      }

      const durationHint = Number(state.currentSong?.duration) || 0;
      const sampleRateHint = Math.max(48000, Number(audioCtx?.sampleRate) || 48000);
      const estimatedBytes = durationHint > 0 ? durationHint * sampleRateHint * 2 * 4 : 0;
      if (estimatedBytes > this.maxPcmBytes) {
        throw new Error("PCM memory budget exceeded before decoding");
      }

      ensureGraph();
      if (!audioCtx || typeof audioCtx.decodeAudioData !== "function") {
        throw new Error("AudioBuffer decoding is unavailable");
      }
      const decoded = await audioCtx.decodeAudioData(compressed.slice(0));
      if (generation !== this.generation) throw new Error("PCM preparation was cancelled");

      const channels = Number(decoded.numberOfChannels) || 0;
      const pcmBytes = decoded.length * channels * 4;
      if (channels < 1 || channels > 2) {
        throw new Error("This channel layout is not supported by the PCM playback path");
      }
      if (pcmBytes > this.maxPcmBytes) {
        throw new Error("Decoded PCM exceeds the available memory budget");
      }

      this.buffer = decoded;
      this.offset = Math.max(0, Math.min(decoded.duration, this.offset));
      this._readyState = 4;
      this.dispatch("loadedmetadata");
      this.dispatch("durationchange");
      this.dispatch("canplay");
      this.dispatch("canplaythrough");
      return decoded;
    })().catch(error => {
      if (generation === this.generation) {
        this._readyState = 0;
        this.dispatch("error");
      }
      throw error;
    }).finally(() => {
      if (generation === this.generation) this.decodePromise = null;
    });

    return this.decodePromise;
  }

  async play() {
    if (!this.sourceUrl) throw new Error("No local audio source is selected");
    if (!canUseBufferedPlayback()) throw new Error("Playback rate and pitch combination is outside the PCM path range");
    if (!this.paused) return;
    const requestId = ++this.playRequestId;
    this.playRequested = true;
    ensureGraph();
    await resumeAudioCtx();
    if (!this.buffer) this.dispatch("waiting");
    await this.prepare();
    if (requestId !== this.playRequestId || !this.playRequested) return;
    if (!this.buffer) throw new Error("PCM decoding did not produce audio");
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.startSource(this.offset);
    this.paused = false;
    this.ended = false;
    this.startTimeUpdates();
    this.dispatch("play");
    this.dispatch("playing");
    this.dispatch("timeupdate");
  }

  startSource(offset) {
    if (!this.buffer || !audioCtx) throw new Error("PCM buffer is not ready");
    const source = audioCtx.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.setValueAtTime(this.playbackRate, audioCtx.currentTime);
    source.onended = () => {
      if (this.sourceNode !== source || this.paused) return;
      this.sourceNode = null;
      this.offset = this.buffer?.duration || this.offset;
      this.paused = true;
      this.ended = true;
      this.startedAt = 0;
      try { source.disconnect(); } catch (e) {}
      setGraphInputNode(null);
      this.stopTimeUpdates();
      this.dispatch("timeupdate");
      this.dispatch("ended");
    };
    this.sourceNode = source;
    setGraphInputNode(source, filters?.[0] || null);
    this.startedAt = audioCtx.currentTime + 0.02;
    source.start(this.startedAt, Math.max(0, offset));
  }

  stopSource() {
    const source = this.sourceNode;
    this.sourceNode = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
    }
    setGraphInputNode(null);
    this.startedAt = 0;
  }

  pause() {
    const wasPreparing = this.playRequested && !this.buffer;
    this.playRequestId++;
    this.playRequested = false;
    if (this.paused) {
      if (wasPreparing) this.dispatch("canplay");
      return;
    }
    this.offset = this.currentTime;
    this.paused = true;
    this.stopSource();
    this.stopTimeUpdates();
    this.dispatch("pause");
    this.dispatch("timeupdate");
  }

  seek(value) {
    let next = Number(value);
    if (!Number.isFinite(next)) next = 0;
    const max = this.buffer?.duration || Number(state.currentSong?.duration) || 0;
    next = Math.max(0, max > 0 ? Math.min(max, next) : next);
    const wasPlaying = !this.paused;
    this.dispatch("seeking");
    if (wasPlaying) this.stopSource();
    this.offset = next;
    this.ended = false;
    if (wasPlaying && this.buffer) this.startSource(next);
    this.dispatch("seeked");
    this.dispatch("timeupdate");
  }

  setPlaybackRate(value) {
    let next = Number(value);
    if (!Number.isFinite(next)) next = 1;
    next = Math.max(0.1, Math.min(10, next));
    if (Math.abs(next - this.playbackRate) < 0.0001) return;
    const wasPlaying = !this.paused;
    const position = this.currentTime;
    if (wasPlaying) this.stopSource();
    this.playbackRate = next;
    this.offset = position;
    if (wasPlaying && this.buffer) this.startSource(position);
  }

  startTimeUpdates() {
    this.stopTimeUpdates();
    this.timeUpdateTimer = setInterval(() => {
      if (this.paused) return;
      this.dispatch("timeupdate");
    }, 100);
  }

  stopTimeUpdates() {
    if (this.timeUpdateTimer !== null) clearInterval(this.timeUpdateTimer);
    this.timeUpdateTimer = null;
  }

  releaseForFallback() {
    this.playRequestId++;
    this.playRequested = false;
    this.offset = this.currentTime;
    this.paused = true;
    this.stopSource();
    this.stopTimeUpdates();
    this.buffer = null;
    this.decodePromise = null;
    this._readyState = 0;
  }

  clear() {
    this.generation++;
    this.playRequestId++;
    this.playRequested = false;
    this.paused = true;
    this.ended = false;
    this.stopSource();
    this.stopTimeUpdates();
    this.buffer = null;
    this.decodePromise = null;
    this.sourceUrl = "";
    this.offset = 0;
    this.startedAt = 0;
    this._readyState = 0;
  }
}

bufferedPlaybackEngine = new BufferedPlaybackEngine();
