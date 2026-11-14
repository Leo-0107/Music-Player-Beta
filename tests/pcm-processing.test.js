// Run with: node --test tests/pcm-processing.test.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const engineSource = fs.readFileSync(path.join(root, "js/10. buffered-playback-engine.js"), "utf8");
const workerSource = fs.readFileSync(path.join(root, "js/11. pcm-processing-worker.js"), "utf8");
const audioSource = fs.readFileSync(path.join(root, "js/2. audio.js"), "utf8");

function createWorkerScope(host) {
  const self = {
    onmessage: null,
    postMessage(data) {
      host.onmessage?.({ data });
    }
  };
  vm.runInNewContext(workerSource, { self });
  return self;
}

class MockWorker {
  constructor() {
    this.scope = createWorkerScope(this);
    this.terminated = false;
  }

  postMessage(data) {
    this.scope.onmessage({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

class WrongResponseWorker extends MockWorker {
  postMessage(data) {
    if (data.type === "process") {
      this.onmessage?.({ data: { type: "ready", id: data.id } });
      return;
    }
    super.postMessage(data);
  }
}

class DeferredProcessWorker extends MockWorker {
  constructor() {
    super();
    this.deferredResponses = [];
  }

  postMessage(data) {
    if (data.type !== "process") {
      super.postMessage(data);
      return;
    }
    const handler = this.onmessage;
    this.onmessage = event => this.deferredResponses.push({ handler, event });
    try {
      super.postMessage(data);
    } finally {
      this.onmessage = handler;
    }
  }

  flushNextResponse() {
    const pending = this.deferredResponses.shift();
    if (!pending) throw new Error("No deferred PCM worker response is available");
    pending.handler(pending.event);
  }
}

function createEngineClass(WorkerClass = MockWorker, overrides = {}) {
  const sandbox = {
    Worker: WorkerClass,
    URL,
    document: { baseURI: "https://music-player.invalid/" },
    navigator: { deviceMemory: 4 },
    state: { eqState: { gains: [0, 0, 0, 0, 0] }, pitchSemitones: 0, currentSong: null },
    audioCtx: { sampleRate: 48000 },
    setTimeout,
    clearTimeout,
    setGraphInputNode() {}
  };
  Object.assign(sandbox, overrides);
  vm.runInNewContext(engineSource + "\nthis.BufferedPlaybackEngine = BufferedPlaybackEngine;\n  this.PcmProcessingWorkerSession = PcmProcessingWorkerSession;\n  this.PcmGraphInputOwnership = PcmGraphInputOwnership;\n  this.ProcessedPcmRingBuffer = ProcessedPcmRingBuffer;\n  this.PcmPrebufferQueue = PcmPrebufferQueue;\n  this.PcmOutputScheduler = PcmOutputScheduler;\n  this.PcmOutputPumpLoop = PcmOutputPumpLoop;\n  this.PcmOutputGraphRouter = PcmOutputGraphRouter;\n  this.PcmPlaybackSessionController = PcmPlaybackSessionController;", sandbox);
  return { Engine: sandbox.BufferedPlaybackEngine, PcmProcessingWorkerSession: sandbox.PcmProcessingWorkerSession, GraphInputOwnership: sandbox.PcmGraphInputOwnership, RingBuffer: sandbox.ProcessedPcmRingBuffer, PcmPrebufferQueue: sandbox.PcmPrebufferQueue, PcmOutputScheduler: sandbox.PcmOutputScheduler, PcmOutputPumpLoop: sandbox.PcmOutputPumpLoop, PcmOutputGraphRouter: sandbox.PcmOutputGraphRouter, PcmPlaybackSessionController: sandbox.PcmPlaybackSessionController };
}

function makeMonoBuffer(sampleRate, durationSeconds = 2) {
  const length = sampleRate * durationSeconds;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = Math.sin(i * 0.01);
  return {
    sampleRate,
    length,
    duration: durationSeconds,
    numberOfChannels: 1,
    getChannelData: () => samples
  };
}



function createMockOutputContext() {
  const sources = [];
  const gains = [];
  const context = {
    currentTime: 10,
    createGain() {
      const events = [];
      const parameter = {
        value: 1,
        events,
        cancelScheduledValues(time) { events.push(["cancel", time]); },
        setValueAtTime(value, time) { this.value = value; events.push(["set", value, time]); },
        linearRampToValueAtTime(value, time) { this.value = value; events.push(["ramp", value, time]); }
      };
      const node = {
        gain: parameter,
        connect(target) { this.connectedTo = target; },
        disconnect() { this.disconnected = true; }
      };
      gains.push(node);
      return node;
    },
    createBuffer(channelCount, frameCount, sampleRate) {
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
      return {
        numberOfChannels: channelCount,
        length: frameCount,
        sampleRate,
        getChannelData(index) { return channels[index]; }
      };
    },
    createBufferSource() {
      const source = {
        playbackRate: {
          value: 1,
          setValueAtTime(value, time) { this.value = value; this.time = time; }
        },
        connect(node) { this.connectedNode = node; },
        disconnect() { this.disconnected = true; },
        start(time) { this.startAt = time; },
        stop() { this.stopped = true; this.onended?.(); },
        finish() { this.onended?.(); }
      };
      sources.push(source);
      return source;
    },
    sources,
    gains
  };
  return context;
}

test("concurrent PCM processing sessions keep independent Worker and DSP state", async () => {
  const { PcmProcessingWorkerSession } = createEngineClass(MockWorker);
  const first = new PcmProcessingWorkerSession();
  const second = new PcmProcessingWorkerSession();

  assert.notEqual(first.worker, second.worker);
  await Promise.all([
    first.initialize({ sampleRate: 48000, eqGains: [0, 0, 0, 0, 0], pitch: 1 }),
    second.initialize({ sampleRate: 48000, eqGains: [0, 0, 0, 0, 0], pitch: 1.5 })
  ]);

  const makeInput = sequence => ({
    sequence,
    left: Float32Array.from({ length: 4096 }, (_, index) => Math.sin((index + sequence) * 0.025)),
    right: Float32Array.from({ length: 4096 }, (_, index) => Math.cos((index + sequence) * 0.025))
  });
  const firstBlock = await first.send("process", makeInput(0));
  const secondBlock = await second.send("process", makeInput(0));
  assert.equal(firstBlock.type, "processed");
  assert.equal(secondBlock.type, "processed");
  assert.equal(firstBlock.sequence, 0);
  assert.equal(secondBlock.sequence, 0);

  // Advancing one worker's state must not advance the other worker's sequence or DSP state.
  const nextFirstBlock = await first.send("process", makeInput(1));
  assert.equal(nextFirstBlock.sequence, 1);
  const nextSecondBlock = await second.send("process", makeInput(1));
  assert.equal(nextSecondBlock.sequence, 1);

  first.dispose();
  second.dispose();
  assert.equal(first.active, false);
  assert.equal(second.active, false);
  assert.equal(first.worker, null);
  assert.equal(second.worker, null);
});

test("concurrent processed PCM queues use isolated Workers and cancel independently", async () => {
  const workers = [];
  class TrackingWorker extends MockWorker {
    constructor() {
      super();
      workers.push(this);
    }
  }

  const { Engine } = createEngineClass(TrackingWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(48000, 1);
  const options = {
    concurrentSession: true,
    chunkFrames: 1024,
    capacityFrames: 4096,
    eqGains: [0, 0, 0, 0, 0]
  };

  const firstQueue = await engine.createProcessedPcmQueue({ ...options, pitch: 1 });
  const secondQueue = await engine.createProcessedPcmQueue({ ...options, pitch: 1.5 });
  assert.equal(workers.length, 2);
  assert.notEqual(workers[0], workers[1]);
  assert.equal(engine.activePcmQueues.size, 2);

  const [firstChunk, secondChunk] = await Promise.all([
    firstQueue.readAsync(1024),
    secondQueue.readAsync(1024)
  ]);
  assert.equal(firstChunk.startFrame, 0);
  assert.equal(secondChunk.startFrame, 0);
  assert.equal(firstChunk.frameCount, 1024);
  assert.equal(secondChunk.frameCount, 1024);

  firstQueue.cancel();
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].terminated, false);
  assert.equal(engine.activePcmQueues.size, 1);

  const remainingChunk = await secondQueue.readAsync(1024);
  assert.ok(remainingChunk);
  assert.equal(secondQueue.cancelled, false);

  engine.cancelProcessedPcmQueue();
  assert.equal(engine.activePcmQueues.size, 0);
  assert.equal(workers.every(worker => worker.terminated), true);
});

test("completed PCM queue remains cancellable until its buffered tail is consumed", async () => {
  const workers = [];
  class TrackingWorker extends MockWorker {
    constructor() {
      super();
      workers.push(this);
    }
  }

  const { Engine } = createEngineClass(TrackingWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 0.125);
  const queue = await engine.createProcessedPcmQueue({
    concurrentSession: true,
    chunkFrames: 1024,
    capacityFrames: 2048,
    eqGains: [0, 0, 0, 0, 0],
    pitch: 1
  });

  await queue.pumpPromise;
  assert.equal(queue.done, true);
  assert.equal(queue.ringBuffer.availableFrames, 1000);
  assert.equal(engine.activePcmQueues.has(queue), true);
  assert.equal(workers[0].terminated, false);

  const tail = await queue.readAsync(1024);
  assert.equal(tail.frameCount, 1000);
  assert.equal(engine.activePcmQueues.has(queue), false);
  assert.equal(workers[0].terminated, true);
});

test("worker preserves the identity signal when EQ is flat and pitch is unchanged", () => {
  let response;
  const host = { onmessage: event => { response = event.data; } };
  const self = createWorkerScope(host);
  self.onmessage({ data: { type: "init", id: 1, sampleRate: 48000, eqGains: [0, 0, 0, 0, 0], pitch: 1 } });

  const input = Float32Array.from({ length: 2048 }, (_, i) => Math.sin(i * 0.03));
  self.onmessage({ data: { type: "process", id: 2, sequence: 0, left: input.slice(), right: input.slice() } });

  assert.equal(response.type, "processed");
  assert.deepEqual(Array.from(response.left), Array.from(input));
  assert.deepEqual(Array.from(response.right), Array.from(input));
});

test("worker rejects malformed sequence numbers and oversized chunks", () => {
  let response;
  const self = createWorkerScope({ onmessage: event => { response = event.data; } });
  self.onmessage({ data: { type: "init", id: 1, sampleRate: 48000, eqGains: [0, 0, 0, 0, 0], pitch: 1 } });

  self.onmessage({ data: { type: "process", id: 2, sequence: "0", left: new Float32Array(8), right: new Float32Array(8) } });
  assert.equal(response.type, "error");
  assert.match(response.message, /sequence/);

  self.onmessage({ data: { type: "process", id: 3, sequence: 0, left: new Float32Array(32769), right: new Float32Array(32769) } });
  assert.equal(response.type, "error");
  assert.match(response.message, /32768/);
});

test("processed chunks remain contiguous and cover the requested source range", async () => {
  const { Engine } = createEngineClass();
  const sampleRates = [8000, 44100, 96000, 192000];
  const chunkSizes = [1024, 4096, 8192, 32768];
  const pitches = [0.5, 0.99, 1.01, 2];

  for (const sampleRate of sampleRates) {
    for (const chunkFrames of chunkSizes) {
      for (const pitch of pitches) {
        const engine = new Engine();
        engine.buffer = makeMonoBuffer(sampleRate);
        engine.sourceUrl = "blob:pcm-test";
        const startFrame = Math.floor(engine.buffer.length * 0.37);
        let expectedStart = startFrame;
        let totalFrames = 0;

        for await (const chunk of engine.iterateProcessedChunks({ pitch, chunkFrames, startFrame })) {
          assert.equal(chunk.startFrame, expectedStart);
          assert.equal(chunk.frameCount, chunk.left.length);
          assert.equal(chunk.frameCount, chunk.right.length);
          expectedStart += chunk.frameCount;
          totalFrames += chunk.frameCount;
        }

        assert.equal(totalFrames, engine.buffer.length - startFrame);
      }
    }
  }
});

test("engine rejects a worker response with the wrong message type", async () => {
  const { Engine } = createEngineClass(WrongResponseWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 1);
  engine.sourceUrl = "blob:pcm-test";

  await assert.rejects(async () => {
    for await (const chunk of engine.iterateProcessedChunks({ pitch: 1 })) {
      void chunk;
    }
  }, /Unexpected PCM worker response/);
});

test("processed PCM ring buffer wraps without losing frame order", () => {
  const { RingBuffer } = createEngineClass();
  const ring = new RingBuffer(5);
  ring.clear(100);
  ring.write({ startFrame: 100, frameCount: 4, left: Float32Array.from([1, 2, 3, 4]), right: Float32Array.from([11, 12, 13, 14]) });

  const first = ring.read(3);
  assert.equal(first.startFrame, 100);
  assert.deepEqual(Array.from(first.left), [1, 2, 3]);
  assert.equal(ring.freeFrames, 4);

  ring.write({ startFrame: 104, frameCount: 4, left: Float32Array.from([5, 6, 7, 8]), right: Float32Array.from([15, 16, 17, 18]) });
  const second = ring.read(5);
  assert.equal(second.startFrame, 103);
  assert.deepEqual(Array.from(second.left), [4, 5, 6, 7, 8]);
  assert.deepEqual(Array.from(second.right), [14, 15, 16, 17, 18]);
  assert.equal(ring.availableFrames, 0);
  assert.equal(ring.read(1), null);
});

test("processed PCM ring buffer rejects gaps, overflow, and invalid discard ranges", () => {
  const { RingBuffer } = createEngineClass();
  const ring = new RingBuffer(3);
  ring.clear(20);
  const chunk = { startFrame: 20, frameCount: 2, left: Float32Array.from([1, 2]), right: Float32Array.from([1, 2]) };
  assert.throws(() => ring.write({ ...chunk, startFrame: 21 }), /not contiguous/);
  ring.write(chunk);
  assert.throws(() => ring.write({ ...chunk, startFrame: 22 }), /full/);
  assert.throws(() => ring.discardBefore(23), /outside the buffered range/);
  assert.equal(ring.discardBefore(21), 1);
  assert.equal(ring.readFrame, 21);
});


function makePcmChunk(startFrame, values) {
  const left = Float32Array.from(values);
  const right = Float32Array.from(values, value => value + 100);
  return { startFrame, frameCount: left.length, left, right };
}

test("PCM prebuffer queue applies bounded backpressure and resumes after reads", async () => {
  const { RingBuffer, PcmPrebufferQueue } = createEngineClass();
  const ring = new RingBuffer(8);
  assert.throws(
    () => new PcmPrebufferQueue(new RingBuffer(4), { next: async () => ({ done: true }) }, 4),
    /two maximum-sized chunks/
  );
  let produced = 0;
  async function* source() {
    for (let index = 0; index < 3; index++) {
      produced++;
      yield makePcmChunk(index * 4, [index * 4 + 1, index * 4 + 2, index * 4 + 3, index * 4 + 4]);
    }
  }

  const queue = new PcmPrebufferQueue(ring, source(), 4).start();
  await assert.rejects(() => queue.readAsync(5), /maximum chunk size/);
  const first = await queue.readAsync(3);
  assert.equal(first.startFrame, 0);
  assert.deepEqual(Array.from(first.left), [1, 2, 3]);

  const second = await queue.readAsync(4);
  assert.equal(second.startFrame, 3);
  assert.deepEqual(Array.from(second.left), [4, 5, 6, 7]);
  const third = await queue.readAsync(4);
  assert.equal(third.startFrame, 7);
  assert.deepEqual(Array.from(third.left), [8, 9, 10, 11]);
  const fourth = await queue.readAsync(4);
  assert.equal(fourth.startFrame, 11);
  assert.deepEqual(Array.from(fourth.left), [12]);
  assert.equal(await queue.readAsync(1), null);
  assert.equal(produced, 3);
  assert.equal(ring.availableFrames, 0);
});

test("PCM prebuffer queue propagates producer errors and rejects invalid chunks", async () => {
  const { RingBuffer, PcmPrebufferQueue } = createEngineClass();
  async function* brokenSource() {
    yield { startFrame: 0, frameCount: 5, left: new Float32Array(5), right: new Float32Array(5) };
  }
  const queue = new PcmPrebufferQueue(new RingBuffer(8), brokenSource(), 4).start();
  await assert.rejects(() => queue.readAsync(1), /invalid or oversized chunk/);
});

test("PCM prebuffer queue discards a chunk returned after cancellation", async () => {
  const { RingBuffer, PcmPrebufferQueue } = createEngineClass();
  let release;
  const iterator = {
    next: () => new Promise(resolve => { release = resolve; }),
    return: async () => ({ done: true })
  };
  const ring = new RingBuffer(8);
  ring.write(makePcmChunk(0, [1, 2, 3, 4]));
  const queue = new PcmPrebufferQueue(ring, iterator, 4).start();
  await Promise.resolve();
  queue.cancel();
  release({ done: false, value: makePcmChunk(4, [5, 6, 7, 8]) });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ring.availableFrames, 0);
  assert.equal(ring.readFrame, 0);
  assert.equal(await queue.readAsync(1), null);
});


test("PCM worker iterator streams through the bounded prebuffer queue without gaps", async () => {
  const { Engine, RingBuffer, PcmPrebufferQueue } = createEngineClass();
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 1);
  engine.sourceUrl = "blob:pcm-test";

  const ring = new RingBuffer(4096);
  const queue = new PcmPrebufferQueue(
    ring,
    engine.iterateProcessedChunks({ pitch: 1, chunkFrames: 1024, startFrame: 0 }),
    1024
  ).start();

  let expectedFrame = 0;
  let totalFrames = 0;
  for (;;) {
    const chunk = await queue.readAsync(1024);
    if (!chunk) break;
    assert.equal(chunk.startFrame, expectedFrame);
    assert.equal(chunk.frameCount, chunk.left.length);
    assert.equal(chunk.frameCount, chunk.right.length);
    expectedFrame += chunk.frameCount;
    totalFrames += chunk.frameCount;
  }

  assert.equal(totalFrames, engine.buffer.length);
  assert.equal(expectedFrame, engine.buffer.length);
  assert.equal(ring.availableFrames, 0);
  engine.disposeProcessorWorker();
});


test("BufferedPlaybackEngine routes play, pause, resume, seek, and rate handoff through post-DSP PCM output", async () => {
  const workers = [];
  class TrackingWorker extends MockWorker {
    constructor() {
      super();
      this.messages = [];
      workers.push(this);
    }

    postMessage(data, transfer) {
      this.messages.push(data);
      super.postMessage(data, transfer);
    }
  }

  const appState = {
    eqState: { gains: [0, 0, 0, 0, 0] },
    pitchSemitones: 0,
    currentSong: { duration: 1 }
  };
  const context = createMockOutputContext();
  const routeNode = { connect() {}, disconnect() {} };
  context._musicPlayerPostDspInputNode = routeNode;
  let ownership;
  const events = [];
  let timerId = 0;
  const { Engine, GraphInputOwnership } = createEngineClass(TrackingWorker, {
    audioCtx: context,
    state: appState,
    setGraphInputNode(node, target) { return ownership.set(node, target); },
    clearGraphInputNode(node, target) { return ownership.clear(node, target); },
    ensureGraph() {},
    async resumeAudioCtx() {},
    canUseBufferedPlayback() { return true; },
    mediaElement: { dispatchEvent(event) { events.push(event.type); return true; } },
    Event: class MockEvent { constructor(type) { this.type = type; } },
    setInterval() { return ++timerId; },
    clearInterval() {},
    setTimeout() { return ++timerId; },
    clearTimeout() {}
  });
  ownership = new GraphInputOwnership();
  const engine = new Engine();
  engine.sourceUrl = "blob:pcm-integration";
  engine.buffer = makeMonoBuffer(48000, 1);
  engine._readyState = 4;

  await engine.play();
  assert.equal(engine.paused, false);
  assert.equal(engine.pcmOutputController.state, "running");
  assert.ok(engine.pcmOutputController.activeSession);
  assert.equal(ownership.activeTarget, routeNode);
  assert.equal(ownership.activeNode, engine.pcmGraphRouter.bus);
  assert.ok(context.sources.length >= 2);
  assert.ok(context.sources.every(source => source.connectedNode));

  context.currentTime = 10.1001;
  assert.ok(Math.abs(engine.currentTime - 0.0701) < 0.0001);
  engine.pause();
  assert.equal(engine.paused, true);
  assert.equal(engine.offset, engine.pcmOutputController.lastFrame / 48000);
  assert.equal(engine.pcmOutputController.activeSession, null);

  await engine.play();
  assert.equal(engine.paused, false);
  assert.equal(engine.pcmOutputController.activeSession.scheduler.initialFrame, Math.round(engine.offset * 48000));

  await engine.seek(0.5);
  assert.equal(engine.pcmOutputController.activeSession.scheduler.initialFrame, 24000);
  assert.equal(engine.paused, false);

  appState.eqState.gains = [2, -1, 0, 0, 0];
  appState.pitchSemitones = 12;
  engine.setPlaybackRate(1.25);
  const handoff = await engine.updateProcessingSettings();
  assert.equal(handoff.session.scheduler.playbackRate, 1.25);
  const latestWorkerInit = workers[workers.length - 1].messages.find(message => message.type === "init");
  assert.deepEqual(latestWorkerInit.eqGains, [2, -1, 0, 0, 0]);
  assert.equal(latestWorkerInit.pitch, 1.6);
  assert.equal(handoff.session.scheduler.initialFrame, handoff.handoff.startFrame);
  assert.ok(engine.currentTime < handoff.handoff.startFrame / 48000);
  assert.ok(Math.abs(engine.currentTime - 0.5) < 0.0001);
  assert.ok(workers.length >= 4);
  assert.ok(engine.pcmOutputController.drainingSessions.size >= 1);

  // Pausing before the replacement's scheduled start must retain the old
  // audible frame, not jump forward to the replacement handoff boundary.
  engine.pause();
  assert.equal(engine.paused, true);
  assert.ok(Math.abs(engine.offset - 0.5) < 0.0001);
  assert.equal(engine.pcmOutputController.activeSession, null);
  assert.equal(engine.pcmOutputController.drainingSessions.size, 0);

  engine.releaseForFallback();
  assert.equal(engine.pcmOutputController, null);
  assert.equal(ownership.activeNode, null);
  assert.equal(engine.paused, true);
  assert.equal(workers.every(worker => worker.terminated), true);
  assert.ok(events.includes("play"), `Missing play event: ${events.join(",")}`);
  assert.ok(events.includes("pause"), `Missing pause event: ${events.join(",")}`);
  assert.ok(events.includes("seeked"), `Missing seeked event: ${events.join(",")}`);
});

test("engine invalidates active PCM queues on pause, seek, rate change, and source replacement", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 1);
  engine.sourceUrl = "blob:pcm-test";

  const first = await engine.createProcessedPcmQueue({ pitch: 1, chunkFrames: 1024, capacityFrames: 2048 });
  await assert.rejects(
    () => engine.createProcessedPcmQueue({ pitch: 1, chunkFrames: 1024, capacityFrames: 512 }),
    /queue capacity/
  );
  assert.equal(first.cancelled, false);
  const firstBlock = await first.readAsync(1024);
  assert.equal(firstBlock.startFrame, 0);
  engine.seek(0.5);
  assert.equal(first.ringBuffer.availableFrames, 0);
  assert.equal(await first.readAsync(1), null);

  const second = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 4000
  });
  assert.equal(second.ringBuffer.readFrame, 4000);
  const secondBlock = await second.readAsync(1024);
  assert.equal(secondBlock.startFrame, 4000);
  engine.setPlaybackRate(1.25);
  assert.equal(second.ringBuffer.availableFrames, 0);
  assert.equal(await second.readAsync(1), null);

  const third = await engine.createProcessedPcmQueue({ pitch: 1, chunkFrames: 1024, capacityFrames: 2048 });
  await third.readAsync(1024);
  engine.pause();
  assert.equal(third.ringBuffer.availableFrames, 0);
  assert.equal(await third.readAsync(1), null);

  const fourth = await engine.createProcessedPcmQueue({ pitch: 1, chunkFrames: 1024, capacityFrames: 2048 });
  await fourth.readAsync(1024);
  engine.setSource("blob:replacement");
  assert.equal(fourth.ringBuffer.availableFrames, 0);
  assert.equal(await fourth.readAsync(1), null);
  engine.disposeProcessorWorker();
});

test("PCM queue creation is rejected if pause invalidates source preparation", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  let finishPreparation;
  engine.prepare = () => new Promise(resolve => { finishPreparation = resolve; });
  const pending = engine.createProcessedPcmQueue({ pitch: 1, chunkFrames: 1024, capacityFrames: 2048 });
  await Promise.resolve();
  engine.pause();
  engine.buffer = makeMonoBuffer(8000, 1);
  finishPreparation(engine.buffer);
  await assert.rejects(() => pending, /queue creation was cancelled/);
  assert.equal(engine.activePcmQueue, null);
  engine.disposeProcessorWorker();
});


test("direct PCM iterator is invalidated when cancelled during preparation", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  let finishPreparation;
  engine.prepare = () => new Promise(resolve => { finishPreparation = resolve; });
  const iterator = engine.iterateProcessedChunks({ pitch: 1, chunkFrames: 1024 });
  const pending = iterator.next();
  await Promise.resolve();
  engine.cancelProcessedPcmQueue();
  engine.buffer = makeMonoBuffer(8000, 1);
  finishPreparation(engine.buffer);
  await assert.rejects(() => pending, /PCM processing was cancelled/);
  engine.disposeProcessorWorker();
});


test("cancelled PCM worker responses cannot enter a newer seek session", async () => {
  const { Engine } = createEngineClass(DeferredProcessWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 2);
  engine.sourceUrl = "blob:pcm-test";

  const oldQueue = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 0
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const worker = engine.processorWorker;
  assert.equal(worker.deferredResponses.length, 1);

  engine.seek(0.5);
  const newQueue = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 1000
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(worker.deferredResponses.length, 2);

  worker.flushNextResponse();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(oldQueue.ringBuffer.availableFrames, 0);
  assert.equal(newQueue.ringBuffer.availableFrames, 0);
  assert.equal(await oldQueue.readAsync(1), null);

  worker.flushNextResponse();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.ok(newQueue.ringBuffer.availableFrames > 0);
  assert.equal((await newQueue.readAsync(1)).startFrame, 1000);
  engine.disposeProcessorWorker();
});

test("cancelled producer errors do not turn a cancelled queue into a failed read", async () => {
  const { RingBuffer, PcmPrebufferQueue } = createEngineClass();
  let rejectNext;
  const iterator = {
    next: () => new Promise((resolve, reject) => { rejectNext = reject; }),
    return: async () => ({ done: true })
  };
  const queue = new PcmPrebufferQueue(new RingBuffer(8), iterator, 4).start();
  await Promise.resolve();
  queue.cancel();
  rejectNext(new Error("iterator closed"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await queue.readAsync(1), null);
});


test("a newer PCM queue request supersedes an older request waiting for preparation", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  let finishPreparation;
  const preparation = new Promise(resolve => { finishPreparation = resolve; });
  engine.prepare = () => preparation;

  const oldRequest = engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 0
  });
  await Promise.resolve();
  const newRequest = engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 1000
  });
  await Promise.resolve();

  engine.buffer = makeMonoBuffer(8000, 1);
  finishPreparation(engine.buffer);
  await assert.rejects(() => oldRequest, /queue creation was cancelled/);
  const queue = await newRequest;
  assert.equal(queue.ringBuffer.readFrame, 1000);
  assert.equal(engine.activePcmQueue, queue);
  engine.disposeProcessorWorker();
});

test("source replacement invalidates a PCM queue request still waiting for preparation", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  let finishPreparation;
  engine.prepare = () => new Promise(resolve => { finishPreparation = resolve; });

  const pending = engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048
  });
  await Promise.resolve();
  engine.setSource("blob:new-source");
  finishPreparation(makeMonoBuffer(8000, 1));
  await assert.rejects(() => pending, /queue creation was cancelled/);
  assert.equal(engine.sourceUrl, "blob:new-source");
  assert.equal(engine.activePcmQueue, null);
  engine.disposeProcessorWorker();
});


test("repeated pause and resume recreates queues at the exact next source frame", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 3);
  engine.sourceUrl = "blob:pcm-test";

  let nextFrame = 0;
  for (let cycle = 0; cycle < 6; cycle++) {
    const queue = await engine.createProcessedPcmQueue({
      pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: nextFrame
    });
    const block = await queue.readAsync(512);
    assert.equal(block.startFrame, nextFrame);
    assert.equal(block.frameCount, 512);
    nextFrame += block.frameCount;

    engine.pause();
    assert.equal(queue.cancelled, true);
    assert.equal(queue.ringBuffer.availableFrames, 0);
    assert.equal(await queue.readAsync(1), null);
    assert.equal(engine.activePcmQueue, null);
  }

  const resumed = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: nextFrame
  });
  const finalBlock = await resumed.readAsync(512);
  assert.equal(finalBlock.startFrame, nextFrame);
  assert.equal(finalBlock.frameCount, 512);
  engine.disposeProcessorWorker();
});

test("pause during an in-flight PCM block cannot contaminate the resumed queue", async () => {
  const { Engine } = createEngineClass(DeferredProcessWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 2);
  engine.sourceUrl = "blob:pcm-test";

  const pausedQueue = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 0
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  const worker = engine.processorWorker;
  assert.equal(worker.deferredResponses.length, 1);

  engine.pause();
  assert.equal(pausedQueue.cancelled, true);

  const resumedQueue = await engine.createProcessedPcmQueue({
    pitch: 1, chunkFrames: 1024, capacityFrames: 2048, startFrame: 2048
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(worker.deferredResponses.length, 2);

  worker.flushNextResponse();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(pausedQueue.ringBuffer.availableFrames, 0);
  assert.equal(resumedQueue.ringBuffer.availableFrames, 0);
  assert.equal(await pausedQueue.readAsync(1), null);

  for (let i = 0; i < 8 && resumedQueue.ringBuffer.availableFrames === 0; i++) {
    if (worker.deferredResponses.length) worker.flushNextResponse();
    for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  }
  assert.equal(pausedQueue.ringBuffer.availableFrames, 0);
  assert.ok(resumedQueue.ringBuffer.availableFrames > 0);
  assert.equal((await resumedQueue.readAsync(512)).startFrame, 2048);
  engine.disposeProcessorWorker();
});


test("PCM output scheduler schedules contiguous chunks at playback-rate-adjusted times", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  const inputNode = { connect() {} };
  const chunks = [
    makePcmChunk(100, [1, 2, 3, 4]),
    makePcmChunk(104, [5, 6, 7, 8])
  ];
  const queue = {
    maxChunkFrames: 4,
    async readAsync() { return chunks.length ? chunks.shift() : null; },
    cancel() { this.cancelled = true; }
  };
  const ended = [];
  const scheduler = new PcmOutputScheduler(context, inputNode, {
    lookAheadSeconds: 1,
    minimumLeadSeconds: 0.05,
    onEnded: frame => ended.push(frame)
  });

  await scheduler.start(queue, {
    startFrame: 100, sampleRate: 8000, playbackRate: 2,
    blockFrames: 4, lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });

  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[0].startAt, 10.05);
  assert.equal(context.sources[1].startAt, 10.05025);
  assert.equal(context.sources[0].playbackRate.value, 2);
  assert.equal(context.sources[0].buffer.getChannelData(0)[0], 1);
  assert.equal(context.sources[1].buffer.getChannelData(1)[3], 108);
  assert.equal(scheduler.eof, true);
  assert.equal(scheduler.active, true);

  context.currentTime = 10.050126;
  assert.equal(scheduler.currentFrame, 102);
  context.currentTime = 10.050501;
  assert.equal(scheduler.currentFrame, 108);

  context.sources[0].finish();
  assert.equal(scheduler.active, true);
  context.sources[1].finish();
  assert.equal(scheduler.active, false);
  assert.deepEqual(ended, [108]);
});

test("PCM scheduler freezes the frame clock across underrun and resumes without skipping frames", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  let reads = 0;
  let releaseSecond;
  const largeChunk = Array.from({ length: 1024 }, (_, index) => index);
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() {
      reads++;
      if (reads === 1) return makePcmChunk(0, largeChunk);
      if (reads === 2) return new Promise(resolve => { releaseSecond = resolve; });
      return null;
    },
    cancel() {}
  };
  const underruns = [];
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1,
    minimumLeadSeconds: 0.05,
    onUnderrun: detail => underruns.push(detail)
  });

  await scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  context.currentTime = 10.2;
  const pendingPump = scheduler.pump();
  await Promise.resolve();
  assert.equal(typeof releaseSecond, "function");
  releaseSecond(makePcmChunk(1024, largeChunk));
  await pendingPump;

  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[1].startAt, 10.25);
  assert.equal(underruns.length, 1);
  assert.equal(underruns[0].frame, 1024);
  assert.equal(scheduler.currentFrame, 1024);

  context.currentTime = 10.250125;
  assert.equal(scheduler.currentFrame, 1025);
  assert.equal(scheduler.underrunCount, 1);
  scheduler.stop();
});

test("stopping PCM scheduling while a queue read is pending rejects late source scheduling", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  let releaseSecond;
  const largeChunk = Array.from({ length: 1024 }, (_, index) => index);
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() {
      if (!this.sentFirst) {
        this.sentFirst = true;
        return makePcmChunk(0, largeChunk);
      }
      return new Promise(resolve => { releaseSecond = resolve; });
    },
    cancel() { this.cancelled = true; }
  };
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  await scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  context.currentTime = 10.2;
  const pendingPump = scheduler.pump();
  await Promise.resolve();
  const frozenFrame = scheduler.stop();
  assert.equal(frozenFrame, 1024);
  assert.equal(queue.cancelled, true);
  releaseSecond(makePcmChunk(4, [5, 6, 7, 8]));
  await pendingPump;
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].stopped, true);
  assert.equal(scheduler.currentFrame, 1024);
});

test("PCM output scheduler rejects discontinuous or invalid chunk ranges", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  const queue = {
    maxChunkFrames: 4,
    async readAsync() { return makePcmChunk(10, [1, 2, 3, 4]); },
    cancel() { this.cancelled = true; }
  };
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });
  await assert.rejects(() => scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 4, lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  }), /invalid, discontinuous/);
  assert.equal(scheduler.active, false);
  assert.equal(queue.cancelled, true);
  assert.equal(context.sources.length, 0);
});


test("PCM scheduler preserves timing across sample-rate, block-size, and playback-rate matrix", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const sampleRates = [8000, 44100, 96000, 192000];
  const blockSizes = [1024, 8192, 32768];
  const playbackRates = [0.5, 1, 2];

  for (const sampleRate of sampleRates) {
    for (const blockFrames of blockSizes) {
      for (const playbackRate of playbackRates) {
        const context = createMockOutputContext();
        const makeChunk = startFrame => ({
          startFrame,
          sampleRate,
          frameCount: blockFrames,
          left: new Float32Array(blockFrames),
          right: new Float32Array(blockFrames)
        });
        const chunks = [makeChunk(0), makeChunk(blockFrames)];
        const queue = {
          maxChunkFrames: blockFrames,
          async readAsync() { return chunks.length ? chunks.shift() : null; },
          cancel() {}
        };
        const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
          lookAheadSeconds: 20, minimumLeadSeconds: 0.05
        });
        await scheduler.start(queue, {
          startFrame: 0, sampleRate, playbackRate, blockFrames,
          lookAheadSeconds: 20, minimumLeadSeconds: 0.05
        });
        assert.equal(context.sources.length, 2);
        const expectedDuration = blockFrames / sampleRate / playbackRate;
        const actualDuration = context.sources[1].startAt - context.sources[0].startAt;
        assert.ok(Math.abs(actualDuration - expectedDuration) < 0.0000001);
        assert.equal(scheduler.nextFrame, blockFrames * 2);
        scheduler.stop();
      }
    }
  }
});

test("PCM scheduler detects sub-millisecond underruns and freezes its clock", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  const chunks = [
    makePcmChunk(0, [1, 2, 3, 4]),
    makePcmChunk(4, [5, 6, 7, 8])
  ];
  const queue = {
    maxChunkFrames: 4,
    async readAsync() { return chunks.length ? chunks.shift() : null; },
    cancel() {}
  };
  const underruns = [];
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.0001,
    minimumLeadSeconds: 0.00005,
    onUnderrun: detail => underruns.push(detail)
  });
  await scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 4, startBufferFrames: 4,
    lookAheadSeconds: 0.0001, minimumLeadSeconds: 0.00005
  });

  context.currentTime = 10.00105;
  await scheduler.pump();
  assert.equal(underruns.length, 1);
  assert.ok(underruns[0].gapSeconds > 0.0005);
  assert.equal(scheduler.currentFrame, 4);
  context.currentTime = 10.001225;
  assert.equal(scheduler.currentFrame, 5);
  scheduler.stop();
});


test("PCM scheduler waits for its startup reserve but permits short tracks to reach EOF", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  let releaseSecond;
  let reads = 0;
  const queue = {
    maxChunkFrames: 4,
    async readAsync() {
      reads++;
      if (reads === 1) return makePcmChunk(0, [1, 2, 3, 4]);
      if (reads === 2) return new Promise(resolve => { releaseSecond = resolve; });
      return null;
    },
    cancel() {}
  };
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });
  const starting = scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 4, startBufferFrames: 8,
    lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof releaseSecond, "function");
  assert.equal(context.sources.length, 0);
  releaseSecond(makePcmChunk(4, [5, 6, 7, 8]));
  await starting;
  assert.equal(context.sources.length, 2);
  scheduler.stop();

  const shortContext = createMockOutputContext();
  const shortChunks = [makePcmChunk(20, [1, 2, 3, 4])];
  const shortQueue = {
    maxChunkFrames: 4,
    async readAsync() { return shortChunks.length ? shortChunks.shift() : null; },
    cancel() {}
  };
  const shortScheduler = new PcmOutputScheduler(shortContext, { connect() {} }, {
    lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });
  await shortScheduler.start(shortQueue, {
    startFrame: 20, sampleRate: 8000, playbackRate: 1,
    blockFrames: 4, startBufferFrames: 8,
    lookAheadSeconds: 1, minimumLeadSeconds: 0.05
  });
  assert.equal(shortContext.sources.length, 1);
  assert.equal(shortScheduler.eof, true);
  shortContext.sources[0].finish();
  assert.equal(shortScheduler.active, false);
});


test("PCM scheduler can drain old scheduled audio into a new settings queue without a frame gap", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  const oldQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 0, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  };
  const drained = [];
  const ended = [];
  const oldScheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05,
    onDrained: frame => drained.push(frame),
    onEnded: frame => ended.push(frame)
  });
  await oldScheduler.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  const handoff = oldScheduler.drainForHandoff();
  assert.equal(handoff.startFrame, 1024);
  assert.equal(handoff.startAtTime, 10.178);
  assert.equal(oldQueue.cancelled, true);
  assert.equal(oldScheduler.active, true);

  const newQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 1024, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() {}
  };
  const newScheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  await newScheduler.start(newQueue, {
    startFrame: handoff.startFrame, startAtTime: handoff.startAtTime,
    sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[1].startAt, context.sources[0].startAt + 1024 / 8000);
  assert.equal(newScheduler.underrunCount, 0);
  context.sources[0].finish();
  assert.deepEqual(drained, [1024]);
  assert.deepEqual(ended, []);
  newScheduler.stop();
});

test("late PCM settings handoff freezes the frame clock instead of skipping frames", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  const oldQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 0, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() {}
  };
  const oldScheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  await oldScheduler.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const handoff = oldScheduler.drainForHandoff();
  context.currentTime = 10.2;
  context.sources[0].finish();

  const chunks = [{
    startFrame: handoff.startFrame, sampleRate: 8000, frameCount: 1024,
    left: new Float32Array(1024), right: new Float32Array(1024)
  }];
  const newQueue = {
    maxChunkFrames: 1024,
    async readAsync() { return chunks.length ? chunks.shift() : null; },
    cancel() {}
  };
  const underruns = [];
  const newScheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05,
    onUnderrun: detail => underruns.push(detail)
  });
  await newScheduler.start(newQueue, {
    startFrame: handoff.startFrame, startAtTime: handoff.startAtTime,
    sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  assert.equal(context.sources[1].startAt, 10.25);
  assert.equal(underruns.length, 1);
  assert.equal(underruns[0].frame, 1024);
  assert.equal(newScheduler.currentFrame, 1024);
  context.currentTime = 10.250125;
  assert.equal(newScheduler.currentFrame, 1025);
  newScheduler.stop();
});


test("PCM scheduler handoff invalidates an in-flight producer read without scheduling stale frames", async () => {
  const { PcmOutputScheduler } = createEngineClass();
  const context = createMockOutputContext();
  let releaseSecond;
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() {
      if (!this.sentFirst) {
        this.sentFirst = true;
        return {
          startFrame: 0, sampleRate: 8000, frameCount: 1024,
          left: new Float32Array(1024), right: new Float32Array(1024)
        };
      }
      return new Promise(resolve => { releaseSecond = resolve; });
    },
    cancel() { this.cancelled = true; }
  };
  const drained = [];
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05,
    onDrained: frame => drained.push(frame)
  });
  await scheduler.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  context.currentTime = 10.2;
  const pendingPump = scheduler.pump();
  await Promise.resolve();
  assert.equal(typeof releaseSecond, "function");
  const handoff = scheduler.drainForHandoff();
  assert.equal(handoff.startFrame, 1024);
  assert.equal(queue.cancelled, true);
  releaseSecond({
    startFrame: 1024, sampleRate: 8000, frameCount: 1024,
    left: new Float32Array(1024), right: new Float32Array(1024)
  });
  await pendingPump;

  assert.equal(context.sources.length, 1);
  assert.equal(scheduler.active, true);
  context.sources[0].finish();
  assert.deepEqual(drained, [1024]);
});


test("PCM graph router keeps one graph input and crossfades session gains safely", () => {
  const { PcmOutputGraphRouter } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  const graphCalls = [];
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    graphCalls.push({ node, target });
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (expectedNode, expectedTarget) => {
    if (activeInput?.node !== expectedNode || activeInput.target !== expectedTarget) return false;
    try { expectedNode.disconnect(expectedTarget); } catch (error) {}
    activeInput = null;
    graphCalls.push({ node: null, target: expectedTarget });
    return true;
  };
  assert.throws(
    () => new PcmOutputGraphRouter(context, routeNode, setGraphInput),
    /AudioContext, route node, and graph input setter/
  );
  assert.throws(
    () => new PcmOutputGraphRouter(context, routeNode, () => false, clearGraphInput),
    /could not be connected/
  );
  const failedBus = context.gains[context.gains.length - 1];
  assert.equal(failedBus.disconnected, true);

  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  assert.equal(activeInput.node, router.bus);
  assert.equal(activeInput.target, routeNode);

  const oldGain = router.createSessionGain(1);
  const newGain = router.createSessionGain(0);
  assert.equal(oldGain.connectedTo, router.bus);
  assert.equal(newGain.connectedTo, router.bus);
  assert.equal(router.crossfade(oldGain, newGain, 12, 0.01), 12.01);
  assert.deepEqual(oldGain.gain.events, [
    ["cancel", 12], ["set", 1, 12], ["ramp", 0, 12.01]
  ]);
  assert.deepEqual(newGain.gain.events, [
    ["cancel", 12], ["set", 0, 12], ["ramp", 1, 12.01]
  ]);
  assert.equal(router.crossfade(newGain, oldGain, 13, 0.02), 13.02);
  assert.deepEqual(oldGain.gain.events.slice(-3), [
    ["cancel", 13], ["set", 0, 13], ["ramp", 1, 13.02]
  ]);
  assert.deepEqual(newGain.gain.events.slice(-3), [
    ["cancel", 13], ["set", 1, 13], ["ramp", 0, 13.02]
  ]);
  assert.throws(() => router.crossfade(oldGain, oldGain, 12, 0.01), /unknown session gain/);
  assert.throws(() => router.createSessionGain(1.5), /between 0 and 1/);

  assert.equal(router.retireSessionGain(oldGain), true);
  assert.equal(oldGain.disconnected, true);
  assert.equal(router.attach(), true);
  assert.equal(activeInput.node, router.bus);
  assert.equal(router.detach(), true);
  assert.equal(activeInput, null);
  assert.equal(router.attach(), true);
  assert.equal(activeInput.node, router.bus);

  const fallbackNode = { connect() {} };
  const fallbackTarget = { connect() {} };
  setGraphInput(fallbackNode, fallbackTarget);
  assert.equal(activeInput.node, fallbackNode);
  assert.equal(router.detach(), false);
  router.dispose();
  assert.equal(activeInput.node, fallbackNode);
  assert.equal(newGain.disconnected, true);
  assert.equal(router.bus.disconnected, true);
  assert.equal(graphCalls.length, 5);
  assert.throws(() => router.attach(), /disposed/);
  router.dispose();

  const ownedRouter = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const ownedBus = ownedRouter.bus;
  ownedRouter.dispose();
  assert.equal(activeInput, null);
  assert.equal(ownedBus.disconnected, true);
  assert.equal(graphCalls[graphCalls.length - 1].node, null);
});


test("audio graph input functions use transactional ownership and preserve fallback", () => {
  const ownerStart = engineSource.indexOf("class PcmGraphInputOwnership {");
  const ownerEnd = engineSource.indexOf("class PcmOutputGraphRouter {", ownerStart);
  assert.ok(ownerStart >= 0 && ownerEnd > ownerStart, "PCM graph ownership class must exist");
  const ownerSource = engineSource.slice(ownerStart, ownerEnd);
  const ownerDecl = "let graphInputOwnership = null;";
  const getStart = audioSource.indexOf("function getGraphInputOwnership()");
  const clearEnd = audioSource.indexOf("\n  }", audioSource.indexOf("function clearGraphInputNode(", getStart)) + 4;
  assert.ok(getStart >= 0 && clearEnd > getStart, "audio graph ownership functions must exist");
  const audioOwnershipSource = audioSource.slice(getStart, clearEnd);
  const events = [];
  const targetA = {};
  const targetB = {};
  const makeNode = name => ({
    connect(target) { events.push([name, "connect", target]); },
    disconnect(target) { events.push([name, "disconnect", target]); }
  });
  const mediaNode = makeNode("media");
  const pcmBus = makeNode("pcm");
  const fallbackNode = makeNode("fallback");
  const sandbox = { filters: [targetA] };
  vm.runInNewContext(`
    ${ownerSource}
    ${ownerDecl}
    ${audioOwnershipSource}
    this.setGraphInputNode = setGraphInputNode;
    this.clearGraphInputNode = clearGraphInputNode;
    this.getOwner = () => graphInputOwnership;
  `, sandbox);
  assert.equal(sandbox.setGraphInputNode(mediaNode, targetA), true);
  assert.equal(sandbox.setGraphInputNode(pcmBus, targetB), true);
  assert.equal(sandbox.getOwner().activeNode, pcmBus);
  assert.equal(sandbox.getOwner().activeTarget, targetB);
  assert.equal(events.some(event => event[0] === "media" && event[1] === "disconnect" && event[2] === targetA), true);
  assert.equal(sandbox.setGraphInputNode(fallbackNode, targetA), true);
  assert.equal(sandbox.getOwner().activeNode, fallbackNode);
  assert.equal(sandbox.clearGraphInputNode(pcmBus, targetB), false);
  assert.equal(sandbox.getOwner().activeNode, fallbackNode);
  assert.equal(sandbox.clearGraphInputNode(fallbackNode, targetA), true);
  assert.equal(sandbox.getOwner().activeNode, null);
});


test("PCM pump loop refills at a bounded cadence and cancels stale timers", async () => {
  const { PcmOutputScheduler, PcmOutputPumpLoop } = createEngineClass();
  const context = createMockOutputContext();
  const timerTasks = new Map();
  let timerId = 0;
  const schedule = (callback, delay) => {
    const id = ++timerId;
    timerTasks.set(id, { callback, delay });
    return id;
  };
  const cancel = id => timerTasks.delete(id);
  const chunks = [0, 1024, 2048].map(startFrame => ({
    startFrame, sampleRate: 8000, frameCount: 1024,
    left: new Float32Array(1024), right: new Float32Array(1024)
  }));
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() { return chunks.shift() || null; },
    cancel() { this.cancelled = true; }
  };
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const loop = new PcmOutputPumpLoop(scheduler, {
    intervalMs: 25, schedule, cancel
  });

  await loop.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  assert.equal(context.sources.length, 1);
  assert.equal(timerTasks.size, 1);
  assert.equal(timerTasks.values().next().value.delay, 25);

  const [firstTimerId, firstTimer] = timerTasks.entries().next().value;
  timerTasks.delete(firstTimerId);
  context.currentTime = 10.08;
  firstTimer.callback();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(context.sources.length, 2);
  assert.equal(scheduler.underrunCount, 0);
  assert.equal(timerTasks.size, 1);

  const stale = timerTasks.values().next().value.callback;
  loop.stop();
  assert.equal(queue.cancelled, true);
  assert.equal(timerTasks.size, 0);
  stale();
  await Promise.resolve();
  assert.equal(context.sources.length, 2);
  assert.equal(loop.active, false);
});

test("PCM pump loop waits for an in-flight read before starting a replacement session", async () => {
  const { PcmOutputScheduler, PcmOutputPumpLoop } = createEngineClass();
  const context = createMockOutputContext();
  const timerTasks = new Map();
  let timerId = 0;
  const schedule = (callback, delay) => {
    const id = ++timerId;
    timerTasks.set(id, callback);
    return id;
  };
  const cancel = id => timerTasks.delete(id);
  let releaseRead;
  const oldQueue = {
    maxChunkFrames: 1024,
    reads: 0,
    async readAsync() {
      this.reads++;
      if (this.reads === 1) {
        return {
          startFrame: 0, sampleRate: 8000, frameCount: 1024,
          left: new Float32Array(1024), right: new Float32Array(1024)
        };
      }
      return new Promise(resolve => { releaseRead = resolve; });
    },
    cancel() {
      this.cancelled = true;
      releaseRead?.(null);
    }
  };
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const loop = new PcmOutputPumpLoop(scheduler, {
    intervalMs: 25, schedule, cancel
  });
  await loop.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  const [timerKey, timerCallback] = timerTasks.entries().next().value;
  timerTasks.delete(timerKey);
  context.currentTime = 10.1;
  timerCallback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof releaseRead, "function");

  loop.stop();
  assert.equal(oldQueue.cancelled, true);

  const newQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 1024, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  };
  await loop.start(newQueue, {
    startFrame: 1024, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  assert.equal(loop.active, true);
  assert.equal(scheduler.active, true);
  assert.equal(context.sources.length, 2);
  loop.stop();
});


test("PCM preparation budgets compressed copies together with estimated decoded PCM", async () => {
  let decodeCalls = 0;
  const compressed = new ArrayBuffer(60);
  const { Engine } = createEngineClass(MockWorker, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => compressed }),
    audioCtx: {
      sampleRate: 48000,
      async decodeAudioData() {
        decodeCalls++;
        throw new Error("decode should not run when peak memory exceeds budget");
      }
    },
    state: {
      eqState: { gains: [0, 0, 0, 0, 0] },
      pitchSemitones: 0,
      currentSong: { duration: 1 }
    },
    ensureGraph() {}
  });
  const engine = new Engine();
  engine.sourceUrl = "https://music-player.invalid/audio";
  engine.maxPcmBytes = 384100;

  await assert.rejects(
    () => engine.prepare(),
    /exceed the PCM memory budget before decoding/
  );
  assert.equal(decodeCalls, 0);
  assert.equal(engine.buffer, null);
});

test("PCM preparation checks actual compressed-plus-decoded peak when duration is unknown", async () => {
  const compressed = new ArrayBuffer(100);
  let decodeCalls = 0;
  const samples = new Float32Array(101);
  const { Engine } = createEngineClass(MockWorker, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => compressed }),
    audioCtx: {
      sampleRate: 48000,
      async decodeAudioData() {
        decodeCalls++;
        return {
          length: 101,
          numberOfChannels: 2,
          duration: 101 / 48000,
          sampleRate: 48000,
          getChannelData() { return samples; }
        };
      }
    },
    state: {
      eqState: { gains: [0, 0, 0, 0, 0] },
      pitchSemitones: 0,
      currentSong: null
    },
    ensureGraph() {}
  });
  const engine = new Engine();
  engine.sourceUrl = "https://music-player.invalid/audio";
  engine.maxPcmBytes = 1000;

  await assert.rejects(
    () => engine.prepare(),
    /Compressed and decoded PCM exceed the available memory budget/
  );
  assert.equal(decodeCalls, 1);
  assert.equal(engine.buffer, null);
});


test("PCM prebuffer queue streams a long sequence within a two-chunk ring capacity", async () => {
  const { RingBuffer, PcmPrebufferQueue } = createEngineClass();
  const chunkFrames = 4096;
  const chunkCount = 128;
  const ring = new RingBuffer(chunkFrames * 2);
  ring.clear(0);
  async function* produce() {
    for (let index = 0; index < chunkCount; index++) {
      const startFrame = index * chunkFrames;
      const left = new Float32Array(chunkFrames);
      const right = new Float32Array(chunkFrames);
      left.fill(index);
      right.fill(-index);
      yield {
        startFrame, sampleRate: 48000, frameCount: chunkFrames,
        left, right
      };
    }
  }
  const queue = new PcmPrebufferQueue(ring, produce(), chunkFrames).start();
  let expectedFrame = 0;
  let consumedChunks = 0;
  while (true) {
    const chunk = await queue.readAsync(chunkFrames);
    if (!chunk) break;
    assert.equal(chunk.startFrame, expectedFrame);
    assert.equal(chunk.frameCount, chunkFrames);
    assert.equal(chunk.left[0], consumedChunks);
    assert.equal(chunk.right[0], -consumedChunks);
    expectedFrame += chunk.frameCount;
    consumedChunks++;
  }
  assert.equal(consumedChunks, chunkCount);
  assert.equal(expectedFrame, chunkCount * chunkFrames);
  assert.equal(ring.availableFrames, 0);
  assert.equal(ring.capacityFrames, chunkFrames * 2);
  assert.equal(ring.left.byteLength + ring.right.byteLength, chunkFrames * 2 * 2 * 4);
  assert.equal(queue.done, true);
});


test("PCM worker keeps a multi-chunk 192 kHz maximum-pitch stream contiguous", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  const sampleRate = 192000;
  const durationSeconds = 1;
  const length = sampleRate * durationSeconds;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    left[index] = Math.sin(index * 0.0007) * 0.5;
    right[index] = Math.cos(index * 0.0009) * 0.5;
  }
  engine.buffer = {
    sampleRate,
    length,
    duration: durationSeconds,
    numberOfChannels: 2,
    getChannelData(channel) { return channel === 0 ? left : right; }
  };

  let expectedFrame = 0;
  let chunkCount = 0;
  for await (const chunk of engine.iterateProcessedChunks({
    chunkFrames: 32768,
    eqGains: [0, 0, 0, 0, 0],
    pitch: 2
  })) {
    assert.equal(chunk.startFrame, expectedFrame);
    assert.ok(chunk.frameCount > 0 && chunk.frameCount <= 32768);
    for (let index = 0; index < chunk.frameCount; index += 4096) {
      assert.ok(Number.isFinite(chunk.left[index]));
      assert.ok(Number.isFinite(chunk.right[index]));
    }
    expectedFrame += chunk.frameCount;
    chunkCount++;
  }
  assert.equal(expectedFrame, length);
  assert.ok(chunkCount >= 6);
  engine.disposeProcessorWorker();
});


test("PCM pump loop fails closed when timer registration is unavailable", async () => {
  const { PcmOutputScheduler, PcmOutputPumpLoop } = createEngineClass();
  const context = createMockOutputContext();
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 0, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  };
  const errors = [];
  const scheduler = new PcmOutputScheduler(context, { connect() {} }, {
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const loop = new PcmOutputPumpLoop(scheduler, {
    intervalMs: 25,
    schedule() { throw new Error("timer registration failed"); },
    cancel() {},
    onError(error) { errors.push(error.message); }
  });

  await assert.rejects(
    () => loop.start(queue, {
      startFrame: 0, sampleRate: 8000, playbackRate: 1,
      blockFrames: 1024, startBufferFrames: 1024,
      lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
    }),
    /timer registration failed/
  );
  assert.equal(loop.active, false);
  assert.equal(scheduler.active, false);
  assert.equal(queue.cancelled, true);
  assert.equal(context.sources[0].stopped, true);
  assert.deepEqual(errors, ["timer registration failed"]);
});


test("PCM pump loop treats immediate EOF and cancelled startup as normal lifecycle outcomes", async () => {
  const { PcmOutputScheduler, PcmOutputPumpLoop } = createEngineClass();
  const context = createMockOutputContext();
  const timers = new Map();
  let timerId = 0;
  const schedule = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const cancel = id => timers.delete(id);

  const endedFrames = [];
  const endedScheduler = new PcmOutputScheduler(context, { connect() {} }, {
    onEnded: frame => endedFrames.push(frame)
  });
  const endedLoop = new PcmOutputPumpLoop(endedScheduler, { schedule, cancel });
  const eofQueue = {
    maxChunkFrames: 1024,
    async readAsync() { return null; },
    cancel() {}
  };
  await endedLoop.start(eofQueue, {
    startFrame: 0, sampleRate: 48000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024
  });
  assert.equal(endedScheduler.active, false);
  assert.equal(endedLoop.active, false);
  assert.equal(timers.size, 0);
  assert.deepEqual(endedFrames, [0]);

  let releaseRead;
  const waitingQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return new Promise(resolve => { releaseRead = resolve; });
    },
    cancel() { releaseRead?.(null); }
  };
  const waitingScheduler = new PcmOutputScheduler(context, { connect() {} });
  const waitingLoop = new PcmOutputPumpLoop(waitingScheduler, { schedule, cancel });
  const startPromise = waitingLoop.start(waitingQueue, {
    startFrame: 4096, sampleRate: 48000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(typeof releaseRead, "function");
  waitingLoop.stop();
  const startResult = await startPromise;
  assert.equal(startResult, false);
  assert.equal(waitingScheduler.active, false);
  assert.equal(waitingLoop.active, false);
  assert.equal(timers.size, 0);
});


test("PCM session controller owns graph routing and cleans up on pause/dispose", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const timers = new Map();
  let timerId = 0;
  const controller = new PcmPlaybackSessionController(context, router, {
    intervalMs: 25,
    schedule(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    cancel(id) { timers.delete(id); }
  });
  const queue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 0, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  };

  const session = await controller.start(queue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  assert.equal(controller.state, "running");
  assert.equal(controller.activeSession, session);
  assert.equal(controller.currentFrame, 0);
  assert.equal(activeInput.node, router.bus);
  assert.equal(session.gain.gain.value, 1);

  const stoppedFrame = controller.stop();
  assert.equal(stoppedFrame, 0);
  assert.equal(controller.state, "paused");
  assert.equal(controller.activeSession, null);
  assert.equal(queue.cancelled, true);
  assert.equal(session.gain.disconnected, true);
  assert.equal(activeInput.node, router.bus);

  controller.dispose();
  assert.equal(controller.state, "disposed");
  assert.equal(activeInput, null);
  assert.equal(router.bus.disconnected, true);
});

test("PCM session controller hands off contiguous frames and retires the old gain", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const makeQueue = startFrame => ({
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  });
  const oldQueue = makeQueue(0);
  const oldSession = await controller.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  let factoryBoundary = null;
  const result = await controller.handoff(async boundary => {
    factoryBoundary = boundary;
    return makeQueue(boundary.startFrame);
  }, {
    sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05,
    crossfadeSeconds: 0.02
  });

  assert.deepEqual(factoryBoundary, result.handoff);
  assert.equal(result.handoff.startFrame, 1024);
  assert.equal(result.handoff.startAtTime, 10.178);
  assert.equal(controller.activeSession, result.session);
  assert.equal(controller.currentFrame, 0);
  context.currentTime = result.session.scheduler.firstScheduledAt + 0.022;
  assert.equal(controller.currentFrame, 1200);
  assert.equal(controller.state, "running");
  assert.equal(oldQueue.cancelled, true);
  assert.equal(result.session.scheduler.firstScheduledAt, result.handoff.startAtTime);
  const oldFade = oldSession.gain.gain.events.slice(-3);
  const newFade = result.session.gain.gain.events.slice(-3);
  assert.ok(Math.abs(oldFade[0][1] - 10.158) < 0.000001);
  assert.ok(Math.abs(oldFade[1][2] - 10.158) < 0.000001);
  assert.equal(oldFade[2][1], 0);
  assert.equal(oldFade[2][2], 10.178);
  assert.ok(Math.abs(newFade[0][1] - 10.158) < 0.000001);
  assert.ok(Math.abs(newFade[1][2] - 10.158) < 0.000001);
  assert.equal(newFade[1][1], 0);
  assert.equal(newFade[2][1], 1);
  assert.equal(newFade[2][2], 10.178);

  context.sources[0].finish();
  assert.equal(oldSession.gain.disconnected, true);
  assert.equal(controller.drainingSessions.size, 0);
  controller.dispose();
  assert.equal(result.session.gain.disconnected, true);
});


test("PCM controller handoff creates the next isolated Worker queue at the exact drain frame", async () => {
  const workers = [];
  class TrackingWorker extends MockWorker {
    constructor() {
      super();
      workers.push(this);
    }
  }
  const { Engine, PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass(TrackingWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(48000, 2);
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const queueOptions = {
    concurrentSession: true,
    chunkFrames: 1024,
    capacityFrames: 4096,
    eqGains: [0, 0, 0, 0, 0]
  };
  const firstQueue = await engine.createProcessedPcmQueue({ ...queueOptions, startFrame: 0, pitch: 1 });
  const firstSession = await controller.start(firstQueue, {
    startFrame: 0, sampleRate: 48000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.25, minimumLeadSeconds: 0.03
  });

  let factoryBoundary = null;
  let secondQueue = null;
  const handoffResult = await controller.handoff(async boundary => {
    factoryBoundary = boundary;
    secondQueue = await engine.createProcessedPcmQueue({
      ...queueOptions,
      startFrame: boundary.startFrame,
      pitch: 1.5
    });
    return secondQueue;
  }, {
    sampleRate: 48000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.25, minimumLeadSeconds: 0.03,
    crossfadeSeconds: 0.02
  });

  assert.equal(workers.length, 2);
  assert.notEqual(workers[0], workers[1]);
  assert.equal(firstQueue.cancelled, true);
  assert.equal(workers[0].terminated, true);
  assert.equal(handoffResult.handoff.startFrame, factoryBoundary.startFrame);
  assert.equal(handoffResult.session.scheduler.initialFrame, factoryBoundary.startFrame);
  assert.equal(handoffResult.session.scheduler.firstScheduledAt, factoryBoundary.startAtTime);
  assert.equal(controller.activeSession, handoffResult.session);
  assert.equal(controller.state, "running");
  assert.equal(engine.activePcmQueues.has(secondQueue), true);

  controller.dispose();
  engine.cancelProcessedPcmQueue();
  assert.equal(workers.every(worker => worker.terminated), true);
  assert.equal(engine.activePcmQueues.size, 0);
  assert.equal(activeInput, null);
  assert.equal(firstSession.gain.disconnected, true);
});

test("PCM session handoff cancels a factory queue when a newer stop invalidates preparation", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const makeQueue = startFrame => ({
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  });
  await controller.start(makeQueue(0), {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  let resolveFactory;
  const handoffPromise = controller.handoff(() => new Promise(resolve => {
    resolveFactory = resolve;
  }), {
    sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  assert.equal(typeof resolveFactory, "function");
  const handoffBoundary = controller.lastFrame;
  assert.equal(handoffBoundary, 1024);
  context.currentTime = 10.1001;
  const audibleFrameDuringDrain = controller.currentFrame;
  assert.equal(audibleFrameDuringDrain, 400);
  const stoppedFrame = controller.stop();
  assert.equal(stoppedFrame, audibleFrameDuringDrain);
  const staleQueue = makeQueue(1024);
  resolveFactory(staleQueue);

  assert.equal(await handoffPromise, false);
  assert.equal(staleQueue.cancelled, true);
  assert.equal(controller.state, "paused");
  assert.equal(controller.lastFrame, audibleFrameDuringDrain);
  assert.equal(controller.activeSession, null);
  controller.dispose();
  assert.equal(activeInput, null);
});

test("PCM controller chains a newer handoff from the latest draining scheduler", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const makeQueue = startFrame => ({
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  });
  const firstQueue = makeQueue(0);
  const firstSession = await controller.start(firstQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  let resolveStaleFactory;
  const staleHandoff = controller.handoff(() => new Promise(resolve => {
    resolveStaleFactory = resolve;
  }), {
    sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const nextQueue = makeQueue(1024);
  const nextHandoff = await controller.handoff(boundary => {
    assert.equal(boundary.startFrame, 1024);
    assert.equal(boundary.startAtTime, firstSession.scheduler.nextStartTime);
    return nextQueue;
  }, {
    sampleRate: 8000, playbackRate: 1.25,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  assert.equal(nextHandoff.session.scheduler.initialFrame, 1024);
  assert.equal(controller.activeSession, nextHandoff.session);
  assert.equal(controller.drainingSessions.has(firstSession), true);
  assert.equal(controller.currentFrame, 0);
  context.currentTime = nextHandoff.session.scheduler.firstScheduledAt + 0.022;
  assert.equal(controller.currentFrame, 1244);
  const staleQueue = makeQueue(0);
  resolveStaleFactory(staleQueue);
  assert.equal(await staleHandoff, false);
  assert.equal(staleQueue.cancelled, true);
  controller.dispose();
  assert.equal(activeInput, null);
});

test("PCM session handoff reports queue factory errors without creating a new session", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const oldQueue = {
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame: 0, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  };
  const oldSession = await controller.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });

  await assert.rejects(
    () => controller.handoff(async () => { throw new Error("queue preparation failed"); }, {
      sampleRate: 8000, playbackRate: 1,
      blockFrames: 1024, startBufferFrames: 1024,
      lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
    }),
    /queue preparation failed/
  );
  assert.equal(controller.state, "error");
  assert.equal(controller.activeSession, null);
  assert.equal(controller.lastError.message, "queue preparation failed");
  assert.equal(controller.drainingSessions.has(oldSession), true);
  controller.dispose();
  assert.equal(activeInput, null);
});

test("PCM session handoff cleans up transactionally when new gain creation fails", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const makeQueue = startFrame => ({
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  });
  const oldQueue = makeQueue(0);
  const oldSession = await controller.start(oldQueue, {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  const createGain = router.createSessionGain.bind(router);
  router.createSessionGain = () => { throw new Error("gain creation failed"); };

  await assert.rejects(
    () => controller.handoff(makeQueue(1024), {
      sampleRate: 8000, playbackRate: 1,
      blockFrames: 1024, startBufferFrames: 1024,
      lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
    }),
    /gain creation failed/
  );
  assert.equal(controller.state, "error");
  assert.equal(controller.activeSession, null);
  assert.equal(controller.lastError.message, "gain creation failed");
  assert.equal(controller.drainingSessions.has(oldSession), true);

  router.createSessionGain = createGain;
  controller.dispose();
  assert.equal(controller.state, "disposed");
  assert.equal(oldSession.gain.disconnected, true);
  assert.equal(activeInput, null);
});

test("PCM session handoff retires the new session when crossfade scheduling fails", async () => {
  const { PcmOutputGraphRouter, PcmPlaybackSessionController } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const setGraphInput = (node, target) => {
    if (activeInput?.node && activeInput.node !== node) {
      try { activeInput.node.disconnect(activeInput.target); } catch (error) {}
    }
    activeInput = node ? { node, target } : null;
    return true;
  };
  const clearGraphInput = (node, target) => {
    if (activeInput?.node !== node || activeInput.target !== target) return false;
    try { node.disconnect(target); } catch (error) {}
    activeInput = null;
    return true;
  };
  const router = new PcmOutputGraphRouter(context, routeNode, setGraphInput, clearGraphInput);
  const controller = new PcmPlaybackSessionController(context, router);
  const makeQueue = startFrame => ({
    maxChunkFrames: 1024,
    async readAsync() {
      return {
        startFrame, sampleRate: 8000, frameCount: 1024,
        left: new Float32Array(1024), right: new Float32Array(1024)
      };
    },
    cancel() { this.cancelled = true; }
  });
  const oldSession = await controller.start(makeQueue(0), {
    startFrame: 0, sampleRate: 8000, playbackRate: 1,
    blockFrames: 1024, startBufferFrames: 1024,
    lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
  });
  router.crossfade = () => { throw new Error("crossfade scheduling failed"); };

  await assert.rejects(
    () => controller.handoff(makeQueue(1024), {
      sampleRate: 8000, playbackRate: 1,
      blockFrames: 1024, startBufferFrames: 1024,
      lookAheadSeconds: 0.1, minimumLeadSeconds: 0.05
    }),
    /crossfade scheduling failed/
  );
  assert.equal(controller.state, "error");
  assert.equal(controller.activeSession, null);
  assert.equal(controller.lastError.message, "crossfade scheduling failed");
  assert.equal(controller.drainingSessions.has(oldSession), true);
  assert.equal(context.sources[1].stopped, true);

  controller.dispose();
  assert.equal(oldSession.gain.disconnected, true);
  assert.equal(activeInput, null);
});


test("PCM graph input ownership preserves the current route when replacement connection fails", () => {
  const { GraphInputOwnership } = createEngineClass();
  const ownership = new GraphInputOwnership();
  const targetA = {};
  const targetB = {};
  const events = [];
  const oldNode = {
    connect(target) { events.push(["old-connect", target]); },
    disconnect(target) { events.push(["old-disconnect", target]); }
  };
  const failingNode = {
    connect(target) { events.push(["failed-connect", target]); throw new Error("connect failed"); },
    disconnect(target) { events.push(["failed-disconnect", target]); }
  };

  ownership.set(oldNode, targetA);
  assert.throws(() => ownership.set(failingNode, targetB), /connect failed/);
  assert.equal(ownership.activeNode, oldNode);
  assert.equal(ownership.activeTarget, targetA);
  assert.deepEqual(events.map(event => event[0]), ["old-connect", "failed-connect"]);
});

test("PCM graph input ownership switches and clears only the exact owned connection", () => {
  const { GraphInputOwnership } = createEngineClass();
  const ownership = new GraphInputOwnership();
  const targetA = {};
  const targetB = {};
  const events = [];
  const makeNode = name => ({
    connect(target) { events.push([name, "connect", target]); },
    disconnect(target) { events.push([name, "disconnect", target]); }
  });
  const mediaNode = makeNode("media");
  const pcmNode = makeNode("pcm");

  ownership.set(mediaNode, targetA);
  ownership.set(mediaNode, targetA);
  ownership.set(pcmNode, targetB);
  assert.equal(ownership.activeNode, pcmNode);
  assert.equal(ownership.activeTarget, targetB);
  assert.equal(events.filter(event => event[0] === "media" && event[1] === "connect").length, 1);
  assert.equal(events.some(event => event[0] === "media" && event[1] === "disconnect" && event[2] === targetA), true);
  assert.equal(ownership.clear(mediaNode, targetA), false);
  assert.equal(ownership.activeNode, pcmNode);
  assert.equal(ownership.clear(pcmNode, {}), false);
  assert.equal(ownership.activeNode, pcmNode);
  assert.equal(ownership.clear(pcmNode, targetB), true);
  assert.equal(ownership.activeNode, null);
  assert.equal(ownership.activeTarget, null);
});

test("PCM graph input ownership reset detaches a stale graph edge", () => {
  const { GraphInputOwnership } = createEngineClass();
  const ownership = new GraphInputOwnership();
  const target = {};
  let disconnectCount = 0;
  const node = {
    connect() {},
    disconnect(value) { assert.equal(value, target); disconnectCount++; }
  };
  ownership.set(node, target);
  ownership.reset();
  ownership.reset();
  assert.equal(disconnectCount, 1);
  assert.equal(ownership.activeNode, null);
  assert.equal(ownership.activeTarget, null);
});


test("PCM graph detach disconnects only its owned edge once", () => {
  const { PcmOutputGraphRouter } = createEngineClass();
  const context = createMockOutputContext();
  const routeNode = { connect() {} };
  let activeInput = null;
  const router = new PcmOutputGraphRouter(
    context,
    routeNode,
    (node, target) => {
      node.connect(target);
      activeInput = { node, target };
      return true;
    },
    (node, target) => {
      if (activeInput?.node !== node || activeInput.target !== target) return false;
      node.disconnect(target);
      activeInput = null;
      return true;
    }
  );
  const disconnectCalls = [];
  router.bus.disconnect = target => { disconnectCalls.push(target); };
  const sessionGain = router.createSessionGain(1);

  assert.equal(sessionGain.connectedTo, router.bus);
  assert.equal(router.detach(), true);
  assert.deepEqual(disconnectCalls, [routeNode]);
  assert.equal(sessionGain.connectedTo, router.bus);
  assert.equal(activeInput, null);

  router.dispose();
});


test("audio graph exposes and clears the stable post-DSP PCM insertion boundary", () => {
  const boundary = audioSource.indexOf("audioCtx._musicPlayerPostDspInputNode = pitchRouteNode;");
  const spatialRoute = audioSource.indexOf("if (pannerNode)", boundary);
  assert.ok(boundary >= 0, "post-DSP input boundary must be exposed");
  assert.ok(spatialRoute > boundary, "PCM boundary must precede spatial processing");
  assert.match(audioSource, /if \(audioCtx\) audioCtx\._musicPlayerPostDspInputNode = null;/);
});
