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

function createEngineClass(WorkerClass = MockWorker) {
  const sandbox = {
    Worker: WorkerClass,
    URL,
    document: { baseURI: "https://music-player.invalid/" },
    navigator: { deviceMemory: 4 },
    state: { eqState: { gains: [0, 0, 0, 0, 0] }, pitchSemitones: 0, currentSong: null },
    audioCtx: { sampleRate: 48000 },
    setGraphInputNode() {}
  };
  vm.runInNewContext(engineSource + "\nthis.BufferedPlaybackEngine = BufferedPlaybackEngine;\n  this.ProcessedPcmRingBuffer = ProcessedPcmRingBuffer;\n  this.PcmPrebufferQueue = PcmPrebufferQueue;", sandbox);
  return { Engine: sandbox.BufferedPlaybackEngine, RingBuffer: sandbox.ProcessedPcmRingBuffer, PcmPrebufferQueue: sandbox.PcmPrebufferQueue };
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
