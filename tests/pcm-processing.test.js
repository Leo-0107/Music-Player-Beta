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
    audioCtx: { sampleRate: 48000 }
  };
  vm.runInNewContext(engineSource + "\nthis.BufferedPlaybackEngine = BufferedPlaybackEngine;", sandbox);
  return sandbox.BufferedPlaybackEngine;
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
  const Engine = createEngineClass();
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
  const Engine = createEngineClass(WrongResponseWorker);
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(8000, 1);
  engine.sourceUrl = "blob:pcm-test";

  await assert.rejects(async () => {
    for await (const chunk of engine.iterateProcessedChunks({ pitch: 1 })) {
      void chunk;
    }
  }, /Unexpected PCM worker response/);
});
