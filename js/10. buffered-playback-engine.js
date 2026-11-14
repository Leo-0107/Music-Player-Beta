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

// Owns an isolated stateful PCM Worker for one processing session.
// Separate instances prevent configure/reset messages from corrupting another queue's DSP state.
class PcmProcessingWorkerSession {
  constructor(options = {}) {
    const WorkerConstructor = options.WorkerClass || Worker;
    const workerUrl = options.workerUrl || new URL("js/11. pcm-processing-worker.js", document.baseURI);
    if (typeof WorkerConstructor !== "function") throw new Error("Web Worker is unavailable");
    this.worker = new WorkerConstructor(workerUrl);
    this.requests = new Map();
    this.requestId = 0;
    this.initialized = false;
    this.disposed = false;
    this.readyPromise = null;
    this.worker.onmessage = event => {
      const message = event.data || {};
      const pending = this.requests.get(message.id);
      if (!pending) return;
      this.requests.delete(message.id);
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
    this.worker.onerror = event => this.fail(new Error(event.message || "PCM processing worker failed"));
    this.worker.onmessageerror = () => this.fail(new Error("PCM processing worker message could not be deserialized"));
  }

  get active() {
    return !this.disposed;
  }

  send(type, payload = {}, transfer = []) {
    if (this.disposed || !this.worker) {
      return Promise.reject(new Error("PCM processing session is disposed"));
    }
    const responseTypes = {
      init: "ready", configure: "configured", reset: "reset",
      process: "processed", dispose: "disposed"
    };
    const expectedType = responseTypes[type];
    if (!expectedType) return Promise.reject(new Error(`Unsupported PCM worker request: ${type}`));
    const id = ++this.requestId;
    const sequence = type === "process" ? payload.sequence : null;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject, expectedType, sequence });
      try {
        this.worker.postMessage({ type, id, ...payload }, transfer);
      } catch (error) {
        this.requests.delete(id);
        reject(error);
      }
    });
  }

  initialize(settings = {}) {
    if (this.disposed) return Promise.reject(new Error("PCM processing session is disposed"));
    if (this.initialized) return Promise.resolve(true);
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.send("init", settings).then(() => {
      if (this.disposed) throw new Error("PCM processing session was disposed during initialization");
      this.initialized = true;
      return true;
    }).catch(error => {
      this.fail(error);
      throw error;
    });
    return this.readyPromise;
  }

  fail(error) {
    this.dispose(error || new Error("PCM processing worker failed"));
  }

  dispose(reason = new Error("PCM processing session was disposed")) {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.requests.values()) pending.reject(reason);
    this.requests.clear();
    const worker = this.worker;
    this.worker = null;
    try { worker?.terminate(); } catch (error) {}
  }
}

// Bounded producer/consumer queue for processed PCM. This is intentionally not wired
// into audible playback until the output scheduler and DSP ownership are validated.
class PcmPrebufferQueue {
  constructor(ringBuffer, iterator, maxChunkFrames = 8192, onSettle = null) {
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
    this.onSettle = typeof onSettle === "function" ? onSettle : null;
    this.settled = false;
  }

  settle() {
    if (this.settled) return;
    this.settled = true;
    try { this.onSettle?.(this); } catch (error) {}
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
            if (this.ringBuffer.availableFrames === 0) this.settle();
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
        this.settle();
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
        if (this.done && this.ringBuffer.availableFrames === 0) this.settle();
        this.pump();
        return chunk;
      }
      if (this.done || !this.running) {
        const chunk = this.ringBuffer.read(requested);
        if (this.ringBuffer.availableFrames === 0) this.settle();
        return chunk;
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
    this.settle();
  }
}

// Schedules already-processed PCM chunks without changing the audible graph yet.
// The caller owns the polling cadence and the single input GainNode connected after EQ/pitch.
// Shared post-EQ/pitch input bus for multiple preprocessed PCM sessions.
// Session GainNodes can be crossfaded without replacing the single graph input connection.
class PcmGraphInputOwnership {
  constructor() {
    this.activeNode = null;
    this.activeTarget = null;
  }

  set(node, target) {
    if (!node) {
      this.reset();
      return true;
    }
    if (!target || typeof node.connect !== "function" ||
        typeof node.disconnect !== "function") {
      throw new TypeError("PCM graph input requires a connectable node and target");
    }
    if (this.activeNode === node && this.activeTarget === target) return true;

    // Connect the replacement first. If connection fails, the current audible
    // route remains intact and the caller can safely fall back.
    node.connect(target);
    const previousNode = this.activeNode;
    const previousTarget = this.activeTarget;
    this.activeNode = node;
    this.activeTarget = target;
    if (previousNode && previousTarget) {
      try { previousNode.disconnect(previousTarget); } catch (error) {}
    }
    return true;
  }

  clear(expectedNode, expectedTarget = null) {
    if (!expectedNode || this.activeNode !== expectedNode) return false;
    if (expectedTarget && this.activeTarget !== expectedTarget) return false;
    const node = this.activeNode;
    const target = this.activeTarget;
    this.activeNode = null;
    this.activeTarget = null;
    if (node && target) {
      try { node.disconnect(target); } catch (error) {}
    }
    return true;
  }

  reset() {
    const node = this.activeNode;
    const target = this.activeTarget;
    this.activeNode = null;
    this.activeTarget = null;
    if (node && target) {
      try { node.disconnect(target); } catch (error) {}
    }
    return true;
  }
}

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

  attach() {
    if (this.disposed) throw new Error("PCM graph router is disposed");
    if (this.setGraphInput(this.bus, this.routeNode) === false) {
      throw new Error("PCM graph input could not be reconnected");
    }
    return true;
  }

  detach() {
    if (this.disposed) return false;
    // clearGraphInput owns the exact edge and performs its disconnection.
    // Do not disconnect the same edge again: a redundant AudioNode.disconnect
    // may throw and a broad disconnect() would also sever session gains.
    try { return this.clearGraphInput(this.bus, this.routeNode) === true; } catch (error) {
      return false;
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
    // detach() must run before marking the router disposed.
    // It clears the graph input only when this router still owns it.
    this.detach();
    this.disposed = true;
    for (const gain of this.sessionGains) {
      try { gain.disconnect(); } catch (error) {}
    }
    this.sessionGains.clear();
    this.sessionGainState.clear();
    try { this.bus.disconnect(); } catch (error) {}
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
    this.firstScheduledAt = null;
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
    this.firstScheduledAt = null;
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
      throw new Error(`PCM scheduler received an invalid, discontinuous, or mismatched chunk (start=${String(chunk?.startFrame)} expected=${this.nextFrame} frames=${frameCount} rate=${chunkRate}/${this.sampleRate} left=${chunk?.left?.length} right=${chunk?.right?.length})`);
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

    if (this.firstScheduledAt === null) this.firstScheduledAt = startAt;
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
    this.onError = typeof options.onError === "function" ? options.onError : null;
    this.lastError = null;
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
      if (!this.scheduleNext(generation)) throw this.lastError || new Error("PCM pump timer could not be scheduled");
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
    // A stale generation or a scheduler that already ended needs no timer;
    // these are normal lifecycle outcomes, not timer-registration failures.
    if (generation !== this.generation) return true;
    if (!this.active || !this.scheduler.active) {
      this.active = false;
      return true;
    }
    if (this.timer !== null) return true;
    try {
      this.timer = this.schedule(() => {
        this.timer = null;
        if (!this.active || generation !== this.generation) return;
        const task = Promise.resolve().then(() => this.scheduler.pump());
        this.pumpPromise = task;
        task.then(() => {
          this.scheduleNext(generation);
        }, error => {
          if (generation === this.generation) this.active = false;
          this.cancelTimer();
          try { this.onError?.(error); } catch (ignore) {}
        }).finally(() => {
          if (this.pumpPromise === task) this.pumpPromise = null;
        });
      }, this.intervalMs);
      if (this.timer === null || this.timer === undefined) {
        throw new Error("PCM pump timer scheduler did not return a timer handle");
      }
      return true;
    } catch (error) {
      this.lastError = error;
      this.active = false;
      this.generation++;
      this.cancelTimer();
      try { this.scheduler.stop(); } catch (ignore) {}
      try { this.onError?.(error); } catch (ignore) {}
      return false;
    }
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

class PcmPlaybackSessionController {
  constructor(audioContext, graphRouter, options = {}) {
    if (!audioContext || !graphRouter ||
        typeof graphRouter.attach !== "function" ||
        typeof graphRouter.createSessionGain !== "function" ||
        typeof graphRouter.crossfade !== "function" ||
        typeof graphRouter.retireSessionGain !== "function" ||
        typeof graphRouter.dispose !== "function") {
      throw new TypeError("PCM session controller requires an AudioContext and graph router");
    }
    this.audioContext = audioContext;
    this.graphRouter = graphRouter;
    this.intervalMs = Number(options.intervalMs ?? 50);
    this.schedule = options.schedule;
    this.cancel = options.cancel;
    this.state = "idle";
    this.activeSession = null;
    this.drainingSessions = new Set();
    this.generation = 0;
    this.lastFrame = 0;
    this.lastError = null;
  }

  get currentFrame() {
    const draining = Array.from(this.drainingSessions).filter(session => session.scheduler.active);
    const latestDraining = draining.length ? draining[draining.length - 1] : null;
    const active = this.activeSession?.scheduler.active ? this.activeSession : null;
    if (active) {
      const firstAt = active.scheduler.firstScheduledAt;
      const now = Number(this.audioContext.currentTime) || 0;
      // A replacement session can be prepared before its scheduled start time.
      // Until that boundary is audible, the old draining scheduler remains the
      // authoritative playback clock.
      if (latestDraining && (firstAt === null || now < firstAt)) {
        return latestDraining.scheduler.currentFrame;
      }
      return active.scheduler.currentFrame;
    }
    // During handoff there may be no activeSession while old scheduled audio
    // drains. Its live clock, not the future handoff boundary, is authoritative.
    if (latestDraining) return latestDraining.scheduler.currentFrame;
    return this.lastFrame;
  }

  retireSession(session) {
    if (!session || session.retired) return;
    session.retired = true;
    this.graphRouter.retireSessionGain(session.gain);
    this.drainingSessions.delete(session);
    if (this.activeSession === session) this.activeSession = null;
  }

  createSession(queue, options, initialGain) {
    this.graphRouter.attach();
    const gain = this.graphRouter.createSessionGain(initialGain);
    let session = null;
    let scheduler;
    let loop;
    try {
      scheduler = new PcmOutputScheduler(this.audioContext, gain, {
        lookAheadSeconds: options.lookAheadSeconds,
        minimumLeadSeconds: options.minimumLeadSeconds,
        onUnderrun: detail => {
          try { options.onUnderrun?.(detail); } catch (error) {}
        },
        onEnded: frame => {
          this.lastFrame = frame;
          const wasActive = this.activeSession === session;
          this.retireSession(session);
          if (wasActive && this.state !== "disposed") this.state = "ended";
          try { options.onEnded?.(frame); } catch (error) {}
        },
        onDrained: frame => {
          this.lastFrame = frame;
          const wasActive = this.activeSession === session;
          this.retireSession(session);
          if (wasActive && this.state !== "disposed") this.state = "idle";
          try { options.onDrained?.(frame); } catch (error) {}
        },
        onError: (error, frame) => {
          this.lastFrame = frame;
          this.lastError = error;
          const wasActive = this.activeSession === session;
          this.retireSession(session);
          if (wasActive && this.state !== "disposed") this.state = "error";
          try { options.onError?.(error, frame); } catch (ignore) {}
        }
      });
      loop = new PcmOutputPumpLoop(scheduler, {
        intervalMs: options.intervalMs ?? this.intervalMs,
        schedule: options.schedule ?? this.schedule,
        cancel: options.cancel ?? this.cancel,
        onError: error => {
          this.lastError = error;
          if (this.activeSession === session) {
            this.retireSession(session);
            this.state = "error";
          }
        }
      });
    } catch (error) {
      this.graphRouter.retireSessionGain(gain);
      throw error;
    }
    session = { queue, gain, scheduler, loop, retired: false };
    return session;
  }

  async start(queue, options = {}) {
    if (this.state === "disposed") throw new Error("PCM session controller is disposed");
    if (this.activeSession) throw new Error("PCM session controller already has an active session");
    const generation = ++this.generation;
    this.lastError = null;
    const session = this.createSession(queue, options, options.initialGain ?? 1);
    this.activeSession = session;
    this.state = "starting";
    try {
      await session.loop.start(queue, options);
    } catch (error) {
      if (generation === this.generation) {
        this.retireSession(session);
        if (this.activeSession === null) this.state = "error";
      }
      throw error;
    }
    if (generation !== this.generation || this.activeSession !== session) {
      session.loop.stop();
      this.retireSession(session);
      return false;
    }
    this.state = session.scheduler.active ? "running" : "ended";
    return session;
  }

  async handoff(queueOrFactory, options = {}) {
    if (this.state === "disposed") throw new Error("PCM session controller is disposed");
    const draining = Array.from(this.drainingSessions).filter(session => session.scheduler.active);
    const previous = this.activeSession || (draining.length ? draining[draining.length - 1] : null);
    if (!previous) {
      const initialQueue = typeof queueOrFactory === "function"
        ? await queueOrFactory({
            startFrame: Number(options.startFrame) || 0,
            startAtTime: options.startAtTime
          })
        : queueOrFactory;
      return this.start(initialQueue, options);
    }

    const generation = ++this.generation;
    // A newer setting change may arrive while the previous handoff is still
    // preparing its queue. Continue from the latest draining scheduler instead
    // of starting a second independent stream at an unrelated frame.
    const handoff = previous.loop.drainForHandoff();
    this.lastFrame = handoff.startFrame;
    if (previous.retired) this.drainingSessions.delete(previous);
    else this.drainingSessions.add(previous);
    if (this.activeSession === previous) this.activeSession = null;
    this.state = "handoff";

    const nextOptions = {
      ...options,
      startFrame: handoff.startFrame,
      startAtTime: handoff.startAtTime,
      initialGain: 0
    };
    let next = null;
    let nextQueue = null;
    try {
      // A queue factory receives the exact frame/time boundary after the old
      // scheduler has drained new input. It can prepare a separate Worker queue
      // while already-scheduled old audio continues toward that boundary.
      nextQueue = typeof queueOrFactory === "function"
        ? await queueOrFactory(handoff)
        : queueOrFactory;
      if (!nextQueue || typeof nextQueue.readAsync !== "function" ||
          typeof nextQueue.cancel !== "function") {
        throw new TypeError("PCM handoff requires a prepared cancellable queue");
      }
      if (generation !== this.generation) {
        nextQueue.cancel();
        return false;
      }
      next = this.createSession(nextQueue, nextOptions, 0);
      this.activeSession = next;
      await next.loop.start(nextQueue, nextOptions);

      if (generation !== this.generation || this.activeSession !== next) {
        next.loop.stop();
        this.retireSession(next);
        return false;
      }

      const firstAt = next.scheduler.firstScheduledAt;
      if (firstAt !== null && next.scheduler.active) {
        const fadeDuration = Math.max(0.005, Math.min(0.1, Number(options.crossfadeSeconds) || 0.02));
        const oldIsAudible = previous.scheduler.active &&
          previous.scheduler.activeSources.size > 0 &&
          firstAt <= handoff.startAtTime + 0.001;
        if (oldIsAudible && !previous.retired) {
          const fadeStart = Math.max(
            Number(this.audioContext.currentTime) || 0,
            firstAt - fadeDuration
          );
          const actualFadeDuration = Math.max(0.005, firstAt - fadeStart);
          this.graphRouter.crossfade(previous.gain, next.gain, fadeStart, actualFadeDuration);
        } else {
          this.graphRouter.crossfade(null, next.gain, firstAt, fadeDuration);
        }
      }

      this.state = next.scheduler.active ? "running" : "ended";
      return { session: next, handoff };
    } catch (error) {
      if (next && !next.retired) {
        try { next.loop.stop(); } catch (ignore) {}
        this.retireSession(next);
      }
      if (generation === this.generation) {
        if (this.activeSession === next) this.activeSession = null;
        this.lastError = error;
        this.state = "error";
      }
      throw error;
    }
  }

  stop() {
    if (this.state === "disposed") return this.lastFrame;
    this.generation++;
    // Snapshot the audible scheduler clock before stopping active or draining
    // sessions. During an async handoff lastFrame is the future boundary.
    let frame = this.currentFrame;
    const active = this.activeSession;
    this.activeSession = null;
    if (active) {
      frame = active.loop.stop();
      this.lastFrame = frame;
      this.retireSession(active);
    } else {
      this.lastFrame = frame;
    }
    for (const session of Array.from(this.drainingSessions)) {
      session.loop.stop();
      this.retireSession(session);
    }
    this.state = "paused";
    return frame;
  }

  dispose() {
    if (this.state === "disposed") return;
    this.stop();
    this.graphRouter.dispose();
    this.state = "disposed";
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
    this.activePcmQueues = new Set();
    this.pcmOutputController = null;
    this.pcmGraphRouter = null;
    this.pcmOutputContext = null;
    this.pcmRouteNode = null;
    this.pcmSampleRate = 0;
    this.pcmPlaybackGeneration = 0;
    this.pcmSettingsTimer = null;
  }

  get readyState() {
    return this._readyState;
  }

  get duration() {
    return this.buffer?.duration || Number(state.currentSong?.duration) || NaN;
  }

  get currentTime() {
    if (this.paused) return this.offset;
    if (this.pcmOutputController && this.pcmSampleRate > 0 &&
        (this.pcmOutputController.activeSession || this.pcmOutputController.drainingSessions.size > 0)) {
      return Math.max(0, Math.min(
        this.duration || this.offset,
        this.pcmOutputController.currentFrame / this.pcmSampleRate
      ));
    }
    if (!audioCtx || !this.startedAt) return this.offset;
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
    const workerSession = options.workerSession || null;
    const sessionId = workerSession ? null : ++this.processingSessionId;
    const isCancelled = () => generation !== this.generation ||
      (workerSession ? !workerSession.active : sessionId !== this.processingSessionId);
    const send = (type, payload = {}, transfer = []) => workerSession
      ? workerSession.send(type, payload, transfer)
      : this.sendProcessorMessage(type, payload, transfer);
    if (!this.buffer) await this.prepare();
    if (isCancelled()) {
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

    if (workerSession) {
      await workerSession.initialize({ sampleRate, eqGains, pitch });
    } else {
      await this.ensureProcessorWorker({ eqGains, pitch });
    }
    if (isCancelled()) throw new Error("PCM processing was cancelled");
    await send("reset");
    if (isCancelled()) throw new Error("PCM processing was cancelled");
    await send("configure", { eqGains, pitch });

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
      if (isCancelled() || (!workerSession && !this.processorWorker)) {
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

      const result = await send("process", {
        sequence, left, right
      }, [left.buffer, right.buffer]);
      sequence++;
      if (isCancelled()) {
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
    const queues = Array.from(this.activePcmQueues);
    if (this.activePcmQueue && !queues.includes(this.activePcmQueue)) queues.push(this.activePcmQueue);
    this.activePcmQueue = null;
    this.activePcmQueues.clear();
    for (const queue of queues) queue.cancel();
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

    // Concurrent queues are reserved for seamless handoff. Each owns an isolated
    // Worker because the EQ and pitch processors retain state between chunks.
    const concurrentSession = options.concurrentSession === true;
    if (!concurrentSession) this.cancelProcessedPcmQueue();
    const generation = this.generation;
    const requestSessionId = this.processingSessionId;
    if (!this.buffer) await this.prepare();
    if (generation !== this.generation ||
        (!concurrentSession && requestSessionId !== this.processingSessionId) || !this.buffer) {
      throw new Error("PCM queue creation was cancelled");
    }
    const workerSession = concurrentSession ? new PcmProcessingWorkerSession() : null;
    const startFrame = Math.max(0, Math.min(this.buffer.length, Math.floor(Number(options.startFrame) || 0)));

    const ringBuffer = new ProcessedPcmRingBuffer(capacityFrames);
    ringBuffer.clear(startFrame);
    const iterator = this.iterateProcessedChunks({ ...options, chunkFrames, startFrame, workerSession });
    let queue = null;
    queue = new PcmPrebufferQueue(ringBuffer, iterator, chunkFrames, () => {
      this.activePcmQueues.delete(queue);
      if (this.activePcmQueue === queue) this.activePcmQueue = null;
      workerSession?.dispose();
    });
    this.activePcmQueue = queue;
    this.activePcmQueues.add(queue);
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
      // decodeAudioData receives a copy so the original compressed payload remains
      // intact; budget for both compressed copies and the decoded stereo PCM peak.
      const estimatedPeakBytes = compressed.byteLength * 2 + estimatedBytes;
      if (!Number.isFinite(estimatedPeakBytes) || estimatedPeakBytes > this.maxPcmBytes) {
        throw new Error("Compressed and decoded audio exceed the PCM memory budget before decoding");
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
      const actualPeakBytes = compressed.byteLength * 2 + pcmBytes;
      if (!Number.isFinite(actualPeakBytes) || actualPeakBytes > this.maxPcmBytes) {
        throw new Error("Compressed and decoded PCM exceed the available memory budget");
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

  ensurePcmOutputController() {
    if (!audioCtx) throw new Error("AudioContext is unavailable for PCM playback");
    const routeNode = audioCtx._musicPlayerPostDspInputNode;
    if (!routeNode || typeof routeNode.connect !== "function") {
      throw new Error("The post-DSP PCM graph input is unavailable");
    }
    if (this.pcmOutputController && this.pcmOutputContext === audioCtx &&
        this.pcmRouteNode === routeNode && this.pcmOutputController.state !== "disposed") {
      return this.pcmOutputController;
    }
    this.disposePcmOutputController();
    const router = new PcmOutputGraphRouter(
      audioCtx,
      routeNode,
      setGraphInputNode,
      clearGraphInputNode
    );
    const controller = new PcmPlaybackSessionController(audioCtx, router);
    this.pcmGraphRouter = router;
    this.pcmOutputController = controller;
    this.pcmOutputContext = audioCtx;
    this.pcmRouteNode = routeNode;
    return controller;
  }

  disposePcmOutputController() {
    this.pcmPlaybackGeneration++;
    if (this.pcmSettingsTimer !== null) clearTimeout(this.pcmSettingsTimer);
    this.pcmSettingsTimer = null;
    const controller = this.pcmOutputController;
    this.pcmOutputController = null;
    this.pcmGraphRouter = null;
    this.pcmOutputContext = null;
    this.pcmRouteNode = null;
    if (controller) {
      try { controller.dispose(); } catch (error) {
        console.warn("Music Player PCM output disposal failed:", error);
      }
    }
  }

  createPlaybackPcmQueue(startFrame) {
    const userPitch = Math.pow(2, Number(state.pitchSemitones || 0) / 12);
    const compensatedPitch = userPitch / Math.max(0.1, this.playbackRate);
    return this.createProcessedPcmQueue({
      concurrentSession: true,
      startFrame,
      chunkFrames: 8192,
      capacityFrames: 32768,
      eqGains: Array.isArray(state.eqState?.gains) ? state.eqState.gains.slice(0, 5) : [0, 0, 0, 0, 0],
      pitch: compensatedPitch
    });
  }

  createPcmSessionOptions(generation, sampleRate, startAtTime, startFrame = 0) {
    const options = {
      startFrame,
      sampleRate,
      playbackRate: this.playbackRate,
      blockFrames: 4096,
      startBufferFrames: 8192,
      lookAheadSeconds: 0.25,
      minimumLeadSeconds: 0.03,
      onEnded: frame => {
        if (generation !== this.pcmPlaybackGeneration) return;
        this.offset = frame / sampleRate;
        this.paused = true;
        this.playRequested = false;
        this.ended = true;
        this.startedAt = 0;
        this.stopTimeUpdates();
        this.dispatch("timeupdate");
        this.dispatch("ended");
      },
      onError: (error, frame) => {
        this.handlePcmPlaybackError(error, frame, generation);
      }
    };
    if (startAtTime !== undefined) options.startAtTime = startAtTime;
    return options;
  }

  handlePcmPlaybackError(error, frame, generation = this.pcmPlaybackGeneration) {
    if (generation !== this.pcmPlaybackGeneration) return;
    if (this.pcmSampleRate > 0 && Number.isFinite(Number(frame))) {
      this.offset = Math.max(0, Number(frame) / this.pcmSampleRate);
    } else {
      this.offset = this.currentTime;
    }
    this.paused = false;
    if (typeof switchBufferedPlaybackToMediaElement === "function") {
      Promise.resolve(switchBufferedPlaybackToMediaElement(error, true)).catch(fallbackError => {
        this.paused = true;
        this.stopTimeUpdates();
        console.warn("Music Player PCM playback fallback failed:", fallbackError);
      });
    } else {
      this.paused = true;
      this.stopTimeUpdates();
      this.dispatch("error");
    }
  }

  async startPcmSession(startFrame, startAtTime) {
    if (!this.buffer) throw new Error("PCM buffer is not ready");
    const controller = this.ensurePcmOutputController();
    const generation = ++this.pcmPlaybackGeneration;
    const requestId = this.playRequestId;
    const sampleRate = this.buffer.sampleRate;
    this.pcmSampleRate = sampleRate;
    const queue = await this.createPlaybackPcmQueue(startFrame);
    if (generation !== this.pcmPlaybackGeneration || requestId !== this.playRequestId ||
        !this.playRequested) {
      queue.cancel();
      return false;
    }
    const options = this.createPcmSessionOptions(generation, sampleRate, startAtTime, startFrame);
    const session = await controller.start(queue, options);
    if (!session || generation !== this.pcmPlaybackGeneration ||
        requestId !== this.playRequestId || !this.playRequested) {
      if (controller.activeSession === session) controller.stop();
      return false;
    }
    return session;
  }

  async updateProcessingSettings() {
    if (this.paused || !this.playRequested || !this.buffer) return false;
    if (typeof canUseBufferedPlayback === "function" && !canUseBufferedPlayback()) {
      throw new Error("Playback rate and pitch combination is outside the PCM path range");
    }
    const controller = this.ensurePcmOutputController();
    const generation = ++this.pcmPlaybackGeneration;
    const requestId = this.playRequestId;
    const sampleRate = this.buffer.sampleRate;
    this.pcmSampleRate = sampleRate;
    const options = this.createPcmSessionOptions(generation, sampleRate);

    const queueFactory = async boundary => {
      const queue = await this.createPlaybackPcmQueue(boundary.startFrame);
      if (generation !== this.pcmPlaybackGeneration || requestId !== this.playRequestId ||
          !this.playRequested) {
        queue.cancel();
      }
      return queue;
    };

    const result = await controller.handoff(queueFactory, options);
    if (!result || generation !== this.pcmPlaybackGeneration ||
        requestId !== this.playRequestId || !this.playRequested) return false;
    return result;
  }

  scheduleProcessingSettingsUpdate(delay = 120) {
    if (this.paused || !this.playRequested || !this.buffer) return false;
    if (this.pcmSettingsTimer !== null) clearTimeout(this.pcmSettingsTimer);
    this.pcmSettingsTimer = setTimeout(() => {
      this.pcmSettingsTimer = null;
      this.updateProcessingSettings().catch(error => {
        this.handlePcmPlaybackError(error, this.pcmOutputController?.currentFrame, this.pcmPlaybackGeneration);
      });
    }, Math.max(0, Number(delay) || 0));
    return true;
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
    const startFrame = Math.max(0, Math.min(this.buffer.length, Math.round(this.offset * this.buffer.sampleRate)));
    const session = await this.startPcmSession(startFrame);
    if (!session || requestId !== this.playRequestId || !this.playRequested) return;
    this.paused = false;
    this.ended = false;
    this.startedAt = 0;
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
    const wasPreparing = this.playRequested && !this.buffer;
    const wasPlaying = !this.paused;
    this.playRequestId++;
    this.playRequested = false;
    this.pcmPlaybackGeneration++;
    if (this.pcmSettingsTimer !== null) clearTimeout(this.pcmSettingsTimer);
    this.pcmSettingsTimer = null;
    if (this.pcmOutputController) {
      const frame = this.pcmOutputController.stop();
      if (this.pcmSampleRate > 0) this.offset = frame / this.pcmSampleRate;
    } else {
      this.offset = this.currentTime;
      this.cancelProcessedPcmQueue();
      this.stopSource();
    }
    if (this.paused) {
      if (wasPreparing) this.dispatch("canplay");
      return;
    }
    this.paused = true;
    this.startedAt = 0;
    this.stopTimeUpdates();
    if (wasPlaying) {
      this.dispatch("pause");
      this.dispatch("timeupdate");
    }
  }

  seek(value) {
    let next = Number(value);
    if (!Number.isFinite(next)) next = 0;
    const max = this.buffer?.duration || Number(state.currentSong?.duration) || 0;
    next = Math.max(0, max > 0 ? Math.min(max, next) : next);
    const wasPlaying = !this.paused;
    const requestId = this.playRequestId;
    this.pcmPlaybackGeneration++;
    this.dispatch("seeking");
    if (this.pcmOutputController) {
      const frame = this.pcmOutputController.stop();
      if (this.pcmSampleRate > 0 && wasPlaying) this.offset = frame / this.pcmSampleRate;
    } else {
      this.cancelProcessedPcmQueue();
      if (wasPlaying) this.stopSource();
    }
    this.offset = next;
    this.ended = false;
    if (wasPlaying && this.buffer) {
      const startFrame = Math.max(0, Math.min(this.buffer.length, Math.round(next * this.buffer.sampleRate)));
      return this.startPcmSession(startFrame).then(session => {
        if (!session || requestId !== this.playRequestId || !this.playRequested) return false;
        this.paused = false;
        this.startedAt = 0;
        this.startTimeUpdates();
        this.dispatch("seeked");
        this.dispatch("timeupdate");
        return true;
      }).catch(error => {
        this.handlePcmPlaybackError(error, this.pcmOutputController?.currentFrame, this.pcmPlaybackGeneration);
        return false;
      });
    } else {
      this.dispatch("seeked");
      this.dispatch("timeupdate");
      return Promise.resolve(true);
    }
  }

  setPlaybackRate(value) {
    let next = Number(value);
    if (!Number.isFinite(next)) next = 1;
    next = Math.max(0.1, Math.min(10, next));
    if (Math.abs(next - this.playbackRate) < 0.0001) return false;
    const position = this.currentTime;
    if (this.paused) this.cancelProcessedPcmQueue();
    this.playbackRate = next;
    this.offset = position;
    return true;
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
    this.offset = this.currentTime;
    this.disposePcmOutputController();
    this.disposeProcessorWorker();
    this.playRequestId++;
    this.playRequested = false;
    this.paused = true;
    this.stopSource();
    this.stopTimeUpdates();
    this.buffer = null;
    this.decodePromise = null;
    this._readyState = 0;
  }

  clear() {
    this.disposePcmOutputController();
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
    this.pcmSampleRate = 0;
  }
}

bufferedPlaybackEngine = new BufferedPlaybackEngine();
