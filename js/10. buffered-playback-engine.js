// Music Player PCM playback engine (local audio only).
// Decodes the complete local track before audible playback so the media decoder is not
// responsible for delivering real-time audio frames. Existing Web Audio effects remain downstream.
class ProcessedPcmRingBuffer {
  constructor(capacityFrames) {
    const capacity = Number(capacityFrames);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1048576) {
      throw new RangeError("PCM ring buffer capacity must be an integer from 1 to 1048576 frames");
    }
    this.capacityFrames = capacity;
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.readFrame = 0;
    this.writeFrame = 0;
  }

  get freeFrames() {
    return this.capacityFrames - this.availableFrames;
  }

  clear(startFrame = 0) {
    const frame = Number(startFrame);
    if (!Number.isSafeInteger(frame) || frame < 0) {
      throw new RangeError("PCM ring buffer start frame must be a non-negative safe integer");
    }
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.readFrame = frame;
    this.writeFrame = frame;
  }

  write(chunk) {
    const frameCount = Number(chunk?.frameCount);
    const isFloat32 = value => Object.prototype.toString.call(value) === "[object Float32Array]";
    if (!Number.isInteger(frameCount) || frameCount < 1 ||
        !isFloat32(chunk.left) || !isFloat32(chunk.right) ||
        chunk.left.length < frameCount || chunk.right.length < frameCount) {
      throw new TypeError("PCM ring buffer received an invalid chunk");
    }
    if (!Number.isSafeInteger(chunk.startFrame) || chunk.startFrame !== this.writeFrame) {
      throw new Error("PCM ring buffer chunk is not contiguous with the write frame");
    }
    if (frameCount > this.freeFrames) {
      throw new RangeError("PCM ring buffer is full");
    }

    const firstPart = Math.min(frameCount, this.capacityFrames - this.writeIndex);
    const secondPart = frameCount - firstPart;
    this.left.set(chunk.left.subarray(0, firstPart), this.writeIndex);
    this.right.set(chunk.right.subarray(0, firstPart), this.writeIndex);
    if (secondPart > 0) {
      this.left.set(chunk.left.subarray(firstPart, frameCount), 0);
      this.right.set(chunk.right.subarray(firstPart, frameCount), 0);
    }
    this.writeIndex = (this.writeIndex + frameCount) % this.capacityFrames;
    this.availableFrames += frameCount;
    this.writeFrame += frameCount;
    return frameCount;
  }

  read(maxFrames) {
    const requested = Number(maxFrames);
    if (!Number.isInteger(requested) || requested < 1) {
      throw new RangeError("PCM ring buffer read size must be a positive integer");
    }
    const frameCount = Math.min(requested, this.availableFrames);
    if (frameCount === 0) return null;

    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);
    const firstPart = Math.min(frameCount, this.capacityFrames - this.readIndex);
    const secondPart = frameCount - firstPart;
    left.set(this.left.subarray(this.readIndex, this.readIndex + firstPart));
    right.set(this.right.subarray(this.readIndex, this.readIndex + firstPart));
    if (secondPart > 0) {
      left.set(this.left.subarray(0, secondPart), firstPart);
      right.set(this.right.subarray(0, secondPart), firstPart);
    }
    const startFrame = this.readFrame;
    this.readIndex = (this.readIndex + frameCount) % this.capacityFrames;
    this.availableFrames -= frameCount;
    this.readFrame += frameCount;
    return { startFrame, frameCount, left, right };
  }

  discardBefore(frame) {
    const target = Number(frame);
    if (!Number.isSafeInteger(target) || target < this.readFrame || target > this.writeFrame) {
      throw new RangeError("PCM ring buffer discard frame is outside the buffered range");
    }
    const discarded = target - this.readFrame;
    this.readIndex = (this.readIndex + discarded) % this.capacityFrames;
    this.availableFrames -= discarded;
    this.readFrame = target;
    return discarded;
  }
}

// Bounded producer/consumer queue for processed PCM. This is intentionally not wired
// into audible playback until the output scheduler and DSP ownership are validated.
class PcmPrebufferQueue {
  constructor(ringBuffer, iterator, maxChunkFrames = 8192) {
    const maxFrames = Number(maxChunkFrames);
    if (!ringBuffer || typeof ringBuffer.read !== "function" ||
        typeof ringBuffer.write !== "function" ||
        !Number.isInteger(ringBuffer.capacityFrames) || ringBuffer.capacityFrames < 1 ||
        !Number.isInteger(maxFrames) || maxFrames < 1 ||
        maxFrames > 32768 || maxFrames * 2 > ringBuffer.capacityFrames) {
      throw new RangeError("PCM prebuffer queue requires capacity for at least two maximum-sized chunks");
    }
    if (!iterator || typeof iterator.next !== "function") {
      throw new TypeError("PCM prebuffer queue requires an async iterator");
    }
    this.ringBuffer = ringBuffer;
    this.iterator = iterator;
    this.maxChunkFrames = maxFrames;
    this.started = false;
    this.running = false;
    this.done = false;
    this.cancelled = false;
    this.error = null;
    this.pumpPromise = null;
    this.waiters = new Set();
  }

  start() {
    if (this.started) return this;
    this.started = true;
    this.running = true;
    this.pump();
    return this;
  }

  notify() {
    const waiters = Array.from(this.waiters);
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }

  pump() {
    if (!this.running || this.pumpPromise) return this.pumpPromise;
    const task = (async () => {
      try {
        while (this.running && !this.done &&
               this.ringBuffer.freeFrames >= this.maxChunkFrames) {
          const result = await this.iterator.next();
          // A cancelled or superseded producer must never write into the queue.
          if (!this.running || this.cancelled) return;
          if (result.done) {
            this.done = true;
            this.running = false;
            this.notify();
            return;
          }
          const chunk = result.value;
          if (!chunk || !Number.isInteger(chunk.frameCount) ||
              chunk.frameCount < 1 || chunk.frameCount > this.maxChunkFrames) {
            throw new Error("PCM producer returned an invalid or oversized chunk");
          }
          this.ringBuffer.write(chunk);
          this.notify();
        }
      } catch (error) {
        if (this.cancelled) return;
        this.error = error;
        this.running = false;
        this.notify();
      }
    })();
    this.pumpPromise = task.finally(() => {
      this.pumpPromise = null;
      if (this.running && !this.done &&
          this.ringBuffer.freeFrames >= this.maxChunkFrames) this.pump();
    });
    return this.pumpPromise;
  }

  async readAsync(maxFrames) {
    if (!this.started) throw new Error("PCM prebuffer queue has not been started");
    const requested = Number(maxFrames);
    if (!Number.isInteger(requested) || requested < 1 ||
        requested > this.maxChunkFrames) {
      throw new RangeError("PCM prebuffer read size must not exceed the maximum chunk size");
    }
    for (;;) {
      if (this.error) throw this.error;
      if (this.ringBuffer.availableFrames >= requested) {
        const chunk = this.ringBuffer.read(requested);
        this.pump();
        return chunk;
      }
      if (this.done || !this.running) {
        return this.ringBuffer.read(requested);
      }
      await new Promise(resolve => this.waiters.add(resolve));
    }
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.running = false;
    this.done = true;
    // Cancellation invalidates buffered output as well as future producer results.
    this.ringBuffer.clear(this.ringBuffer.readFrame);
    try {
      const closing = this.iterator.return?.();
      if (closing && typeof closing.catch === "function") closing.catch(() => {});
    } catch (error) {}
    this.notify();
  }
}

// Schedules already-processed PCM chunks without changing the audible graph yet.
// The caller owns the polling cadence and the single input GainNode connected after EQ/pitch.
// Shared post-EQ/pitch input bus for multiple preprocessed PCM sessions.
// Session GainNodes can be crossfaded without replacing the single graph input connection.
class PcmOutputGraphRouter {
  constructor(audioContext, routeNode, setGraphInput, clearGraphInput) {
    if (!audioContext || typeof audioContext.createGain !== "function" ||
        !routeNode || typeof routeNode.connect !== "function" ||
        typeof setGraphInput !== "function" ||
        typeof clearGraphInput !== "function") {
      throw new TypeError("PCM graph router requires an AudioContext, route node, and graph input setter");
    }
    this.audioContext = audioContext;
    this.routeNode = routeNode;
    this.setGraphInput = setGraphInput;
    this.clearGraphInput = clearGraphInput;
    this.bus = audioContext.createGain();
    this.sessionGains = new Set();
    this.sessionGainState = new Map();
    this.disposed = false;
    try {
      if (this.setGraphInput(this.bus, routeNode) === false) {
        throw new Error("PCM graph input could not be connected");
      }
    } catch (error) {
      try { this.bus.disconnect(); } catch (ignore) {}
      this.disposed = true;
      throw error;
    }
  }

  createSessionGain(initialGain = 0) {
    if (this.disposed) throw new Error("PCM graph router is disposed");
    const value = Number(initialGain);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError("PCM session gain must be between 0 and 1");
    }
    const gain = this.audioContext.createGain();
    try {
      gain.gain.value = value;
      gain.connect(this.bus);
      this.sessionGains.add(gain);
      this.sessionGainState.set(gain, { from: value, to: value, startAt: 0, endAt: 0 });
      return gain;
    } catch (error) {
      try { gain.disconnect(); } catch (ignore) {}
      throw error;
    }
  }

  crossfade(oldGain, newGain, startAt, duration = 0.02) {
    if (this.disposed) throw new Error("PCM graph router is disposed");
    if ((oldGain && !this.sessionGains.has(oldGain)) ||
        (newGain && !this.sessionGains.has(newGain)) ||
        (!oldGain && !newGain) || (oldGain && oldGain === newGain)) {
      throw new TypeError("PCM crossfade references an unknown session gain");
    }
    const start = Number(startAt);
    const fadeDuration = Number(duration);
    if (!Number.isFinite(start) || start < 0 ||
        !Number.isFinite(fadeDuration) || fadeDuration <= 0 || fadeDuration > 0.5) {
      throw new RangeError("PCM crossfade timing is invalid");
    }

    const getValueAtTime = gain => {
      if (!gain) return 0;
      const state = this.sessionGainState.get(gain);
      if (!state || start <= state.startAt) return state?.from ?? 0;
      if (start >= state.endAt) return state.to;
      const progress = (start - state.startAt) / Math.max(0.000001, state.endAt - state.startAt);
      return state.from + (state.to - state.from) * progress;
    };
    const endAt = start + fadeDuration;

    if (oldGain) {
      const parameter = oldGain.gain;
      const from = Math.max(0, Math.min(1, getValueAtTime(oldGain)));
      parameter.cancelScheduledValues(start);
      parameter.setValueAtTime(from, start);
      parameter.linearRampToValueAtTime(0, endAt);
      this.sessionGainState.set(oldGain, { from, to: 0, startAt: start, endAt });
    }
    if (newGain) {
      const parameter = newGain.gain;
      const from = Math.max(0, Math.min(1, getValueAtTime(newGain)));
      parameter.cancelScheduledValues(start);
      parameter.setValueAtTime(from, start);
      parameter.linearRampToValueAtTime(1, endAt);
      this.sessionGainState.set(newGain, { from, to: 1, startAt: start, endAt });
    }
    return endAt;
  }

  retireSessionGain(gain) {
    if (!gain || !this.sessionGains.delete(gain)) return false;
    this.sessionGainState.delete(gain);
    try { gain.disconnect(); } catch (error) {}
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const gain of this.sessionGains) {
      try { gain.disconnect(); } catch (error) {}
    }
    this.sessionGains.clear();
    this.sessionGainState.clear();
    // Clear only if this router still owns the active graph input. A fallback
    // source may have replaced it since construction.
    if (this.clearGraphInput) {
      let cleared = false;
      try { cleared = this.clearGraphInput(this.bus, this.routeNode) === true; } catch (error) {}
      if (cleared) {
        try { this.bus.disconnect(this.routeNode); } catch (error) {
          try { this.bus.disconnect(); } catch (ignore) {}
        }
      }
    }
  }
}

class PcmOutputScheduler {
  constructor(audioContext, inputNode, options = {}) {
    if (!audioContext || typeof audioContext.createBuffer !== "function" ||
        typeof audioContext.createBufferSource !== "function" ||
        !inputNode || typeof inputNode.connect !== "function") {
      throw new TypeError("PCM output scheduler requires an AudioContext and input node");
    }
    this.audioContext = audioContext;
    this.inputNode = inputNode;
    this.defaultLookAheadSeconds = Number(options.lookAheadSeconds) || 0.25;
    this.defaultMinimumLeadSeconds = Number(options.minimumLeadSeconds) || 0.03;
    this.queue = null;
    this.active = false;
    this.eof = false;
    this.error = null;
    this.generation = 0;
    this.pumpPromise = null;
    this.activeSources = new Set();
    this.clockSegments = [];
    this.initialFrame = 0;
    this.pausedFrame = 0;
    this.nextFrame = 0;
    this.nextStartTime = 0;
    this.sampleRate = 0;
    this.playbackRate = 1;
    this.blockFrames = 0;
    this.startBufferFrames = 0;
    this.lookAheadSeconds = this.defaultLookAheadSeconds;
    this.minimumLeadSeconds = this.defaultMinimumLeadSeconds;
    this.hasScheduledData = false;
    this.hasStartTimeAnchor = false;
    this.underrunCount = 0;
    this.onUnderrun = typeof options.onUnderrun === "function" ? options.onUnderrun : null;
    this.onEnded = typeof options.onEnded === "function" ? options.onEnded : null;
    this.onDrained = typeof options.onDrained === "function" ? options.onDrained : null;
    this.onError = typeof options.onError === "function" ? options.onError : null;
    this.isDraining = false;
  }

  get currentFrame() {
    if (!this.active) return this.pausedFrame;
    const now = Number(this.audioContext.currentTime) || 0;
    let activeIndex = -1;
    for (let index = 0; index < this.clockSegments.length; index++) {
      if (now < this.clockSegments[index].startTime) break;
      activeIndex = index;
    }
    if (activeIndex < 0) return this.initialFrame;

    if (activeIndex > 0) {
      const anchor = this.clockSegments[activeIndex];
      this.initialFrame = anchor.startFrame;
      this.clockSegments.splice(0, activeIndex);
      activeIndex = 0;
    }

    const segment = this.clockSegments[activeIndex];
    if (now <= segment.endTime) {
      const elapsed = Math.max(0, now - segment.startTime);
      return Math.floor(Math.min(segment.endFrame, segment.startFrame + elapsed * this.sampleRate * this.playbackRate));
    }
    return segment.endFrame;
  }

  get currentTime() {
    return this.sampleRate > 0 ? this.currentFrame / this.sampleRate : 0;
  }

  start(queue, options = {}) {
    if (this.active || this.pumpPromise || this.activeSources.size) {
      throw new Error("PCM output scheduler is already active or stopping");
    }
    if (!queue || typeof queue.readAsync !== "function" || typeof queue.cancel !== "function") {
      throw new TypeError("PCM output scheduler requires a cancellable PCM queue");
    }
    const startFrame = Number(options.startFrame ?? 0);
    const sampleRate = Number(options.sampleRate);
    const playbackRate = Number(options.playbackRate ?? 1);
    const blockFrames = Number(options.blockFrames ?? queue.maxChunkFrames);
    const startBufferFrames = Number(options.startBufferFrames ?? blockFrames * 2);
    const lookAheadSeconds = Number(options.lookAheadSeconds ?? this.defaultLookAheadSeconds);
    const minimumLeadSeconds = Number(options.minimumLeadSeconds ?? this.defaultMinimumLeadSeconds);
    const hasRequestedStartAt = options.startAtTime !== undefined;
    const requestedStartAt = hasRequestedStartAt
      ? Number(options.startAtTime)
      : (Number(this.audioContext.currentTime) || 0) + minimumLeadSeconds;
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 ||
        !Number.isFinite(sampleRate) || sampleRate < 3000 || sampleRate > 192000 ||
        !Number.isFinite(playbackRate) || playbackRate < 0.5 || playbackRate > 2 ||
        !Number.isInteger(blockFrames) || blockFrames < 1 ||
        !Number.isInteger(queue.maxChunkFrames) || blockFrames > queue.maxChunkFrames ||
        !Number.isSafeInteger(startBufferFrames) || startBufferFrames < 1 || startBufferFrames > 1048576 ||
        !Number.isFinite(lookAheadSeconds) || lookAheadSeconds <= 0 ||
        !Number.isFinite(minimumLeadSeconds) || minimumLeadSeconds <= 0 ||
        minimumLeadSeconds >= lookAheadSeconds ||
        !Number.isFinite(requestedStartAt) || requestedStartAt < 0) {
      throw new RangeError("PCM output scheduler settings are outside the supported range");
    }

    this.queue = queue;
    this.active = true;
    this.eof = false;
    this.error = null;
    this.generation++;
    this.clockSegments = [];
    this.initialFrame = startFrame;
    this.pausedFrame = startFrame;
    this.nextFrame = startFrame;
    this.sampleRate = sampleRate;
    this.playbackRate = playbackRate;
    this.blockFrames = blockFrames;
    this.startBufferFrames = startBufferFrames;
    this.lookAheadSeconds = lookAheadSeconds;
    this.minimumLeadSeconds = minimumLeadSeconds;
    this.nextStartTime = requestedStartAt;
    this.hasScheduledData = false;
    this.hasStartTimeAnchor = hasRequestedStartAt;
    this.isDraining = false;
    this.underrunCount = 0;
    return this.pump();
  }

  pump() {
    if (!this.active) return Promise.resolve(false);
    if (this.pumpPromise) return this.pumpPromise;
    const generation = this.generation;
    const task = (async () => {
      // Do not expose the first audio block until a bounded startup reserve is ready.
      // Short tracks may reach EOF before the target; in that case schedule what exists.
      if (!this.hasScheduledData) {
        const startupChunks = [];
        let startupFrames = 0;
        while (this.active && generation === this.generation && !this.eof &&
               startupFrames < this.startBufferFrames) {
          const chunk = await this.queue.readAsync(this.blockFrames);
          if (!this.active || generation !== this.generation) return false;
          if (!chunk) {
            this.eof = true;
            break;
          }
          const frameCount = Number(chunk.frameCount);
          if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > this.blockFrames) {
            throw new Error("PCM scheduler startup received an invalid or oversized chunk");
          }
          startupChunks.push(chunk);
          startupFrames += frameCount;
        }
        for (const chunk of startupChunks) this.scheduleChunk(chunk);
        if (this.eof && this.activeSources.size === 0) this.finish();
        if (this.eof) return true;
      }

      while (this.active && generation === this.generation && !this.eof &&
             this.nextStartTime <= (Number(this.audioContext.currentTime) || 0) + this.lookAheadSeconds) {
        const chunk = await this.queue.readAsync(this.blockFrames);
        if (!this.active || generation !== this.generation) return false;
        if (!chunk) {
          this.eof = true;
          if (this.activeSources.size === 0) this.finish();
          return true;
        }
        this.scheduleChunk(chunk);
      }
      return true;
    })();
    const wrapped = task.catch(error => {
      if (this.active && generation === this.generation) this.fail(error);
      throw error;
    }).finally(() => {
      if (this.pumpPromise === wrapped) this.pumpPromise = null;
    });
    this.pumpPromise = wrapped;
    return wrapped;
  }

  scheduleChunk(chunk) {
    const frameCount = Number(chunk?.frameCount);
    const chunkRate = Number(chunk?.sampleRate) || this.sampleRate;
    if (!Number.isSafeInteger(chunk?.startFrame) || chunk.startFrame !== this.nextFrame ||
        !Number.isInteger(frameCount) || frameCount < 1 || frameCount > this.blockFrames ||
        !chunk.left || !chunk.right || chunk.left.length < frameCount || chunk.right.length < frameCount ||
        chunkRate !== this.sampleRate) {
      throw new Error("PCM scheduler received an invalid, discontinuous, or mismatched chunk");
    }

    const now = Number(this.audioContext.currentTime) || 0;
    const previousEndTime = this.nextStartTime;
    const startAt = Math.max(previousEndTime, now + this.minimumLeadSeconds);
    const gapSeconds = Math.max(0, startAt - previousEndTime);
    if ((this.hasScheduledData || this.hasStartTimeAnchor) && gapSeconds > 0.000001) {
      this.underrunCount++;
      try {
        this.onUnderrun?.({ frame: this.nextFrame, gapSeconds, count: this.underrunCount });
      } catch (error) {}
    }

    let source = null;
    try {
      const buffer = this.audioContext.createBuffer(2, frameCount, this.sampleRate);
      buffer.getChannelData(0).set(chunk.left.subarray ? chunk.left.subarray(0, frameCount) : chunk.left);
      buffer.getChannelData(1).set(chunk.right.subarray ? chunk.right.subarray(0, frameCount) : chunk.right);
      source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.setValueAtTime(this.playbackRate, startAt);
      source.connect(this.inputNode);
    } catch (error) {
      try { source?.disconnect(); } catch (ignore) {}
      throw error;
    }

    const endTime = startAt + frameCount / this.sampleRate / this.playbackRate;
    const endFrame = this.nextFrame + frameCount;
    const previousSegment = this.clockSegments[this.clockSegments.length - 1];
    if (previousSegment && Math.abs(startAt - previousSegment.endTime) < 0.000001 &&
        chunk.startFrame === previousSegment.endFrame) {
      previousSegment.endTime = endTime;
      previousSegment.endFrame = endFrame;
    } else {
      this.clockSegments.push({
        startTime: startAt,
        startFrame: chunk.startFrame,
        endTime,
        endFrame
      });
    }

    source.onended = () => {
      if (!this.activeSources.delete(source)) return;
      try { source.disconnect(); } catch (error) {}
      if (this.eof && this.activeSources.size === 0) this.finish();
    };
    this.activeSources.add(source);
    try {
      source.start(startAt);
    } catch (error) {
      this.activeSources.delete(source);
      source.onended = null;
      try { source.disconnect(); } catch (ignore) {}
      throw error;
    }

    this.nextFrame = endFrame;
    this.nextStartTime = endTime;
    this.hasScheduledData = true;
  }

  finish() {
    if (!this.active) return;
    const wasDraining = this.isDraining;
    this.active = false;
    this.pausedFrame = this.nextFrame;
    this.queue = null;
    this.isDraining = false;
    if (wasDraining) {
      try { this.onDrained?.(this.pausedFrame); } catch (error) {}
    } else {
      try { this.onEnded?.(this.pausedFrame); } catch (error) {}
    }
  }

  drainForHandoff() {
    const handoff = {
      startFrame: this.active ? this.nextFrame : this.pausedFrame,
      startAtTime: this.active ? this.nextStartTime : (Number(this.audioContext.currentTime) || 0)
    };
    if (!this.active) return handoff;

    this.isDraining = true;
    this.eof = true;
    this.generation++;
    const queue = this.queue;
    this.queue = null;
    try { queue?.cancel(); } catch (error) {}
    if (this.activeSources.size === 0) this.finish();
    return handoff;
  }

  fail(error) {
    this.error = error;
    const frame = this.currentFrame;
    this.active = false;
    this.generation++;
    this.isDraining = false;
    const queue = this.queue;
    this.queue = null;
    try { queue?.cancel(); } catch (ignore) {}
    for (const source of this.activeSources) {
      source.onended = null;
      try { source.stop(); } catch (ignore) {}
      try { source.disconnect(); } catch (ignore) {}
    }
    this.activeSources.clear();
    this.pausedFrame = frame;
    this.initialFrame = frame;
    this.clockSegments = [];
    try { this.onError?.(error, frame); } catch (ignore) {}
  }

  stop() {
    const frame = this.currentFrame;
    this.active = false;
    this.generation++;
    const queue = this.queue;
    this.queue = null;
    try { queue?.cancel(); } catch (ignore) {}
    for (const source of this.activeSources) {
      source.onended = null;
      try { source.stop(); } catch (ignore) {}
      try { source.disconnect(); } catch (ignore) {}
    }
    this.activeSources.clear();
    this.eof = false;
    this.pausedFrame = frame;
    this.initialFrame = frame;
    this.nextFrame = frame;
    this.clockSegments = [];
    this.hasScheduledData = false;
    this.hasStartTimeAnchor = false;
    this.isDraining = false;
    return frame;
  }
}

class PcmOutputPumpLoop {
  constructor(scheduler, options = {}) {
    if (!scheduler || typeof scheduler.start !== "function" ||
        typeof scheduler.pump !== "function" || typeof scheduler.stop !== "function" ||
        typeof scheduler.drainForHandoff !== "function") {
      throw new TypeError("PCM pump loop requires a compatible output scheduler");
    }
    const intervalMs = Number(options.intervalMs ?? 50);
    if (!Number.isFinite(intervalMs) || intervalMs < 10 || intervalMs > 500) {
      throw new RangeError("PCM pump interval must be between 10 and 500 milliseconds");
    }
    this.scheduler = scheduler;
    this.intervalMs = intervalMs;
    this.schedule = typeof options.schedule === "function"
      ? options.schedule
      : (callback, delay) => setTimeout(callback, delay);
    this.cancel = typeof options.cancel === "function"
      ? options.cancel
      : timer => clearTimeout(timer);
    this.active = false;
    this.generation = 0;
    this.timer = null;
    this.pumpPromise = null;
  }

  async start(queue, options = {}) {
    if (this.active || this.timer !== null) {
      throw new Error("PCM pump loop is already active or stopping");
    }
    const previousPump = this.pumpPromise;
    this.active = true;
    const generation = ++this.generation;
    if (previousPump) {
      try { await previousPump; } catch (error) {}
    }
    if (!this.active || generation !== this.generation) {
      throw new Error("PCM pump loop start was cancelled");
    }

    let initialPump;
    try {
      initialPump = this.scheduler.start(queue, options);
    } catch (error) {
      this.active = false;
      throw error;
    }
    const task = Promise.resolve(initialPump).then(result => {
      this.scheduleNext(generation);
      return result;
    }, error => {
      if (generation === this.generation) this.active = false;
      throw error;
    });
    this.pumpPromise = task;
    try {
      return await task;
    } finally {
      if (this.pumpPromise === task) this.pumpPromise = null;
    }
  }

  scheduleNext(generation) {
    if (!this.active || generation !== this.generation || !this.scheduler.active) {
      this.active = false;
      return;
    }
    if (this.timer !== null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (!this.active || generation !== this.generation) return;
      const task = Promise.resolve().then(() => this.scheduler.pump());
      this.pumpPromise = task;
      task.then(() => {
        this.scheduleNext(generation);
      }, error => {
        if (generation === this.generation) this.active = false;
        try { this.cancelTimer(); } catch (ignore) {}
      }).finally(() => {
        if (this.pumpPromise === task) this.pumpPromise = null;
      });
    }, this.intervalMs);
  }

  cancelTimer() {
    if (this.timer === null) return;
    const timer = this.timer;
    this.timer = null;
    try { this.cancel(timer); } catch (error) {}
  }

  stop() {
    this.active = false;
    this.generation++;
    this.cancelTimer();
    return this.scheduler.stop();
  }

  drainForHandoff() {
    this.active = false;
    this.generation++;
    this.cancelTimer();
    return this.scheduler.drainForHandoff();
  }
}

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
    this.processorWorker = null;
    this.processorRequestId = 0;
    this.processorRequests = new Map();
    this.processorReady = null;
    this.processingSessionId = 0;
    this.activePcmQueue = null;
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


  async ensureProcessorWorker(settings = {}) {
    if (this.processorWorker && this.processorReady) return this.processorReady;
    if (typeof Worker !== "function") throw new Error("Web Worker is unavailable");
    const worker = new Worker(new URL("js/11. pcm-processing-worker.js", document.baseURI));
    this.processorWorker = worker;
    const failWorker = error => {
      for (const pending of this.processorRequests.values()) pending.reject(error);
      this.processorRequests.clear();
      try { worker.terminate(); } catch (e) {}
      if (this.processorWorker === worker) {
        this.processorWorker = null;
        this.processorReady = null;
      }
    };
    worker.onmessage = event => {
      const message = event.data || {};
      const pending = this.processorRequests.get(message.id);
      if (!pending) return;
      this.processorRequests.delete(message.id);
      if (message.type === "error") {
        pending.reject(new Error(message.message || "PCM processing failed"));
      } else if (message.type !== pending.expectedType) {
        pending.reject(new Error(`Unexpected PCM worker response: expected ${pending.expectedType}, received ${String(message.type)}`));
      } else if (pending.sequence !== null && message.sequence !== pending.sequence) {
        pending.reject(new Error("PCM worker response sequence does not match the request"));
      } else {
        pending.resolve(message);
      }
    };
    worker.onerror = event => failWorker(new Error(event.message || "PCM processing worker failed"));
    worker.onmessageerror = () => failWorker(new Error("PCM processing worker message could not be deserialized"));
    const sampleRate = this.buffer?.sampleRate || audioCtx?.sampleRate || 48000;
    const eqGains = Array.isArray(settings.eqGains) ? settings.eqGains.slice(0, 5) : state.eqState.gains.slice(0, 5);
    const pitch = Number.isFinite(Number(settings.pitch))
      ? Number(settings.pitch)
      : Math.pow(2, Number(state.pitchSemitones || 0) / 12) / Math.max(0.1, this.playbackRate);
    this.processorReady = this.sendProcessorMessage("init", { sampleRate, eqGains, pitch })
      .catch(error => {
        this.disposeProcessorWorker();
        throw error;
      });
    return this.processorReady;
  }

  sendProcessorMessage(type, payload = {}, transfer = []) {
    const worker = this.processorWorker;
    if (!worker) return Promise.reject(new Error("PCM processing worker is not ready"));
    const responseTypes = {
      init: "ready",
      configure: "configured",
      reset: "reset",
      process: "processed",
      dispose: "disposed"
    };
    const expectedType = responseTypes[type];
    if (!expectedType) return Promise.reject(new Error(`Unsupported PCM worker request: ${type}`));
    const id = ++this.processorRequestId;
    const sequence = type === "process" ? payload.sequence : null;
    return new Promise((resolve, reject) => {
      this.processorRequests.set(id, { resolve, reject, expectedType, sequence });
      try {
        worker.postMessage({ type, id, ...payload }, transfer);
      } catch (error) {
        this.processorRequests.delete(id);
        reject(error);
      }
    });
  }

  async *iterateProcessedChunks(options = {}) {
    const generation = this.generation;
    const sessionId = ++this.processingSessionId;
    if (!this.buffer) await this.prepare();
    if (generation !== this.generation || sessionId !== this.processingSessionId) {
      throw new Error("PCM processing was cancelled");
    }
    if (!this.buffer) throw new Error("PCM source is not decoded");
    const sampleRate = this.buffer.sampleRate;
    const chunkFrames = Math.max(1024, Math.min(32768, Math.round(Number(options.chunkFrames) || 8192)));
    const startFrame = Math.max(0, Math.min(this.buffer.length, Math.floor(Number(options.startFrame) || 0)));
    const eqGains = Array.isArray(options.eqGains) ? options.eqGains.slice(0, 5) : state.eqState.gains.slice(0, 5);
    const pitch = Number.isFinite(Number(options.pitch))
      ? Number(options.pitch)
      : Math.pow(2, Number(state.pitchSemitones || 0) / 12) / Math.max(0.1, this.playbackRate);
    if (pitch < 0.5 || pitch > 2) throw new Error("Pitch ratio is outside the PCM processor range");

    await this.ensureProcessorWorker({ eqGains, pitch });
    if (generation !== this.generation || sessionId !== this.processingSessionId) throw new Error("PCM processing was cancelled");
    await this.sendProcessorMessage("reset");
    if (generation !== this.generation || sessionId !== this.processingSessionId) throw new Error("PCM processing was cancelled");
    await this.sendProcessorMessage("configure", { eqGains, pitch });

    // Warm the stateful EQ and granular pitch processor with audio before the requested seek point.
    const warmupFrames = Math.min(startFrame, Math.ceil(sampleRate * 1.5));
    const processStart = startFrame - warmupFrames;
    const pitchLatencyFrames = Math.abs(pitch - 1) < 0.0001
      ? 0
      : Math.ceil(Math.max(2048, Math.round(sampleRate * 0.09)) * (pitch > 1 ? pitch + 0.35 : 1.35));
    const totalInputFrames = this.buffer.length - processStart + pitchLatencyFrames;
    let sequence = 0;
    let outputFrames = 0;

    // The granular pitch shifter is causal and has a fixed startup delay.
    // Discard that leading delay and feed zeroes at EOF to return a duration-aligned PCM stream.
    for (let relativeOffset = 0; relativeOffset < totalInputFrames; relativeOffset += chunkFrames) {
      if (generation !== this.generation || sessionId !== this.processingSessionId || !this.processorWorker) {
        throw new Error("PCM processing was cancelled");
      }
      const frameCount = Math.min(chunkFrames, totalInputFrames - relativeOffset);
      const absoluteInputOffset = processStart + relativeOffset;
      const realStart = Math.min(this.buffer.length, absoluteInputOffset);
      const realEnd = Math.min(this.buffer.length, absoluteInputOffset + frameCount);
      const realFrames = Math.max(0, realEnd - realStart);
      const left = new Float32Array(frameCount);
      const right = new Float32Array(frameCount);
      if (realFrames > 0) {
        const sourceLeft = this.buffer.getChannelData(0);
        const sourceRight = this.buffer.numberOfChannels > 1 ? this.buffer.getChannelData(1) : sourceLeft;
        left.set(sourceLeft.subarray(realStart, realEnd));
        right.set(sourceRight.subarray(realStart, realEnd));
      }

      const result = await this.sendProcessorMessage("process", {
        sequence, left, right
      }, [left.buffer, right.buffer]);
      sequence++;
      if (generation !== this.generation || sessionId !== this.processingSessionId) {
        throw new Error("PCM processing was cancelled");
      }

      const sourceFrameAtResultStart = absoluteInputOffset - processStart - pitchLatencyFrames + processStart;
      const discard = Math.max(0, startFrame - sourceFrameAtResultStart);
      const validSourceFrames = Math.max(0, Math.min(
        result.frameCount - discard,
        this.buffer.length - Math.max(startFrame, sourceFrameAtResultStart + discard)
      ));
      if (validSourceFrames <= 0) continue;
      const outputLeft = result.left.subarray(discard, discard + validSourceFrames);
      const outputRight = result.right.subarray(discard, discard + validSourceFrames);
      const outputStartFrame = Math.max(startFrame, sourceFrameAtResultStart + discard);
      outputFrames += validSourceFrames;
      yield {
        startFrame: outputStartFrame,
        sampleRate,
        frameCount: validSourceFrames,
        left: outputLeft,
        right: outputRight
      };
    }

    if (outputFrames !== this.buffer.length - startFrame) {
      throw new Error("PCM preprocessing produced an incomplete frame range");
    }
  }

  cancelProcessedPcmQueue() {
    this.processingSessionId++;
    const queue = this.activePcmQueue;
    this.activePcmQueue = null;
    queue?.cancel();
  }

  async createProcessedPcmQueue(options = {}) {
    const chunkFrames = Math.max(1024, Math.min(32768, Math.round(Number(options.chunkFrames) || 8192)));
    const capacityFrames = options.capacityFrames === undefined
      ? chunkFrames * 4
      : Number(options.capacityFrames);
    if (!Number.isInteger(capacityFrames) || capacityFrames < chunkFrames * 2 ||
        capacityFrames > 1048576) {
      throw new RangeError("PCM queue capacity must fit at least two chunks and not exceed 1048576 frames");
    }

    this.cancelProcessedPcmQueue();
    const generation = this.generation;
    const requestSessionId = this.processingSessionId;
    if (!this.buffer) await this.prepare();
    if (generation !== this.generation ||
        requestSessionId !== this.processingSessionId || !this.buffer) {
      throw new Error("PCM queue creation was cancelled");
    }
    const startFrame = Math.max(0, Math.min(this.buffer.length, Math.floor(Number(options.startFrame) || 0)));

    const ringBuffer = new ProcessedPcmRingBuffer(capacityFrames);
    ringBuffer.clear(startFrame);
    const iterator = this.iterateProcessedChunks({ ...options, chunkFrames, startFrame });
    const queue = new PcmPrebufferQueue(ringBuffer, iterator, chunkFrames);
    this.activePcmQueue = queue;
    queue.start();
    return queue;
  }

  disposeProcessorWorker() {
    this.cancelProcessedPcmQueue();
    const worker = this.processorWorker;
    this.processorWorker = null;
    this.processorReady = null;
    for (const pending of this.processorRequests.values()) {
      pending.reject(new Error("PCM processing worker was disposed"));
    }
    this.processorRequests.clear();
    try { worker?.terminate(); } catch (e) {}
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
    if (typeof resetPitchShifter === "function") resetPitchShifter();
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
    this.cancelProcessedPcmQueue();
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
    this.cancelProcessedPcmQueue();
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
    this.cancelProcessedPcmQueue();
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
    this.disposeProcessorWorker();
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
    this.disposeProcessorWorker();
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
