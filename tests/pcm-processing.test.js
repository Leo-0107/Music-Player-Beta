// Run with: node --test tests/pcm-processing.test.js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const engineSource = fs.readFileSync(path.join(root, "js/9. buffered-playback-engine.js"), "utf8");
const workerSource = fs.readFileSync(path.join(root, "js/10. pcm-processing-worker.js"), "utf8");
const audioSource = fs.readFileSync(path.join(root, "js/7. audio.js"), "utf8");
const outputSource = fs.readFileSync(path.join(root, "js/11. audio-output.js"), "utf8");
const stateSource = fs.readFileSync(path.join(root, "js/2. state.js"), "utf8");
const uiSource = fs.readFileSync(path.join(root, "js/6. ui.js"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const youtubeSource = fs.readFileSync(path.join(root, "js/5. youtube.js"), "utf8");
const librarySource = fs.readFileSync(path.join(root, "js/4. library.js"), "utf8");
const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");

const controllerSource = fs.readFileSync(path.join(root, "js/1. ctrl.js"), "utf8");
const serviceWorkerSource = fs.readFileSync(path.join(root, "js/13. sw.js"), "utf8");
const rootServiceWorkerSource = fs.readFileSync(path.join(root, "sw.js"), "utf8");

test("mini-player progress fill and thumb share one visual position", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  const manifestSource = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
  assert.ok(styleSource.includes('.miniProgressWrap input[type="range"] {'));
  assert.ok(styleSource.includes("-webkit-appearance: none;"));
  assert.ok(styleSource.includes("appearance: none;"));
  assert.ok(styleSource.includes(".miniProgressWrap::after"));
  assert.ok(styleSource.includes("width: var(--mini-progress-position);"));
  assert.ok(styleSource.includes("left: var(--mini-progress-position);"));
  assert.ok(styleSource.includes(".miniProgressThumb"));
  assert.ok(indexSource.includes('<span class="miniProgressThumb" aria-hidden="true"></span>'));
  assert.ok(uiSource.includes("getBoundingClientRect().width"));
  assert.ok(uiSource.includes("const thumbSize = wrap.classList.contains(\"is-scrubbing\") ? 6 : 3;"));
  assert.ok(uiSource.includes("(progress / 100) * Math.max(0, width - thumbSize)"));
  assert.ok(uiSource.includes('style.setProperty("--mini-progress-position"'));
  assert.ok(uiSource.includes('style.setProperty("--mini-progress-size"'));
  assert.ok(styleSource.includes("::-webkit-slider-runnable-track"));
  assert.ok(styleSource.includes("::-moz-range-track"));
  assert.match(styleSource, /\.miniProgressWrap input\[type="range"\]::-webkit-slider-thumb\s*\{[^}]*background:\s*transparent;/);
  assert.match(styleSource, /\.miniProgressWrap input\[type="range"\]::-moz-range-thumb\s*\{[^}]*background:\s*transparent;/);
  assert.ok(indexSource.includes('const APP_VERSION = "v7.5.17";'));
  assert.ok(indexSource.includes("const BUILD_REVISION = 17"));
  // The artwork placeholder and application diagnostics share the same BR.
  assert.match(indexSource, /\.fileLoadProgress\s*\{[^}]*z-index:\s*2147483647/);
  assert.ok(audioSource.includes("const BUILD_REVISION = 17;"));
  assert.ok(manifestSource.includes("Music Player v7.5.17"));
  assert.ok(serviceWorkerSource.includes('music-player-app-v7.5.17-r16'));
  assert.ok(indexSource.includes("7.5.17-r17"));
  assert.ok(controllerSource.includes("7.5.17-r17"));
  assert.ok(rootServiceWorkerSource.includes("7.5.17-r17"));
});

test("mini-player progress bar and thumb enlarge only while the pointer is held", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(styleSource, /\.miniProgressWrap\s*\{[^}]*height:\s*3px;[^}]*margin-top:\s*4px;/);
  assert.match(styleSource, /\.miniProgressWrap input\[type="range"\]\s*\{[^}]*height:\s*20px;/);
  assert.match(styleSource, /\.miniPlayer\s*\{[^}]*padding:\s*8px 16px 10px;/);
  assert.ok(styleSource.includes("--mini-progress-size: 3px;"));
  assert.ok(styleSource.includes(".miniProgressWrap.is-scrubbing {"));
  assert.ok(styleSource.includes("--mini-progress-size: 6px;"));
  assert.ok(styleSource.includes("--mini-progress-position"));
  assert.ok(styleSource.includes("transition: width 140ms ease, height 140ms ease;"));
  assert.doesNotMatch(styleSource, /--mini-progress\s+\d+ms/);
  assert.ok(styleSource.includes(".miniProgressWrap.is-scrubbing .miniProgressThumb"));
  assert.ok(styleSource.includes("transition: none !important;"));
  assert.ok(styleSource.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(uiSource.includes('miniProgressWrap?.classList.add("is-scrubbing")'));
  assert.ok(uiSource.includes('miniProgressWrap?.classList.remove("is-scrubbing")'));
  assert.ok(uiSource.includes('window.addEventListener("pointerup", finishMiniProgressScrub, true)'));
  assert.ok(uiSource.includes('window.addEventListener("pointercancel", finishMiniProgressScrub, true)'));
  assert.ok(uiSource.includes('el.miniProgress.addEventListener("lostpointercapture", finishMiniProgressScrub)'));
  assert.ok(uiSource.includes('document.visibilityState !== "visible"'));
  assert.ok(uiSource.includes("miniProgressPendingValue = miniProgressValue"));
  assert.ok(uiSource.includes("miniProgressSeekFrame = requestAnimationFrame"));
  assert.ok(uiSource.includes("cancelAnimationFrame(miniProgressSeekFrame)"));
  assert.ok(uiSource.includes("flushMiniProgressSeek();"));
  assert.ok(uiSource.includes("audio.currentTime = (value / 100) * duration"));
});

test("diagnostic history is grouped under settings history and records the BR from the error occurrence", () => {
  const historyStart = uiSource.indexOf("history: {");
  const otherStart = uiSource.indexOf("other: {", historyStart);
  const otherEnd = uiSource.indexOf("\n    }\n  };", otherStart);
  assert.ok(historyStart >= 0 && otherStart > historyStart);
  assert.ok(otherEnd > otherStart);
  const historySource = uiSource.slice(historyStart, otherStart);
  const otherSource = uiSource.slice(otherStart, otherEnd);
  assert.ok(historySource.includes('["diagnosticsSection", "📋", "診断情報の履歴"'));
  assert.equal(otherSource.includes('["diagnosticsSection"'), false);
  assert.ok(indexSource.includes("revision: BUILD_REVISION"));
  assert.ok(indexSource.includes('"エラー発生時BR: " + (entry.revision ?? "不明")'));
  assert.ok(indexSource.includes('"診断レポート作成時BUILD_REVISION: " + BUILD_REVISION'));
});

test("accent colour is persisted and applied through shared theme tokens", () => {
  const storageSource = fs.readFileSync(path.join(root, "js/3. storage.js"), "utf8");
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(storageSource.includes('accentColor: "mp_accent_color_v1"'));
  assert.ok(stateSource.includes('accentColor: loadStr(STORAGE.accentColor, "#35D977")'));
  assert.ok(audioSource.includes('localStorage.setItem(STORAGE.accentColor, state.accentColor || "#35D977")'));
  assert.ok(audioSource.includes('document.body.style.setProperty("--accent", safeAccent)'));
  assert.ok(audioSource.includes('STORAGE.accentColor,'));
  assert.ok(indexSource.includes('id="accentColorInput"'));
  assert.ok(indexSource.includes('id="btnResetAccentColor"'));
  assert.ok(styleSource.includes('accent-color: var(--accent)'));
  assert.ok(!styleSource.includes("rgba(53, 217, 119") && !styleSource.includes("rgba(53,217,119"));
  assert.ok(styleSource.includes('var(--accent-contrast, #07120a)'));
});

test("custom theme background is also applied to the sidebar surface", () => {
  assert.ok(indexSource.includes('document.body.style.setProperty("--bg", c2)'));
  assert.ok(audioSource.includes('document.body.style.setProperty("--bg", computedC2)'));
  assert.ok(audioSource.includes('document.body.style.removeProperty("--bg")'));
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(styleSource.includes(".sidebar {"));
  assert.ok(styleSource.includes("background: var(--bg);"));
});

test("settings and menu category headings are represented only by their back title", () => {
  assert.ok(indexSource.includes('class="settingsBackButton settingsCategoryTitle settingsCategoryBackTitle" id="btnSettingsCategoryBack"'));
  assert.ok(indexSource.includes('class="settingsBackButton settingsCategoryTitle settingsCategoryBackTitle" id="btnMenuCategoryBack"'));
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(styleSource.includes(".settingsCategoryView > div.settingsCategoryTitle { display: none !important; }"));
  assert.ok(styleSource.includes(".settingsCategoryView > .settingsBackButton.settingsCategoryTitle"));
});

test("2D spectrum and stereo peak meters retain their original rainbow colours", () => {
  assert.ok(uiSource.includes("const hue = (i / Math.max(1, bars - 1)) * 280 + 120;"));
  assert.ok(uiSource.includes('ctx.fillStyle = `hsla(${hue}, 85%, 55%, 0.8)`;'));
  assert.ok(uiSource.includes('ctx.fillStyle = `hsla(${hue}, 100%, 75%, 0.25)`;'));
  assert.ok(uiSource.includes('meterGradient.addColorStop(0, "#35D977")'));
  assert.ok(uiSource.includes('meterGradient.addColorStop(0.58, "#d7df28")'));
  assert.ok(uiSource.includes('meterGradient.addColorStop(1, "#ff3b30")'));
  assert.ok(!uiSource.includes('const accentColor = document.body.style.getPropertyValue("--accent")'));
});

test("settings and menu category back labels follow the selected category", () => {
  assert.ok(uiSource.includes('btnSettingsCategoryBack.textContent = "← " + category.title'));
  assert.ok(uiSource.includes('menuBack.textContent = "← " + category.title'));
  assert.ok(uiSource.includes('btnMenuCategoryBack.textContent = "← " + title'));
  assert.ok(uiSource.includes('openMenuDetail(targetId, title, category.title)'));
});

test("menu tools stay hidden after entering the first category level", () => {
  assert.match(styleSource, /\.menuTools\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  const categoryStart = uiSource.indexOf("function showMenuCategory(");
  const categoryEnd = uiSource.indexOf("\n  let activeSettingsDetail", categoryStart);
  assert.ok(categoryStart >= 0 && categoryEnd > categoryStart);
  const categorySource = uiSource.slice(categoryStart, categoryEnd);
  assert.ok(categorySource.includes('node.hidden = true'));
});

test("settings detail header uses the selected operation title", () => {
  const start = uiSource.indexOf("function openSettingsDetail(secId, title)");
  const end = uiSource.indexOf("function showSettingsCategory", start);
  const detailSource = uiSource.slice(start, end);
  assert.ok(detailSource.includes('btnSettingsCategoryBack.textContent = "← " + title'));
  assert.equal(detailSource.includes('btnSettingsCategoryBack.textContent = "← " + activeSettingsCategoryTitle'), false);
});

test("settings keyword search uses the specified custom clear glyph", () => {
  assert.ok(indexSource.includes('id="settingsSearchClear"'));
  assert.ok(indexSource.includes('aria-label="検索文字を消去"'));
  assert.ok(indexSource.includes('hidden>✕</button>'));
  assert.ok(uiSource.includes('settingsSearchClearButton.addEventListener("click"'));
  assert.ok(uiSource.includes('applySettingsSearch("")'));
  assert.ok(styleSource.includes("#settingsSearch::-webkit-search-cancel-button"));
});

test("settings detail uses the existing category back header without a separate sheet", () => {
  assert.ok(indexSource.includes('class="settingsBackButton settingsCategoryTitle settingsCategoryBackTitle" id="btnSettingsCategoryBack"'));
  assert.ok(!indexSource.includes('id="btnSettingsDetailBack"'));
  assert.ok(!indexSource.includes("settingsDetailOverlay"));
  assert.ok(!indexSource.includes("settingsDetailPanelTitle"));
  assert.ok(uiSource.includes('btnSettingsCategoryBack.textContent = "← " + activeSettingsCategoryTitle'));
  assert.ok(uiSource.includes("settingsCategoryView.appendChild(target)"));
  assert.ok(uiSource.includes("if (settingsCategoryTitle) settingsCategoryTitle.hidden = true;"));
  assert.ok(uiSource.includes("if (settingsCategoryTitle) settingsCategoryTitle.hidden = false;"));
});

test("settings icons retain full colour and bottom navigation uses frosted glass styling", () => {
  const cssSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(cssSource.includes(".settingsIcon {\n  filter: none !important;"));
  assert.ok(!cssSource.includes("filter: grayscale(.72)"));
  assert.ok(cssSource.includes("backdrop-filter: blur(24px) saturate(1.55)"));
  assert.ok(cssSource.includes("body.theme-light .bottomNav"));
  assert.ok(!cssSource.includes(".settingsDetailBackTitle"));
  assert.ok(cssSource.includes(".settingsCategoryTitle {\n  font-size: 1rem;\n  font-weight: 700;\n  padding: 4px 2px 2px;"));
  assert.ok(cssSource.includes(".settingsCategoryView > .settingsBackButton.settingsCategoryTitle"));
});

test("navigation and settings interactions include subtle motion with reduced-motion support", () => {
  const cssSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(uiSource.includes("animateUiEntry(activePanel)"));
  assert.ok(uiSource.includes("animateUiEntry(settingsCategoryView)"));
  assert.ok(uiSource.includes("animateUiEntry(target)"));
  assert.ok(cssSource.includes("@keyframes navTabTap"));
  assert.ok(cssSource.includes("@keyframes uiEnter"));
  assert.ok(cssSource.includes("@media (prefers-reduced-motion: reduce)"));
  assert.ok(cssSource.includes(".settingsCategoryCard:hover"));
});

test("nonessential explanatory UI copy and section help controls are removed", () => {
  assert.ok(!uiSource.includes("sectionHelpBtn"));
  assert.ok(!uiSource.includes("この設定の説明"));
  assert.ok(!uiSource.includes("description ? `<small>${description}</small>`"));
  assert.ok(!indexSource.includes("再生速度・音質・スリープタイマーなど"));
  assert.ok(!indexSource.includes("アプリで記録された診断ログを新しい順に表示します"));
  assert.ok(!indexSource.includes("曲を長押しすると順番を入れ替えできます"));
});

test("JavaScript files are numbered and grouped by responsibility with all paths synchronized", () => {
  const expectedFiles = [
    "1. ctrl.js", "2. state.js", "3. storage.js", "4. library.js",
    "5. youtube.js", "6. ui.js", "7. audio.js", "8. pitch-worklet.js",
    "9. buffered-playback-engine.js", "10. pcm-processing-worker.js",
    "11. audio-output.js", "12. speaker-delay-worklet.js", "13. sw.js"
  ].sort();
  const actualFiles = fs.readdirSync(path.join(root, "js"))
    .filter(file => file.endsWith(".js"))
    .sort();
  assert.deepEqual(actualFiles, expectedFiles, "every JavaScript module must have its assigned number");
  for (const file of expectedFiles) {
    assert.ok(serviceWorkerSource.includes(`"./js/${file}"`), `Service Worker cache list must include ${file}`);
  }
  assert.ok(controllerSource.includes("3. storage.js?v=7.5.17-r17"));
  assert.ok(controllerSource.includes("2. state.js?v=7.5.17-r17"));
  assert.ok(controllerSource.includes("7. audio.js?v=7.5.17-r17"));
  assert.ok(controllerSource.includes("11. audio-output.js?v=7.5.17-r17"));
  assert.ok(engineSource.includes("js/10. pcm-processing-worker.js"));
  assert.ok(audioSource.includes("js/8. pitch-worklet.js"));
  assert.ok(outputSource.includes("js/12. speaker-delay-worklet.js"));
  assert.ok(rootServiceWorkerSource.includes("./js/13. sw.js?v=7.5.17-r17"));
});


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
  let notifySecondRead;
  const secondReadStarted = new Promise(resolve => { notifySecondRead = resolve; });
  let reads = 0;
  const queue = {
    maxChunkFrames: 4,
    async readAsync() {
      reads++;
      if (reads === 1) return makePcmChunk(0, [1, 2, 3, 4]);
      if (reads === 2) return new Promise(resolve => {
        releaseSecond = resolve;
        notifySecondRead();
      });
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
  await secondReadStarted;
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

test("PCM preparation refuses an unknown duration before allocating decoded audio", async () => {
  const compressed = new ArrayBuffer(100);
  let decodeCalls = 0;
  const { Engine } = createEngineClass(MockWorker, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => compressed }),
    audioCtx: {
      sampleRate: 48000,
      async decodeAudioData() {
        decodeCalls++;
        throw new Error("decode must not run without a duration estimate");
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

  await assert.rejects(
    () => engine.prepare(),
    /duration is unavailable; PCM memory use cannot be estimated safely/
  );
  assert.equal(decodeCalls, 0);
  assert.equal(engine.buffer, null);
});

test("PCM preparation checks actual compressed-plus-decoded peak if duration metadata underestimates", async () => {
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
      currentSong: { duration: 0.001 }
    },
    ensureGraph() {}
  });
  const engine = new Engine();
  engine.sourceUrl = "https://music-player.invalid/audio";
  engine.maxPcmBytes = 700;

  await assert.rejects(
    () => engine.prepare(),
    /Compressed and decoded PCM exceed the available memory budget/
  );
  assert.equal(decodeCalls, 1);
  assert.equal(engine.buffer, null);
});

test("fallback invalidates an in-flight decode without surfacing a stale play failure", async () => {
  let finishDecode;
  let markDecodeStarted;
  const decodeStarted = new Promise(resolve => { markDecodeStarted = resolve; });
  const { Engine } = createEngineClass(MockWorker, {
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(100) }),
    audioCtx: {
      sampleRate: 48000,
      decodeAudioData() {
        markDecodeStarted();
        return new Promise(resolve => { finishDecode = resolve; });
      }
    },
    state: {
      eqState: { gains: [0, 0, 0, 0, 0] },
      pitchSemitones: 0,
      currentSong: { duration: 1 }
    },
    ensureGraph() {},
    resumeAudioCtx: async () => {},
    canUseBufferedPlayback: () => true
  });
  const engine = new Engine();
  engine.sourceUrl = "blob:pcm-fallback-race";
  const playRequest = engine.play();
  await decodeStarted;
  engine.releaseForFallback();
  finishDecode({});
  await playRequest;

  assert.equal(engine.buffer, null);
  assert.equal(engine.playRequested, false);
  assert.equal(engine.paused, true);
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


test("MediaElement fallback preserves the PCM position and resumes through the existing Web Audio graph", async () => {
  const start = audioSource.indexOf("async function switchBufferedPlaybackToMediaElement(");
  const end = audioSource.indexOf("\n  let outputTransitionPromise", start);
  assert.ok(start >= 0 && end > start, "audio.js fallback function must exist");
  const fallbackSource = audioSource.slice(start, end);

  const events = [];
  const mediaElement = {
    readyState: 1,
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    src: "",
    async play() { events.push("play"); return true; },
    addEventListener() {},
    removeEventListener() {}
  };
  const engine = {
    sourceUrl: "blob:pcm-fallback-test",
    currentTime: 12.5,
    paused: false,
    released: false,
    releaseForFallback() { this.released = true; this.paused = true; }
  };
  const graphInput = { node: null, target: null };
  const sandbox = {
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engine,
    mediaElement,
    currentRate: 1.25,
    filters: [{}],
    audioCtx: null,
    ensureGraph() { events.push("ensureGraph"); },
    setGraphInputNode(node, target) { graphInput.node = node; graphInput.target = target; },
    updatePitchShiftNode() { events.push("updatePitchShiftNode"); },
    sourceNode: { name: "media-element-source" },
    console: { warn() {} },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(fallbackSource + "\nthis.runFallback = switchBufferedPlaybackToMediaElement;", sandbox);
  const switched = await sandbox.runFallback(new Error("simulated PCM failure"), true);

  assert.equal(switched, true);
  assert.equal(sandbox.bufferedPlaybackMode, false);
  assert.equal(engine.released, true);
  assert.equal(mediaElement.src, "blob:pcm-fallback-test");
  assert.equal(mediaElement.currentTime, 12.5);
  assert.equal(mediaElement.playbackRate, 1.25);
  assert.equal(mediaElement.preservesPitch, true);
  assert.equal(graphInput.node, sandbox.sourceNode);
  assert.equal(graphInput.target, sandbox.filters[0]);
  assert.deepEqual(events, ["ensureGraph", "updatePitchShiftNode", "play"]);
});

test("MediaElement fallback keeps a paused PCM session paused", async () => {
  const start = audioSource.indexOf("async function switchBufferedPlaybackToMediaElement(");
  const end = audioSource.indexOf("\n  let outputTransitionPromise", start);
  assert.ok(start >= 0 && end > start, "audio.js fallback function must exist");
  const fallbackSource = audioSource.slice(start, end);

  let playCalls = 0;
  const mediaElement = {
    readyState: 1,
    currentTime: 0,
    playbackRate: 1,
    async play() { playCalls++; }
  };
  const engine = {
    sourceUrl: "blob:pcm-paused-fallback",
    currentTime: 4,
    paused: true,
    releaseForFallback() { this.released = true; }
  };
  const sandbox = {
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engine,
    mediaElement,
    currentRate: 1,
    filters: [],
    audioCtx: null,
    ensureGraph() {},
    setGraphInputNode() {},
    updatePitchShiftNode() {},
    sourceNode: {},
    console: { warn() {} },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(fallbackSource + "\nthis.runFallback = switchBufferedPlaybackToMediaElement;", sandbox);
  assert.equal(await sandbox.runFallback(new Error("paused fallback"), false), true);
  assert.equal(playCalls, 0);
  assert.equal(mediaElement.currentTime, 4);
  assert.equal(mediaElement.src, "blob:pcm-paused-fallback");
});


test("MediaElement fallback waits for delayed metadata before restoring seek and resuming", async () => {
  const start = audioSource.indexOf("async function switchBufferedPlaybackToMediaElement(");
  const end = audioSource.indexOf("\n  let outputTransitionPromise", start);
  assert.ok(start >= 0 && end > start, "audio.js fallback function must exist");
  const fallbackSource = audioSource.slice(start, end);

  let onMetadata = null;
  let playCalls = 0;
  const mediaElement = {
    readyState: 0,
    currentTime: 0,
    playbackRate: 1,
    src: "",
    async play() { playCalls++; },
    addEventListener(type, callback) { if (type === "loadedmetadata") onMetadata = callback; },
    removeEventListener(type, callback) { if (type === "loadedmetadata" && onMetadata === callback) onMetadata = null; }
  };
  const engine = {
    sourceUrl: "blob:pcm-delayed-metadata",
    currentTime: 18.25,
    paused: false,
    releaseForFallback() { this.released = true; this.paused = true; }
  };
  const sandbox = {
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engine,
    mediaElement,
    currentRate: 1.5,
    filters: [{}],
    audioCtx: null,
    ensureGraph() {},
    setGraphInputNode() {},
    updatePitchShiftNode() {},
    sourceNode: {},
    console: { warn() {} },
    setTimeout() { return 1; },
    clearTimeout() {}
  };

  vm.runInNewContext(fallbackSource + "\nthis.runFallback = switchBufferedPlaybackToMediaElement;", sandbox);
  const resultPromise = sandbox.runFallback(new Error("metadata delayed"), true);
  assert.equal(typeof onMetadata, "function");
  mediaElement.readyState = 1;
  onMetadata();

  assert.equal(await resultPromise, true);
  assert.equal(mediaElement.currentTime, 18.25);
  assert.equal(mediaElement.playbackRate, 1.5);
  assert.equal(playCalls, 1);
  assert.equal(onMetadata, null);
});

test("MediaElement fallback timeout stays paused and restores the saved seek when metadata arrives later", async () => {
  const start = audioSource.indexOf("async function switchBufferedPlaybackToMediaElement(");
  const end = audioSource.indexOf("\n  let outputTransitionPromise", start);
  assert.ok(start >= 0 && end > start, "audio.js fallback function must exist");
  const fallbackSource = audioSource.slice(start, end);

  let onMetadata = null;
  let playCalls = 0;
  const mediaElement = {
    readyState: 0,
    currentTime: 0,
    playbackRate: 1,
    src: "",
    async play() { playCalls++; },
    addEventListener(type, callback) { if (type === "loadedmetadata") onMetadata = callback; },
    removeEventListener(type, callback) { if (type === "loadedmetadata" && onMetadata === callback) onMetadata = null; }
  };
  const engine = {
    sourceUrl: "blob:pcm-metadata-timeout",
    currentTime: 31.75,
    paused: false,
    releaseForFallback() { this.released = true; this.paused = true; }
  };
  const sandbox = {
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engine,
    mediaElement,
    currentRate: 1,
    filters: [{}],
    audioCtx: null,
    ensureGraph() {},
    setGraphInputNode() {},
    updatePitchShiftNode() {},
    sourceNode: {},
    console: { warn() {} },
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    clearTimeout() {},
    queueMicrotask
  };

  vm.runInNewContext(fallbackSource + "\nthis.runFallback = switchBufferedPlaybackToMediaElement;", sandbox);
  assert.equal(await sandbox.runFallback(new Error("metadata timeout"), true), false);
  assert.equal(playCalls, 0);
  assert.equal(mediaElement.currentTime, 0);
  assert.equal(typeof onMetadata, "function");

  mediaElement.readyState = 1;
  onMetadata();
  assert.equal(mediaElement.currentTime, 31.75);
  assert.equal(onMetadata, null);
  assert.equal(playCalls, 0);
});


test("rapid PCM rate, pitch, and EQ updates keep only the newest handoff active", async () => {
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
  let timerId = 0;
  const { Engine, GraphInputOwnership } = createEngineClass(TrackingWorker, {
    audioCtx: context,
    state: appState,
    setGraphInputNode(node, target) { return ownership.set(node, target); },
    clearGraphInputNode(node, target) { return ownership.clear(node, target); },
    ensureGraph() {},
    async resumeAudioCtx() {},
    canUseBufferedPlayback() { return true; },
    mediaElement: { dispatchEvent() { return true; } },
    Event: class MockEvent { constructor(type) { this.type = type; } },
    setInterval() { return ++timerId; },
    clearInterval() {},
    setTimeout() { return ++timerId; },
    clearTimeout() {}
  });
  ownership = new GraphInputOwnership();
  const engine = new Engine();
  engine.sourceUrl = "blob:pcm-rapid-settings";
  engine.buffer = makeMonoBuffer(48000, 1);
  engine._readyState = 4;
  await engine.play();

  const settings = [
    { rate: 1.05, pitch: 1, eq: [1, 0, 0, 0, 0] },
    { rate: 1.1, pitch: 2, eq: [0, 1, 0, 0, 0] },
    { rate: 1.15, pitch: 3, eq: [0, 0, 1, 0, 0] },
    { rate: 1.2, pitch: 4, eq: [0, 0, 0, 1, 0] },
    { rate: 1.25, pitch: 5, eq: [0, 0, 0, 0, 1] }
  ];
  const pending = [];
  for (const setting of settings) {
    appState.eqState.gains = setting.eq.slice();
    appState.pitchSemitones = setting.pitch;
    engine.setPlaybackRate(setting.rate);
    pending.push(engine.updateProcessingSettings());
  }

  const results = await Promise.all(pending);
  assert.equal(results.filter(Boolean).length, 1);
  const latest = results[results.length - 1];
  assert.ok(latest && latest.session);
  assert.equal(engine.pcmOutputController.activeSession, latest.session);
  assert.equal(latest.session.scheduler.playbackRate, 1.25);
  assert.equal(engine.pcmOutputController.state, "running");

  const latestInit = workers
    .flatMap(worker => worker.messages.filter(message => message.type === "init"))
    .filter(message =>
      JSON.stringify(message.eqGains) === JSON.stringify([0, 0, 0, 0, 1]) &&
      Math.abs(message.pitch - Math.pow(2, 5 / 12) / 1.25) < 1e-10
    );
  assert.ok(latestInit.length >= 1, "latest Worker must receive the newest EQ and compensated pitch");
  assert.ok(workers.length >= settings.length + 1);

  engine.pause();
  engine.releaseForFallback();
  assert.equal(engine.pcmOutputController, null);
  assert.equal(ownership.activeNode, null);
  assert.equal(workers.every(worker => worker.terminated), true);
});

test("repeated EQ scheduling debounces to one PCM settings handoff", async () => {
  const timers = [];
  const cleared = [];
  let nextTimerId = 0;
  const { Engine } = createEngineClass(MockWorker, {
    setTimeout(callback, delay) {
      const timer = { id: ++nextTimerId, callback, delay };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) { cleared.push(id); }
  });
  const engine = new Engine();
  engine.buffer = makeMonoBuffer(48000, 1);
  engine.paused = false;
  engine.playRequested = true;
  let updateCount = 0;
  engine.updateProcessingSettings = async () => {
    updateCount++;
    return true;
  };

  assert.equal(engine.scheduleProcessingSettingsUpdate(120), true);
  assert.equal(engine.scheduleProcessingSettingsUpdate(120), true);
  assert.equal(engine.scheduleProcessingSettingsUpdate(120), true);
  assert.equal(timers.length, 3);
  assert.deepEqual(cleared, [1, 2]);
  assert.equal(engine.pcmSettingsTimer, 3);

  timers[2].callback();
  await Promise.resolve();
  assert.equal(updateCount, 1);
  assert.equal(engine.pcmSettingsTimer, null);
});


test("PCM settings changed during initial startup are deferred without cancelling the startup queue", async () => {
  const cancelCalls = [];
  const invalidateStart = audioSource.indexOf("function invalidateBufferedPcmProcessing()");
  const invalidateEnd = audioSource.indexOf("\n  function applyPitchAndRate", invalidateStart);
  assert.ok(invalidateStart >= 0 && invalidateEnd > invalidateStart,
    "PCM invalidation helper must exist");
  const invalidateSource = audioSource.slice(invalidateStart, invalidateEnd);
  const engineStub = {
    playRequested: true,
    cancelProcessedPcmQueue() { cancelCalls.push("cancel"); }
  };
  const audioSandbox = {
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engineStub,
    audio: { paused: true }
  };
  vm.runInNewContext(invalidateSource + "\nthis.invalidateBufferedPcmProcessing = invalidateBufferedPcmProcessing;", audioSandbox);
  audioSandbox.invalidateBufferedPcmProcessing();
  assert.deepEqual(cancelCalls, [], "startup queue must remain alive while play is requested");
  engineStub.playRequested = false;
  audioSandbox.invalidateBufferedPcmProcessing();
  assert.deepEqual(cancelCalls, ["cancel"], "idle paused queue may still be invalidated");

  const { Engine } = createEngineClass(MockWorker, {
    canUseBufferedPlayback: () => true,
    ensureGraph() {},
    resumeAudioCtx: async () => {}
  });
  const engine = new Engine();
  engine.sourceUrl = "blob:startup-settings-test";
  engine.buffer = makeMonoBuffer(48000, 1);
  engine.paused = true;
  engine.playRequested = true;

  assert.equal(await engine.updateProcessingSettings(), false);
  assert.equal(engine.pendingProcessingSettingsUpdate, true);
  assert.equal(engine.scheduleProcessingSettingsUpdate(), true);
  assert.equal(engine.pendingProcessingSettingsUpdate, true);

  const originalUpdate = engine.updateProcessingSettings.bind(engine);
  let postStartupHandoffs = 0;
  engine.updateProcessingSettings = async () => {
    postStartupHandoffs++;
    return true;
  };
  engine.prepare = async () => engine.buffer;
  engine.startPcmSession = async () => {
    await originalUpdate();
    return { started: true };
  };
  engine.startTimeUpdates = () => {};
  engine.dispatch = () => {};

  await engine.play();
  assert.equal(engine.paused, false);
  assert.equal(engine.pendingProcessingSettingsUpdate, false);
  assert.equal(postStartupHandoffs, 1,
    "latest settings must be handed off after the initial PCM session starts");
});

test("2D spatial mode selects the direct stereo route and disables the 3D branch", () => {
  const start = audioSource.indexOf("function updateSpatialAudioRouting()");
  const end = audioSource.indexOf("\n  function setDMode", start);
  assert.ok(start >= 0 && end > start, "spatial routing function must exist");
  const routingSource = audioSource.slice(start, end);
  const makeParam = () => ({
    calls: [],
    cancelScheduledValues(time) { this.calls.push(["cancel", time]); },
    setTargetAtTime(value, time, constant) { this.calls.push(["target", value, time, constant]); }
  });
  const directGain = makeParam();
  const spatialGain = makeParam();
  const sandbox = {
    state: { dMode: "2D" },
    audioCtx: { currentTime: 3.5 },
    panner3DNode: {},
    spatialDirectGainNode: { gain: directGain },
    spatial3DGainNode: { gain: spatialGain }
  };
  vm.runInNewContext(routingSource + "\nthis.updateSpatialAudioRouting = updateSpatialAudioRouting;", sandbox);

  sandbox.updateSpatialAudioRouting();
  assert.deepEqual(directGain.calls[1], ["target", 1, 3.5, 0.02]);
  assert.deepEqual(spatialGain.calls[1], ["target", 0, 3.5, 0.02]);

  sandbox.state.dMode = "3D";
  sandbox.updateSpatialAudioRouting();
  assert.deepEqual(directGain.calls[3], ["target", 0, 3.5, 0.02]);
  assert.deepEqual(spatialGain.calls[3], ["target", 1, 3.5, 0.02]);
});

test("PCM insertion boundary traverses the shared stereo output and optional clipping limiter", () => {
  const orderedMarkers = [
    "audioCtx._musicPlayerPostDspInputNode = pitchRouteNode;",
    "spatialDirectGainNode.connect(channelNormalizeNode);",
    "channelNormalizeNode.connect(trackLoudnessAnalyser);",
    "trackLoudnessAnalyser.connect(trackLoudnessGainNode);",
    "trackLoudnessGainNode.connect(masterGain);",
    "masterGain.connect(finalMixGainNode);",
    "finalMixGainNode.connect(outputLevelGainNode);",
    "outputLevelGainNode.connect(loudnessCompressorNode);",
    "loudnessCompressorNode.connect(loudnessMakeupGainNode);",
    "loudnessMakeupGainNode.connect(speakerBusNode);",
    "speakerBusNode.connect(channelSplitter);",
    "leftGainNode.connect(channelMerger, 0, 0);",
    "rightGainNode.connect(channelMerger, 0, 1);",
    "channelMerger.connect(limiterNode);",
    "limiterNode.connect(analyser);"
  ];
  const positions = orderedMarkers.map(marker => audioSource.indexOf(marker));
  assert.ok(positions.every(position => position >= 0), "all shared output stages must exist");
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], "PCM audio must traverse the shared output stages in order");
  }
  assert.match(audioSource, /if \(state\.clippingProtection\)\s*\{\s*channelMerger\.connect\(limiterNode\)/);
});

test("clipping protection toggles the main output through the limiter without disturbing additional speaker routing", () => {
  const start = outputSource.indexOf("function setClippingProtection(");
  const end = outputSource.indexOf("\n  if (el.btnClippingProtection)", start);
  assert.ok(start >= 0 && end > start, "clipping protection function must exist");
  const functionSource = outputSource.slice(start, end);

  const makeNode = name => ({
    name,
    connections: new Set(),
    connect(target) { this.connections.add(target); },
    disconnect(target) {
      if (target) this.connections.delete(target);
      else this.connections.clear();
    }
  });
  const channelMerger = makeNode("channelMerger");
  const limiterNode = makeNode("limiterNode");
  const outputSplitter = makeNode("outputSplitter");
  const analyser = makeNode("analyser");
  const speakerBusNode = makeNode("speakerBusNode");
  const additionalSplitter = makeNode("additionalSplitter");
  const finalMixGainNode = makeNode("finalMixGainNode");
  speakerBusNode.connect(additionalSplitter);

  let saveCount = 0;
  const ui = {
    textContent: "",
    active: null,
    classList: { toggle(name, value) { if (name === "active") ui.active = value; } }
  };
  const sandbox = {
    state: { clippingProtection: false },
    saveState() { saveCount++; },
    resetTrackLoudnessNormalization() {},
    audioCtx: {},
    channelMerger,
    limiterNode,
    outputSplitter,
    analyser,
    speakerBusNode,
    finalMixGainNode,
    el: { btnClippingProtection: ui },
    console: { error() {} }
  };
  vm.runInNewContext(functionSource + "\nthis.setClippingProtection = setClippingProtection;", sandbox);

  sandbox.setClippingProtection(true);
  assert.equal(channelMerger.connections.has(limiterNode), true);
  assert.equal(channelMerger.connections.has(outputSplitter), false);
  assert.equal(limiterNode.connections.has(outputSplitter), true);
  assert.equal(limiterNode.connections.has(analyser), true);
  assert.equal(ui.textContent, "音割れ防止: ON");
  assert.equal(ui.active, true);

  sandbox.setClippingProtection(false);
  assert.equal(channelMerger.connections.has(limiterNode), false);
  assert.equal(channelMerger.connections.has(outputSplitter), true);
  assert.equal(channelMerger.connections.has(analyser), true);
  assert.equal(limiterNode.connections.has(outputSplitter), false);
  assert.equal(limiterNode.connections.has(analyser), false);
  assert.equal(ui.textContent, "音割れ防止: OFF");
  assert.equal(ui.active, false);

  sandbox.setClippingProtection(true);
  sandbox.setClippingProtection(true);
  assert.equal(channelMerger.connections.has(limiterNode), true);
  assert.equal(channelMerger.connections.size, 1);
  assert.equal(speakerBusNode.connections.has(additionalSplitter), true);
  assert.equal(limiterNode.connections.has(speakerBusNode), false);
  assert.equal(saveCount, 4);
});


test("audio proxy does not start MediaElement playback when fallback cannot restore the saved position", async () => {
  const start = stateSource.indexOf("const audio = new Proxy(mediaElement, {");
  const end = stateSource.indexOf("\n  });", start) + 6;
  assert.ok(start >= 0 && end > start, "audio compatibility proxy must exist");
  const proxySource = stateSource.slice(start, end);

  let nativePlayCalls = 0;
  let fallbackCalls = 0;
  let fallbackReady = false;
  let canUsePcm = true;
  const mediaElement = {
    async play() { nativePlayCalls++; return "native-played"; },
    pause() {},
    removeAttribute() {},
    load() {}
  };
  const engine = {
    async play() { throw new Error("simulated PCM startup failure"); }
  };
  const sandbox = {
    mediaElement,
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: engine,
    canUseBufferedPlayback() { return canUsePcm; },
    async switchBufferedPlaybackToMediaElement() {
      fallbackCalls++;
      return fallbackReady;
    },
    state: { currentSong: { mediaType: "audio" } },
    setGraphInputNode() {},
    sourceNode: {},
    filters: [{}]
  };
  vm.runInNewContext(proxySource + "\nthis.audio = audio;", sandbox);

  await assert.rejects(
    () => sandbox.audio.play(),
    /フォールバックの再生位置を復元できなかったため/
  );
  assert.equal(nativePlayCalls, 0);
  assert.equal(fallbackCalls, 1);

  canUsePcm = false;
  await assert.rejects(
    () => sandbox.audio.play(),
    /フォールバックの再生位置を復元できなかったため/
  );
  assert.equal(nativePlayCalls, 0);
  assert.equal(fallbackCalls, 2);

  fallbackReady = true;
  assert.equal(await sandbox.audio.play(), "native-played");
  assert.equal(nativePlayCalls, 1);
  assert.equal(fallbackCalls, 3);
});


test("audio proxy routes local audio to PCM while local video and YouTube stay on the native media element", () => {
  const start = stateSource.indexOf("const audio = new Proxy(mediaElement, {");
  const end = stateSource.indexOf("\n  });", start) + 6;
  assert.ok(start >= 0 && end > start, "audio compatibility proxy must exist");
  const proxySource = stateSource.slice(start, end);

  const createHarness = mediaType => {
    const mediaElement = {
      src: "",
      removedAttributes: [],
      loadCalls: 0,
      removeAttribute(name) {
        this.removedAttributes.push(name);
        if (name === "src") this.src = "";
      },
      load() { this.loadCalls++; }
    };
    const engine = {
      sourceUrl: "",
      clearCalls: 0,
      setSource(url) { this.sourceUrl = url; },
      clear() { this.clearCalls++; this.sourceUrl = ""; }
    };
    const graphCalls = [];
    const sandbox = {
      mediaElement,
      bufferedPlaybackMode: false,
      bufferedPlaybackEngine: engine,
      state: { currentSong: { mediaType } },
      setGraphInputNode(...args) { graphCalls.push(args); },
      sourceNode: { id: "native-source" },
      filters: [{ id: "eq" }]
    };
    vm.runInNewContext(proxySource + "\nthis.audio = audio;", sandbox);
    return { sandbox, mediaElement, engine, graphCalls };
  };

  const localAudio = createHarness("audio");
  localAudio.sandbox.audio.src = "blob:local-audio";
  assert.equal(localAudio.sandbox.bufferedPlaybackMode, true);
  assert.equal(localAudio.sandbox.audio.src, "blob:local-audio");
  assert.equal(localAudio.engine.sourceUrl, "blob:local-audio");
  assert.deepEqual(localAudio.mediaElement.removedAttributes, ["src"]);
  assert.equal(localAudio.mediaElement.loadCalls, 1);
  assert.equal(localAudio.graphCalls[0][0], null);

  const localVideo = createHarness("video");
  localVideo.sandbox.audio.src = "blob:local-video";
  assert.equal(localVideo.sandbox.bufferedPlaybackMode, false);
  assert.equal(localVideo.sandbox.audio.src, "blob:local-video");
  assert.equal(localVideo.mediaElement.src, "blob:local-video");
  assert.equal(localVideo.engine.clearCalls, 1);
  assert.equal(localVideo.graphCalls[0][0], localVideo.sandbox.sourceNode);
  assert.equal(localVideo.graphCalls[0][1], localVideo.sandbox.filters[0]);

  const youtube = createHarness("youtube");
  youtube.sandbox.audio.src = "";
  assert.equal(youtube.sandbox.bufferedPlaybackMode, false);
  assert.equal(youtube.sandbox.audio.src, "");
  assert.equal(youtube.engine.clearCalls, 1);
  assert.equal(youtube.graphCalls[0][0], youtube.sandbox.sourceNode);
  assert.equal(youtube.graphCalls[0][1], youtube.sandbox.filters[0]);
});


test("3D mode uses HRTF positioning and follows the pan setting", () => {
  const start = audioSource.indexOf("function updateSpatialAudio(dt)");
  const end = audioSource.indexOf("\n  function updateSpatialAudioRouting", start);
  assert.ok(start >= 0 && end > start, "spatial position update function must exist");
  const positionSource = audioSource.slice(start, end);
  const panner = { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } };
  const sandbox = {
    audioCtx: {}, panner3DNode: panner, audio: { paused: false },
    state: { dMode: "3D", panValue: 0.25 }, spatialAngle: 0
  };
  vm.runInNewContext(positionSource + "\nthis.updateSpatialAudio = updateSpatialAudio;", sandbox);
  sandbox.updateSpatialAudio(1);
  assert.equal(panner.positionX.value, 0.45);
  assert.equal(panner.positionY.value, 0);
  assert.equal(panner.positionZ.value, -1.5);
  assert.match(audioSource, /panner3DNode\.panningModel\s*=\s*['"]HRTF['"]/);
  assert.doesNotMatch(positionSource, /case ["']BINAURAL["']/);
});

test("legacy BINAURAL spatial mode is migrated to 3D on load", () => {
  const start = stateSource.indexOf("function loadSpatialMode()");
  const end = stateSource.indexOf("\n  const state =", start);
  assert.ok(start >= 0 && end > start, "spatial mode migration helper must exist");
  const helperSource = stateSource.slice(start, end);
  let savedMode = "BINAURAL";
  const sandbox = {
    STORAGE: { dMode: "stored-spatial-mode" },
    loadStr(key, fallback) { return savedMode === undefined ? fallback : savedMode; }
  };
  vm.runInNewContext(helperSource + "\nthis.loadSpatialMode = loadSpatialMode;", sandbox);
  assert.equal(sandbox.loadSpatialMode(), "3D");
  savedMode = "4D";
  assert.equal(sandbox.loadSpatialMode(), "4D");
  savedMode = undefined;
  assert.equal(sandbox.loadSpatialMode(), "3D");
});


test("4D, 8D, and 16D spatial modes update HRTF position from elapsed time", () => {
  const start = audioSource.indexOf("function updateSpatialAudio(dt)");
  const end = audioSource.indexOf("\n  function updateSpatialAudioRouting", start);
  assert.ok(start >= 0 && end > start, "spatial position update function must exist");
  const positionSource = audioSource.slice(start, end);
  const initialAngle = 0.37;
  const deltaSeconds = 0.24;
  const t = initialAngle + 1.5 * deltaSeconds;
  const cases = [
    {
      mode: "4D",
      expected: [
        Math.sin(t * 0.55) * 2.5,
        Math.sin(t * 1.1) * 1.35,
        Math.cos(t * 0.55) * 2.0
      ]
    },
    {
      mode: "8D",
      expected: [Math.sin(t * 0.95) * 2.6, 0, Math.cos(t * 0.95) * 2.6]
    },
    {
      mode: "16D",
      expected: [
        Math.sin(t * 0.72) * 2.45,
        (Math.sin(t * 0.72 * 1.618) + 0.35 * Math.sin(t * 0.72 * 0.5)) * 1.05,
        Math.cos(t * 0.72 * 0.7071) * 2.45
      ]
    }
  ];

  for (const item of cases) {
    const panner = {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 }
    };
    const sandbox = {
      audioCtx: {},
      panner3DNode: panner,
      audio: { paused: false },
      state: { dMode: item.mode, panValue: 0 },
      spatialAngle: initialAngle
    };
    vm.runInNewContext(positionSource + "\nthis.updateSpatialAudio = updateSpatialAudio;", sandbox);
    sandbox.updateSpatialAudio(deltaSeconds);
    const actual = [panner.positionX.value, panner.positionY.value, panner.positionZ.value];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        Math.abs(actual[axis] - item.expected[axis]) < 1e-12,
        `${item.mode} axis ${axis} expected ${item.expected[axis]}, got ${actual[axis]}`
      );
    }
    assert.equal(sandbox.spatialAngle, t);
  }
});


test("spatial audio rotation uses AudioContext time rather than visualizer frame time", () => {
  const start = uiSource.indexOf("function updateSpatialAudioFromClock(isPlaying)");
  const end = uiSource.indexOf("\n  function drawWave()", start);
  assert.ok(start >= 0 && end > start, "AudioContext-clock spatial update helper must exist");
  const helperSource = uiSource.slice(start, end);
  const calls = [];
  const sandbox = {
    audioCtx: { currentTime: 10 },
    drawWave: {},
    updateSpatialAudio(dt) { calls.push(dt); }
  };
  vm.runInNewContext(helperSource + "\nthis.updateSpatialAudioFromClock = updateSpatialAudioFromClock;", sandbox);

  sandbox.updateSpatialAudioFromClock(true);
  sandbox.audioCtx.currentTime = 10.05;
  sandbox.updateSpatialAudioFromClock(true);
  sandbox.audioCtx.currentTime = 10.10;
  sandbox.updateSpatialAudioFromClock(true);
  sandbox.audioCtx.currentTime = 15.10;
  sandbox.updateSpatialAudioFromClock(false);
  sandbox.audioCtx.currentTime = 15.15;
  sandbox.updateSpatialAudioFromClock(true);

  const expected = [0, 0.05, 0.05, 0, 0.05];
  assert.equal(calls.length, expected.length);
  calls.forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-9,
      `spatial delta ${index} expected ${expected[index]}, got ${value}`);
  });
});

test("spatial audio updates before visualizer canvas checks and restarts after page visibility returns", () => {
  const drawStart = uiSource.indexOf("function drawWave()");
  const drawEnd = uiSource.indexOf("\n  function startWaveAnimation", drawStart);
  assert.ok(drawStart >= 0 && drawEnd > drawStart, "drawWave function must exist");
  const drawSource = uiSource.slice(drawStart, drawEnd);
  const spatialUpdate = drawSource.indexOf("updateSpatialAudioFromClock(isPlaying)");
  const missingCanvas = drawSource.indexOf("if (!el.wave) return;");
  const zeroCanvas = drawSource.indexOf("if (!width || !height)");
  assert.ok(spatialUpdate >= 0 && missingCanvas > spatialUpdate && zeroCanvas > spatialUpdate,
    "spatial updates must not depend on a visible, non-zero canvas");
  assert.match(drawSource, /if \(lowPerformance\)[\s\S]*?return;[\s\S]*?updateSpatialAudioFromClock\(isPlaying\)/,
    "low-performance frame throttling must occur before the clock-based update, not shorten its elapsed time");
  assert.match(uiSource, /document\.addEventListener\("visibilitychange",\s*\(\)\s*=>\s*\{\s*if \(document\.visibilityState !== "visible"\) isWaveAnimating = false;/);
  assert.match(audioSource, /document\.visibilityState === "visible" && !audio\.paused\)\s*\{\s*lastFrameTime = performance\.now\(\);\s*startWaveAnimation\(\);/);
  assert.match(uiSource, /drawWave\._lastSpatialAudioTime = audioCtx\?\.currentTime/);
});


test("spatial mode changes preserve the rotation phase and restore direct stereo in 2D", () => {
  const start = audioSource.indexOf("function setDMode(mode)");
  const end = audioSource.indexOf("\n  if (el.dModeBtns)", start);
  assert.ok(start >= 0 && end > start, "spatial mode setter must exist");
  const setterSource = audioSource.slice(start, end);
  const panner = {
    positionX: { value: 1 },
    positionY: { value: 2 },
    positionZ: { value: 3 }
  };
  const buttons = ["2D", "3D", "4D", "8D", "16D"].map(mode => ({
    dataset: { d: mode },
    classList: { active: false, toggle(name, value) { if (name === "active") this.active = value; } }
  }));
  let saveCount = 0;
  let routeUpdates = 0;
  const sandbox = {
    state: { dMode: "3D", panValue: 0.25 },
    spatialAngle: 12.345,
    panner3DNode: panner,
    saveState() { saveCount++; },
    updateSpatialAudioRouting() { routeUpdates++; },
    el: {
      dModeDesc: { textContent: "" },
      dModeBtns: { querySelectorAll() { return buttons; } }
    }
  };
  vm.runInNewContext(setterSource + "\nthis.setDMode = setDMode;", sandbox);

  for (const mode of ["4D", "8D", "16D", "3D", "2D"]) {
    sandbox.setDMode(mode);
    assert.equal(sandbox.state.dMode, mode);
    assert.equal(sandbox.spatialAngle, 12.345);
    assert.equal(buttons.find(button => button.dataset.d === mode).classList.active, true);
  }
  sandbox.setDMode("BINAURAL");
  assert.equal(sandbox.state.dMode, "3D");
  assert.equal(buttons.find(button => button.dataset.d === "3D").classList.active, true);

  assert.deepEqual(
    [panner.positionX.value, panner.positionY.value, panner.positionZ.value],
    [0, 0, 0]
  );
  assert.equal(saveCount, 6);
  assert.equal(routeUpdates, 6);
  assert.match(sandbox.el.dModeDesc.textContent, /HRTF方式/);
});


test("seek during pending PCM startup restarts from the requested frame", async () => {
  const { Engine } = createEngineClass();
  const engine = new Engine();
  engine.sourceUrl = "blob:pcm-seek-during-startup";
  engine.buffer = makeMonoBuffer(48000, 2);
  engine.paused = true;
  engine.playRequested = true;
  engine.pcmSampleRate = 48000;
  engine.startTimeUpdates = () => {};
  engine.stopTimeUpdates = () => {};
  let startedFrame = null;
  engine.startPcmSession = async frame => {
    startedFrame = frame;
    return { started: true };
  };

  const result = await engine.seek(0.75);
  assert.equal(result, true);
  assert.equal(startedFrame, 36000);
  assert.equal(engine.paused, false);
  assert.equal(engine.playRequested, true);
});

test("unsupported settings during pending playback startup preserve the play request on native fallback", async () => {
  const start = audioSource.indexOf("function applyPitchAndRate()");
  const end = audioSource.indexOf("\n  // --- 経過時間", start);
  assert.ok(start >= 0 && end > start, "audio.js applyPitchAndRate function must exist");
  const functionSource = audioSource.slice(start, end);
  let fallbackResume = null;
  const sandbox = {
    invalidateBufferedPcmProcessing() {},
    ensureGraph() {},
    bufferedPlaybackMode: true,
    bufferedPlaybackEngine: {
      playRequested: true,
      updateProcessingSettings() { return Promise.resolve(true); }
    },
    canUseBufferedPlayback: () => false,
    switchBufferedPlaybackToMediaElement(error, resume) {
      fallbackResume = resume;
      return Promise.resolve(true);
    },
    audio: { paused: true },
    currentRate: 1.5,
    state: { pitchSemitones: 12 },
    el: { rateText: { textContent: "" }, pitchText: { textContent: "" } },
    updateMediaSessionPosition() {}
  };
  vm.runInNewContext(functionSource + "\nthis.applyPitchAndRate = applyPitchAndRate;", sandbox);
  sandbox.applyPitchAndRate();
  assert.equal(fallbackResume, true);
});


test("multiple speaker output is opt-in and defaults to OFF", () => {
  const start = outputSource.indexOf("function isMultipleOutputEnabled()");
  const end = outputSource.indexOf("\n  }", start) + 4;
  assert.ok(start >= 0 && end > start, "multiple-output preference helper must exist");
  const helperSource = outputSource.slice(start, end);
  const sandbox = { state: { speakerSettings: {} } };
  vm.runInNewContext(helperSource + "\nthis.isMultipleOutputEnabled = isMultipleOutputEnabled;", sandbox);
  assert.equal(sandbox.isMultipleOutputEnabled(), false);
  sandbox.state.speakerSettings.multipleOutputEnabled = false;
  assert.equal(sandbox.isMultipleOutputEnabled(), false);
  sandbox.state.speakerSettings.multipleOutputEnabled = true;
  assert.equal(sandbox.isMultipleOutputEnabled(), true);
  assert.match(stateSource, /multipleOutputEnabled:\s*false/);
  assert.match(stateSource, /state\.speakerSettings\.multipleOutputEnabled !== true[\s\S]*?state\.mainOutputDeviceId = ""/);
  assert.doesNotMatch(stateSource, /state\.speakerSettings\.outputRoutingBlocked = false/);
  assert.match(outputSource, /if \(routingBlocked\) \{[\s\S]*?stopAllAdditionalOutputRuntimes\(\)/);
  assert.match(outputSource, /const isMain = state\.speakerSettings\?\.outputRoutingBlocked !== true/);
  assert.match(indexSource, /id="multipleOutputToggle"[^>]*>複数出力：OFF/);
  assert.ok(outputSource.includes('const normalized = isMultipleOutputEnabled() ? requestedId : ""'));
  assert.match(outputSource, /複数出力ONで使用/);
});

test("OS default output resolves to the named physical speaker without an ambiguous label match", () => {
  const start = outputSource.indexOf("  let latestEnumeratedOutputDevices = [];");
  const end = outputSource.indexOf("\n  let recentlyGrantedOutputDevice", start);
  assert.ok(start >= 0 && end > start, "default-output identity helpers must exist");
  const helperSource = outputSource.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(helperSource + "\nthis.getDefaultPhysicalOutput = getDefaultPhysicalOutput; this.getDefaultOutputLabel = getDefaultOutputLabel; this.isDefaultOutputDevice = isDefaultOutputDevice; this.getNewlyConnectedOutputDevice = getNewlyConnectedOutputDevice;", sandbox);
  const outputs = [
    { kind: "audiooutput", deviceId: "default", label: "Default - Speaker", groupId: "internal-speaker" },
    { kind: "audiooutput", deviceId: "speaker-1", label: "Speaker", groupId: "internal-speaker" },
    { kind: "audiooutput", deviceId: "headphones-1", label: "Bluetooth Headphones", groupId: "headphones" }
  ];
  assert.equal(sandbox.getDefaultPhysicalOutput(outputs).deviceId, "speaker-1");
  assert.equal(sandbox.getDefaultOutputLabel(outputs), "Speaker");
  assert.equal(sandbox.isDefaultOutputDevice(outputs[1], outputs), true);
  assert.equal(sandbox.getNewlyConnectedOutputDevice(outputs, new Set(["speaker-1"])).deviceId, "headphones-1");
  const ambiguous = [
    { kind: "audiooutput", deviceId: "default", label: "Default - Speaker", groupId: "" },
    { kind: "audiooutput", deviceId: "speaker-a", label: "Speaker", groupId: "" },
    { kind: "audiooutput", deviceId: "speaker-b", label: "Speaker", groupId: "" }
  ];
  assert.equal(sandbox.getDefaultPhysicalOutput(ambiguous), null);
  assert.equal(sandbox.getDefaultOutputLabel(ambiguous), "Speaker");
});

test("newly connected output selection prefers the new OS-default physical device", () => {
  const start = outputSource.indexOf("  let latestEnumeratedOutputDevices = [];");
  const end = outputSource.indexOf("\n  let recentlyGrantedOutputDevice", start);
  const helperSource = outputSource.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(helperSource + "\nthis.getNewlyConnectedOutputDevice = getNewlyConnectedOutputDevice;", sandbox);
  const outputs = [
    { kind: "audiooutput", deviceId: "default", label: "Default - USB Speaker", groupId: "usb-speaker" },
    { kind: "audiooutput", deviceId: "old", label: "Old Speaker", groupId: "old" },
    { kind: "audiooutput", deviceId: "usb", label: "USB Speaker", groupId: "usb-speaker" },
    { kind: "audiooutput", deviceId: "new-headphones", label: "Headphones", groupId: "new-headphones" }
  ];
  assert.equal(sandbox.getNewlyConnectedOutputDevice(outputs, new Set(["old"])).deviceId, "usb");
});

test("additional output runtime synchronization is fail-closed while multiple output is OFF", async () => {
  const start = outputSource.indexOf("  async function syncAdditionalOutputRuntimes()");
  const end = outputSource.indexOf("\n  async function startOutputBridge", start);
  assert.ok(start >= 0 && end > start, "additional-output sync function must exist");
  const functionSource = outputSource.slice(start, end);
  let stopped = 0;
  let created = 0;
  const sandbox = {
    audioCtx: {}, analyser: {},
    state: { speakerSettings: { multipleOutputEnabled: false }, outputRoutes: [{ deviceId: "extra", enabled: true }] },
    isMultipleOutputEnabled: () => false,
    stopAllAdditionalOutputRuntimes() { stopped++; },
    createAdditionalOutputRuntime() { created++; }
  };
  vm.runInNewContext(functionSource + "\nthis.syncAdditionalOutputRuntimes = syncAdditionalOutputRuntimes;", sandbox);
  await sandbox.syncAdditionalOutputRuntimes();
  assert.equal(stopped, 1);
  assert.equal(created, 0);
});

test("automatic new-speaker switch disables all saved additional routes and selects only the new output", async () => {
  const start = outputSource.indexOf("  async function switchToExclusiveOutputDevice");
  const end = outputSource.indexOf("\n  function syncExternalOutputSafety", start);
  assert.ok(start >= 0 && end > start, "exclusive output switch helper must exist");
  const functionSource = outputSource.slice(start, end);
  const routes = [{ deviceId: "old-main", enabled: true }, { deviceId: "old-extra", enabled: true }];
  let selectedId = null, failClosed = false, saved = 0, stopped = 0, synced = 0;
  const sandbox = {
    state: { speakerSettings: { multipleOutputEnabled: true }, outputRoutes: routes },
    isMultipleOutputEnabled: () => true,
    isDefaultOutputDevice: () => false,
    saveState() { saved++; },
    async setMainOutputDevice(id, options) { selectedId = id; failClosed = options.failClosed; return true; },
    stopAllAdditionalOutputRuntimes() { stopped++; },
    async syncAdditionalOutputRuntimes() { synced++; },
    renderAdditionalOutputSpeakers() {}
  };
  vm.runInNewContext(functionSource + "\nthis.switchToExclusiveOutputDevice = switchToExclusiveOutputDevice;", sandbox);
  assert.equal(await sandbox.switchToExclusiveOutputDevice({ deviceId: "new-speaker" }, []), true);
  assert.equal(selectedId, "new-speaker");
  assert.equal(failClosed, true);
  assert.deepEqual(routes.map(route => route.enabled), [false, false]);
  assert.equal(stopped, 1);
  assert.equal(synced, 1);
  assert.equal(saved, 2);
});

test("routing failure mutes the main sink and bridge and persists a blocked state", () => {
  const start = outputSource.indexOf("  function muteAllAppOutputsForRoutingFailure");
  const end = outputSource.indexOf("\n  async function switchToExclusiveOutputDevice", start);
  assert.ok(start >= 0 && end > start, "routing failure mute helper must exist");
  const functionSource = outputSource.slice(start, end);
  let saved = 0, stopped = 0;
  const directGain = { value: 1, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; } };
  const bridge = { volume: 1, paused: false, pause() { this.paused = true; } };
  const sandbox = {
    state: { speakerSettings: { multipleOutputEnabled: true }, mainOutputDeviceId: "old" },
    mainOutputDirectGainNode: { gain: directGain }, audioCtx: { currentTime: 1 }, outputBridgeAudio: bridge,
    syncExternalOutputSafety() {},
    stopAllAdditionalOutputRuntimes() { stopped++; }, saveState() { saved++; }
  };
  vm.runInNewContext(functionSource + "\nthis.muteAllAppOutputsForRoutingFailure = muteAllAppOutputsForRoutingFailure;", sandbox);
  sandbox.muteAllAppOutputsForRoutingFailure("new-speaker");
  assert.equal(sandbox.state.speakerSettings.outputRoutingBlocked, true);
  assert.equal(sandbox.state.mainOutputDeviceId, "new-speaker");
  assert.equal(directGain.value, 0);
  assert.equal(bridge.volume, 0);
  assert.equal(bridge.paused, true);
  assert.equal(stopped, 1);
  assert.equal(saved, 1);
});


test("a disconnected selected main output is detected and remains fail-closed until explicit reselection", () => {
  const start = outputSource.indexOf("  function getDisconnectedSelectedMainOutputId(");
  const end = outputSource.indexOf("\n  let lastSystemDefaultOutputDeviceId", start);
  assert.ok(start >= 0 && end > start, "selected-output disconnect detector must exist");
  const functionSource = outputSource.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(functionSource + "\nthis.getDisconnectedSelectedMainOutputId = getDisconnectedSelectedMainOutputId;", sandbox);
  const previouslyKnown = new Set(["bluetooth-headset", "wired-speaker"]);
  const afterDisconnect = [
    { kind: "audiooutput", deviceId: "default" },
    { kind: "audiooutput", deviceId: "wired-speaker" }
  ];
  assert.equal(
    sandbox.getDisconnectedSelectedMainOutputId(afterDisconnect, previouslyKnown, "bluetooth-headset", true),
    "bluetooth-headset"
  );
  assert.equal(
    sandbox.getDisconnectedSelectedMainOutputId(afterDisconnect, previouslyKnown, "wired-speaker", true),
    ""
  );
  assert.equal(
    sandbox.getDisconnectedSelectedMainOutputId(afterDisconnect, previouslyKnown, "new-device", true),
    ""
  );
  assert.equal(
    sandbox.getDisconnectedSelectedMainOutputId(afterDisconnect, previouslyKnown, "bluetooth-headset", false),
    ""
  );
  assert.equal(
    sandbox.getDisconnectedSelectedMainOutputId(afterDisconnect, previouslyKnown, "default", true),
    ""
  );
  assert.match(outputSource, /if \(disconnectedSelectedMainOutputId \|\| defaultChanged\) \{[\s\S]*?muteAllAppOutputsForRoutingFailure\(disconnectedSelectedMainOutputId \|\| selectedMainOutputIdBeforeChange\)/);
  assert.match(outputSource, /const preemptiveFailClosed = !wasBlockedBeforeChange/);
  assert.match(outputSource, /if \(disconnectedSelectedMainOutputId \|\| defaultChanged\)/);
  // Default-route changes must remain blocked until an explicit output selection.
  assert.match(outputSource, /lastSystemDefaultOutputDevice = defaultPhysical/);
  assert.match(audioSource, /document\.visibilityState === "visible" && pendingOutputDeviceRefresh[\s\S]*?dispatchEvent\?\.\(new Event\("devicechange"\)\)/);
});


test("multi-output ON suppresses a saved route that aliases the current main speaker", async () => {
  const start = outputSource.indexOf("  async function syncAdditionalOutputRuntimes()");
  const end = outputSource.indexOf("\n  async function startOutputBridge", start);
  const functionSource = outputSource.slice(start, end);
  const route = { deviceId: "speaker-alias", enabled: true };
  let saved = 0, disconnected = 0, created = 0;
  const sandbox = {
    audioCtx: {}, analyser: {},
    state: { speakerSettings: { multipleOutputEnabled: true, outputRoutingBlocked: false }, outputRoutes: [route] },
    isMultipleOutputEnabled: () => true,
    async enumerateAudioOutputs() { return [{ kind: "audiooutput", deviceId: "default" }, { kind: "audiooutput", deviceId: "speaker-alias" }]; },
    isCurrentMainOutputDevice: () => true,
    saveState() { saved++; },
    additionalOutputRuntimes: new Map(),
    applyPairedSpeakerRouting() {},
    async updateDisconnectedOutputDeviceIds() {},
    disconnectedOutputDeviceIds: new Set(),
    disconnectAdditionalOutputRuntime() { disconnected++; },
    async createAdditionalOutputRuntime() { created++; },
    applyAllSpeakerDelayNodes() {}
  };
  vm.runInNewContext(functionSource + "\nthis.syncAdditionalOutputRuntimes = syncAdditionalOutputRuntimes;", sandbox);
  await sandbox.syncAdditionalOutputRuntimes();
  assert.equal(route.enabled, false);
  assert.equal(saved, 1);
  assert.equal(disconnected, 1);
  assert.equal(created, 0);
});


test("YouTube iframe audio is muted on custom output routing and prior mute state is preserved", () => {
  const start = youtubeSource.indexOf("  function setYouTubeOutputRoutingBlocked(blocked) {");
  const end = youtubeSource.indexOf("\n  window.setYouTubeOutputRoutingBlocked", start);
  assert.ok(start >= 0 && end > start, "YouTube output safety helper must exist");
  const helperSource = youtubeSource.slice(start, end);
  let muted = false;
  let volume = 72;
  const sandbox = {
    youtubePlayerReady: true,
    youtubePlayer: {
      isMuted() { return muted; },
      getVolume() { return volume; },
      setVolume(value) { volume = value; },
      mute() { muted = true; },
      unMute() { muted = false; }
    },
    youtubeOutputRoutingBlocked: false,
    youtubeOutputMuteApplied: false,
    youtubeWasMutedBeforeRoutingBlock: false
  };
  vm.runInNewContext(helperSource + "\nthis.setYouTubeOutputRoutingBlocked = setYouTubeOutputRoutingBlocked;", sandbox);
  sandbox.setYouTubeOutputRoutingBlocked(true);
  assert.equal(muted, true);
  assert.equal(volume, 0);
  sandbox.setYouTubeOutputRoutingBlocked(false);
  assert.equal(muted, false);
  assert.equal(volume, 72);

  muted = true;
  volume = 45;
  sandbox.youtubeOutputMuteApplied = false;
  sandbox.setYouTubeOutputRoutingBlocked(true);
  assert.equal(volume, 0);
  sandbox.setYouTubeOutputRoutingBlocked(false);
  assert.equal(muted, true);
  assert.equal(volume, 45);
});


test("the artificial playback delay is removed while the PCM engine's internal prebuffer remains", () => {
  assert.doesNotMatch(audioSource, /playbackPrebufferDelayNode|setPlaybackPrebufferMs|PLAYBACK_PREBUFFER_STORAGE_KEY/);
  assert.doesNotMatch(uiSource, /playbackPrebufferSlider|playbackPrebufferNumber|setPlaybackPrebufferMs/);
  assert.doesNotMatch(indexSource, /playbackPrebufferSlider|playbackPrebufferNumber|音声先行バッファ/);
  assert.match(audioSource, /loudnessMakeupGainNode\.connect\(speakerBusNode\)/);
  assert.match(engineSource, /startBufferFrames:\s*8192/);
  assert.match(engineSource, /lookAheadSeconds:\s*0\.25/);
});


test("left-right pan offsets remain effective in 4D, 8D, and 16D orbit modes", () => {
  const start = audioSource.indexOf("function updateSpatialAudio(dt)");
  const end = audioSource.indexOf("\n  function updateSpatialAudioRouting", start);
  assert.ok(start >= 0 && end > start, "spatial position update function must exist");
  const positionSource = audioSource.slice(start, end);
  for (const mode of ["4D", "8D", "16D"]) {
    const panner = { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } };
    const sandbox = {
      audioCtx: {}, panner3DNode: panner, audio: { paused: false },
      state: { dMode: mode, panValue: 0.25 }, spatialAngle: 0.37
    };
    vm.runInNewContext(positionSource + "\nthis.updateSpatialAudio = updateSpatialAudio;", sandbox);
    sandbox.updateSpatialAudio(0.24);
    const t = 0.37 + 1.5 * 0.24;
    const baseX = mode === "4D"
      ? Math.sin(t * 0.55) * 2.5
      : mode === "8D"
        ? Math.sin(t * 0.95) * 2.6
        : Math.sin(t * 0.72) * 2.45;
    assert.ok(Math.abs(panner.positionX.value - (baseX + 0.45)) < 1e-12,
      `${mode} pan offset must be added to the orbit's horizontal position`);
  }
});


test("menu detail updates the back title to the selected operation and keeps library/settings tools hidden", () => {
  const openStart = uiSource.indexOf("function openMenuDetail(");
  const openEnd = uiSource.indexOf("\n  const MENU_CATEGORIES", openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  const openSource = uiSource.slice(openStart, openEnd);
  assert.match(openSource, /menuCategoryView\) menuCategoryView\.hidden = false/);
  assert.match(openSource, /menuCategoryCards\) menuCategoryCards\.hidden = true/);
  assert.ok(openSource.includes('node.hidden = true'));
  assert.ok(openSource.includes('btnMenuCategoryBack.textContent = "← " + title'));
  assert.match(openSource, /sideTitle\) el\.sideTitle\.textContent = "メニュー"/);
  assert.match(openSource, /btnSideBack\) el\.btnSideBack\.style\.display = "none"/);
  const backStart = uiSource.indexOf("if (btnMenuCategoryBack) {");
  const backEnd = uiSource.indexOf("\n  if (btnSettingsCategoryBack)", backStart);
  assert.ok(backStart >= 0 && backEnd > backStart);
  const backSource = uiSource.slice(backStart, backEnd);
  assert.match(backSource, /if \(menuDetailOpen\)[\s\S]*?menuDetailOpen = false/);
  assert.ok(backSource.includes('btnMenuCategoryBack.textContent = "← " + activeMenuCategoryTitle'));
  assert.match(backSource, /menuCategoryCards\.hidden = false/);
  assert.match(backSource, /menuCategoryView\) menuCategoryView\.hidden = true/);
  assert.match(backSource, /node\.hidden = false/);
});


test("bottom navigation has visible separators between tabs and from the mini-player", () => {
  const cssSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(cssSource, /\.bottomNav\s*\{[\s\S]*?border-top-color: color-mix\(in srgb, var\(--line\) 90%, var\(--text\) 10%\)/);
  assert.match(cssSource, /\.navTab:not\(:last-child\)\s*\{\s*border-right: 1px solid color-mix/);
  assert.match(cssSource, /body\.theme-light \.navTab:not\(:last-child\)/);
});


test("full file reset clears playback progress, duration, favorite state, and loudness tracking", () => {
  assert.match(audioSource, /if \(el\.timeNow\) el\.timeNow\.textContent = "0:00"/);
  assert.match(audioSource, /if \(el\.timeAll\) el\.timeAll\.textContent = "0:00"/);
  assert.match(audioSource, /if \(el\.progress\) el\.progress\.value = "0"/);
  assert.match(audioSource, /if \(el\.btnFav\)[\s\S]*?classList\.remove\("active"\)/);
  assert.match(audioSource, /lastStatsTime = 0/);
});
test("mic feedback strength slider and value label are mapped for event registration", () => {
  assert.match(stateSource, /micFeedbackStrength: document\.getElementById\("micFeedbackStrength"\)/);
  assert.match(stateSource, /micFeedbackStrengthText: document\.getElementById\("micFeedbackStrengthText"\)/);
  assert.match(outputSource, /el\.micFeedbackStrength\.addEventListener\("input"/);
});
test("track loudness normalization and manual output level share the protected output path", () => {
  assert.match(stateSource, /normalizeTrackVolume: loadBool\(STORAGE\.normalizeTrackVolume, true\)/);
  assert.match(stateSource, /outputLevelDb: Math\.max\(-12, Math\.min\(0/);
  assert.match(indexSource, /id="outputLevelDb" min="-12" max="0"/);
  assert.match(audioSource, /const canBoost = state\.clippingProtection !== false && state\.speakerSettings\?\.multipleOutputEnabled !== true/);
  assert.match(outputSource, /function setClippingProtection\(enabled\)[\s\S]*?resetTrackLoudnessNormalization\(\)/);
  assert.match(audioSource, /channelNormalizeNode\.connect\(trackLoudnessAnalyser\)/);
  assert.match(audioSource, /trackLoudnessAnalyser\.connect\(trackLoudnessGainNode\)/);
  assert.match(audioSource, /trackLoudnessGainNode\.connect\(masterGain\)/);
  assert.match(audioSource, /finalMixGainNode\.connect\(outputLevelGainNode\)/);
  assert.match(audioSource, /outputLevelGainNode\.connect\(loudnessCompressorNode\);[\s\S]*?loudnessCompressorNode\.connect\(loudnessMakeupGainNode\);[\s\S]*?loudnessMakeupGainNode\.connect\(speakerBusNode\);/);
  assert.match(indexSource, /id="normalizeTrackVolume"/);
  assert.match(indexSource, /id="outputLevelDb"/);
});
test("visualizer FPS uses rendered frame intervals and updates the label every two seconds", () => {
  assert.match(uiSource, /renderedFrameDeltaMs = visualizerLastRenderedAt[\s\S]*?now - visualizerLastRenderedAt/);
  assert.match(uiSource, /now - visualizerDisplayUpdateAt >= 2000/);
  assert.match(uiSource, /visualizerFrameTime = visualizerFrameTime \* 0\.8 \+ renderedFrameDeltaMs \* 0\.2/);
});
test("speaker output action buttons have a responsive gap and clear ON/OFF states", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(styleSource, /\.speakerDeviceActions\s*\{[\s\S]*?display: grid;[\s\S]*?gap: 8px/);
  assert.match(outputSource, /複数出力：/);
  assert.match(outputSource, /toggle\.setAttribute\("aria-pressed"/);
});


test("settings search covers category names, setting descriptions, and displays global results", () => {
  assert.match(uiSource, /function applySettingsSearch\(rawQuery\)/);
  assert.match(uiSource, /category\.items\.forEach\(\(\[sectionId, icon, title, description = ""\]\)/);
  assert.match(uiSource, /categoryMatches \|\| searchable\.includes\(query\)/);
  assert.match(uiSource, /settingsSearchResultCard/);
  assert.match(uiSource, /一致する設定項目がありません/);
});

test("equalizer slider remains ±12 dB/0.5 while manual input supports ±24 dB/0.1", () => {
  assert.match(audioSource, /id="eqSlider_\$\{idx\}" min="-12" max="12" step="0\.5"/);
  assert.match(audioSource, /id="eqNumber_\$\{idx\}" min="-24" max="24" step="0\.1"/);
  assert.match(audioSource, /const limit = manualInput \? 24 : 12/);
  assert.match(audioSource, /const step = manualInput \? 10 : 2/);
  assert.match(audioSource, /numberInput\.addEventListener\("input"/);
  assert.match(audioSource, /numberInput\.addEventListener\("change"/);
  assert.match(audioSource, /slider\.value = String\(Math\.max\(-12, Math\.min\(12, nextValue\)\)\)/);
  assert.match(audioSource, /numberInput\.value = Number\(g\)\.toFixed\(1\)/);
});

test("custom theme background image is validated and stored in IndexedDB", () => {
  const storageSource = fs.readFileSync(path.join(root, "js/3. storage.js"), "utf8");
  assert.match(storageSource, /indexedDB\.open\(dbName, 2\)/);
  assert.match(storageSource, /createObjectStore\("appSettings", \{ keyPath: "key" \}\)/);
  assert.match(storageSource, /function saveCustomThemeBackground\(blob\)/);
  assert.match(storageSource, /function loadCustomThemeBackground\(\)/);
  assert.match(storageSource, /function deleteCustomThemeBackground\(\)/);
  assert.match(indexSource, /id="customThemeBackgroundInput"/);
  assert.match(indexSource, /accept="image\/png,image\/jpeg,image\/webp,image\/avif"/);
  assert.match(audioSource, /file\.size > 8 \* 1024 \* 1024/);
  assert.match(audioSource, /saveCustomThemeBackground\(sourceBlob\)/);
  assert.match(audioSource, /backgroundImage =[\s\S]*?customThemeBackgroundObjectUrl/);
  assert.match(uiSource, /await restoreCustomThemeBackground\(\)/);
});

test("network status checks real internet access through independent external endpoints", async () => {
  assert.match(uiSource, /const NETWORK_PROBE_URLS = \[/);
  assert.match(uiSource, /https:\/\/www\.gstatic\.com\/generate_204/);
  assert.match(uiSource, /https:\/\/www\.google\.com\/generate_204/);
  assert.match(uiSource, /mode: "no-cors"/);
  assert.match(uiSource, /credentials: "omit"/);
  assert.match(uiSource, /Promise\.any\(checks\)/);
  assert.match(uiSource, /response\.type === "opaque"/);
  assert.doesNotMatch(uiSource, /manifest\.json\?mp-network-check|アプリの配信元へ接続/);
  assert.match(uiSource, /const NETWORK_PROBE_TIMEOUT_MS = 3000/);
  assert.match(uiSource, /const NETWORK_PROBE_INTERVAL_MS = 5000/);
  assert.match(uiSource, /window\.setInterval\(updateNetworkStatus, NETWORK_PROBE_INTERVAL_MS\)/);
  assert.match(uiSource, /navigator\.onLine === false/);
  assert.match(uiSource, /window\.addEventListener\("focus", updateNetworkStatus\)/);
  assert.match(uiSource, /window\.addEventListener\("pageshow", updateNetworkStatus\)/);
  assert.match(uiSource, /window\.addEventListener\("offline", markNetworkStatusOffline\)/);
  assert.match(uiSource, /activeNetworkProbeController\.abort\(\)/);
  assert.match(uiSource, /activeNetworkProbeController === controller/);
  assert.match(uiSource, /インターネットへ接続できます/);

  const probeMatch = uiSource.match(/async function probeInternetConnection\(signal\) \{[\s\S]*?\n  \}/);
  assert.ok(probeMatch, "the internet probe helper should exist");
  const calls = [];
  const reachableSandbox = {
    NETWORK_PROBE_URLS: ["https://www.gstatic.com/generate_204", "https://www.google.com/generate_204"],
    URL, Date, Promise,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { type: "opaque", ok: false, status: 0 };
    }
  };
  vm.runInNewContext(probeMatch[0] + "; this.probeInternetConnection = probeInternetConnection;", reachableSandbox);
  assert.equal(await reachableSandbox.probeInternetConnection(new AbortController().signal), true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.mode, "no-cors");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.redirect, "error");
    assert.ok(call.url.includes("mp-network-check="));
  }

  const offlineSandbox = {
    NETWORK_PROBE_URLS: ["https://www.gstatic.com/generate_204", "https://www.google.com/generate_204"],
    URL, Date, Promise,
    fetch: async () => { throw new Error("network unavailable"); }
  };
  vm.runInNewContext(probeMatch[0] + "; this.probeInternetConnection = probeInternetConnection;", offlineSandbox);
  await assert.rejects(offlineSandbox.probeInternetConnection(new AbortController().signal));

  const invalidResponseSandbox = {
    NETWORK_PROBE_URLS: ["https://www.gstatic.com/generate_204", "https://www.google.com/generate_204"],
    URL, Date, Promise,
    fetch: async () => ({ type: "basic", ok: true, status: 200 })
  };
  vm.runInNewContext(probeMatch[0] + "; this.probeInternetConnection = probeInternetConnection;", invalidResponseSandbox);
  await assert.rejects(invalidResponseSandbox.probeInternetConnection(new AbortController().signal));
});

test("service worker network-only bypass never satisfies requests from its offline cache", async () => {
  async function runProbe(fetchImpl) {
    const listeners = new Map();
    let cacheCalls = 0;
    let responsePromise;
    const context = {
      self: {
        location: { origin: "https://music.example" },
        addEventListener(type, handler) { listeners.set(type, handler); }
      },
      URL,
      Request,
      fetch: fetchImpl,
      caches: {
        open() { cacheCalls++; throw new Error("probe must not open a cache"); },
        match() { cacheCalls++; throw new Error("probe must not read a cache"); }
      }
    };
    vm.runInNewContext(serviceWorkerSource, context);
    const request = new Request("https://music.example/manifest.json?mp-network-check=123", {
      method: "GET", cache: "no-store", redirect: "error"
    });
    listeners.get("fetch")({
      request,
      respondWith(promise) { responsePromise = promise; }
    });
    return { responsePromise, cacheCalls: () => cacheCalls };
  }

  const online = await runProbe(async request => {
    assert.equal(request.cache, "no-store");
    assert.equal(request.redirect, "error");
    return new Response("online", { status: 200 });
  });
  assert.equal((await online.responsePromise).status, 200);
  assert.equal(online.cacheCalls(), 0);

  const offline = await runProbe(async () => {
    throw new Error("network unavailable");
  });
  await assert.rejects(offline.responsePromise, /network unavailable/);
  assert.equal(offline.cacheCalls(), 0);
});

test("settings reset aborts before clearing local settings when IndexedDB cleanup fails", () => {
  const storageSource = fs.readFileSync(path.join(root, "js/3. storage.js"), "utf8");
  assert.match(storageSource, /async function deleteCustomThemeBackground\(\)[\s\S]*?if \(!db && !\(await initDB\(\)\)\) return false/);
  const deleteIndex = audioSource.indexOf("const backgroundDeleted = await deleteCustomThemeBackground();");
  const failureIndex = audioSource.indexOf("if (!backgroundDeleted)", deleteIndex);
  const settingsIndex = audioSource.indexOf("STORAGE.eqState", deleteIndex);
  const reloadIndex = audioSource.indexOf("location.reload();", deleteIndex);
  assert.ok(deleteIndex >= 0 && failureIndex > deleteIndex);
  assert.ok(settingsIndex > failureIndex, "local settings must only be cleared after successful IndexedDB deletion");
  assert.ok(reloadIndex > settingsIndex, "reload must happen after successful cleanup");
  assert.match(audioSource, /if \(!backgroundDeleted\) \{[\s\S]*?return;[\s\S]*?STORAGE\.eqState/);
  assert.doesNotMatch(audioSource, /deleteCustomThemeBackground\(\)\.finally\(\(\) => location\.reload\(\)\)/);
});

test("Service Worker activation deletes only obsolete Music Player cache namespaces", async () => {
  const listeners = new Map();
  const deleted = [];
  const context = {
    self: {
      location: { origin: "https://music.example" },
      clients: { claim: async () => {} },
      addEventListener(type, handler) { listeners.set(type, handler); }
    },
    caches: {
      keys: async () => [
        "music-player-app-v7.5.16-r16",
        "music-player-app-v7.5.17-r17",
        "another-app-cache",
        "shared-site-cache"
      ],
      delete: async key => { deleted.push(key); return true; }
    },
    URL,
    Promise,
    fetch: async () => { throw new Error("not used by activate test"); },
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.runInNewContext(serviceWorkerSource, context);
  let activation;
  listeners.get("activate")({ waitUntil(promise) { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ["music-player-app-v7.5.16-r16"]);
  assert.ok(serviceWorkerSource.includes('key.startsWith(CACHE_PREFIX)'));
});


test("menu omits redundant playback, favorite, microphone-monitor and 3D-reset shortcuts while preserving their controls", () => {
  const menuConfigMatch = uiSource.match(/const MENU_CATEGORIES = \{[\s\S]*?\n  \};/);
  assert.ok(menuConfigMatch, "menu category configuration should exist");
  const menuConfig = menuConfigMatch[0];
  const removedShortcuts = [
    "btnPlay", "btnPrev", "btnNext", "btnRewind10", "btnForward10",
    "btnMainShuffle", "btnMainRepeat", "btnFav", "btnMicMonitor", "btnWaveViewReset"
  ];
  for (const id of removedShortcuts) {
    assert.equal(menuConfig.includes(id), false, `${id} should not be a menu shortcut`);
    assert.ok(indexSource.includes(`id="${id}"`), `${id} should remain available in its original UI`);
  }
  assert.ok(menuConfig.includes("optionsSection"), "playback settings should remain accessible from the menu");
  assert.match(uiSource, /el\.btnFav\.addEventListener\("click"/);
  assert.match(uiSource, /el\.btnMainShuffle\.addEventListener\("click"/);
  assert.match(uiSource, /el\.btnMainRepeat\.addEventListener\("click"/);
  assert.match(outputSource, /el\.btnMicMonitor\.addEventListener\("click"[\s\S]*?setMicMonitorEnabled/);
  assert.match(uiSource, /const waveResetBtn = document\.getElementById\("btnWaveViewReset"\)/);
});

test("menu first and second levels both remain in the left drawer and hide library/settings tools in level two", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  const overlayRule = styleSource.match(/\.overlay\s*\{([^}]*)\}/);
  const overlayOpenRule = styleSource.match(/\.overlay\.open\s*\{([^}]*)\}/);
  const sidebarRule = styleSource.match(/\.sidebar\s*\{([^}]*)\}/);
  const sidebarOpenRule = styleSource.match(/\.sidebar\.open\s*\{([^}]*)\}/);
  assert.ok(overlayRule && overlayOpenRule && sidebarRule && sidebarOpenRule);
  assert.match(overlayRule[1], /z-index:\s*20000/);
  assert.match(overlayOpenRule[1], /opacity:\s*1/);
  assert.match(sidebarRule[1], /position:\s*fixed/);
  assert.match(sidebarRule[1], /left:\s*0/);
  assert.match(sidebarRule[1], /width:\s*min\(360px, calc\(100vw - 48px\)\)/);
  assert.match(sidebarRule[1], /z-index:\s*20001/);
  assert.match(sidebarRule[1], /transform:\s*translateX\(-100%\)/);
  assert.match(sidebarRule[1], /opacity:\s*0/);
  assert.match(sidebarOpenRule[1], /transform:\s*translateX\(0\)/);
  assert.match(sidebarOpenRule[1], /opacity:\s*1/);
  assert.equal(styleSource.includes(".sidebar.menuLevelTwo {"), false);
  assert.match(uiSource, /function setMenuLevelTwo\(enabled\)[\s\S]*?classList\.toggle\("menuLevelTwo", Boolean\(enabled\)\)/);
  const categoryStart = uiSource.indexOf("function showMenuCategory(");
  const categoryEnd = uiSource.indexOf("\n  let activeSettingsDetail", categoryStart);
  const categorySource = uiSource.slice(categoryStart, categoryEnd);
  assert.ok(categorySource.includes('node.hidden = true'));
  const backStart = uiSource.indexOf("if (btnMenuCategoryBack) {");
  const backEnd = uiSource.indexOf("\n  if (btnSettingsCategoryBack)", backStart);
  assert.ok(uiSource.slice(backStart, backEnd).includes('node.hidden = false'));
  assert.match(uiSource, /document\.body\.classList\.add\("menu-open"\)/);
  assert.match(styleSource, /body\.menu-open\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(indexSource, /z-index["']?,?\s*["']2147483647/);
});



test("settings second-level detail is rendered in the same category layer without a bottom-sheet transition", () => {
  const start = uiSource.indexOf("function openSettingsDetail(secId, title)");
  const end = uiSource.indexOf("function showSettingsCategory", start);
  assert.ok(start >= 0 && end > start);
  const openSource = uiSource.slice(start, end);
  assert.ok(openSource.includes("settingsCategoryView.appendChild(target)"));
  assert.ok(openSource.includes('target.classList.add("active", "settingsInlineDetail")'));
  assert.equal(openSource.includes("settingsDetailOverlay"), false);
  assert.equal(openSource.includes("animateUiEntry"), false);
  assert.ok(uiSource.includes("settingsCategoryCards.hidden = true"));
  assert.ok(uiSource.includes("settingsCategoryCards.hidden = false"));
  assert.equal(indexSource.includes("settingsDetailOverlay"), false);
  assert.ok(indexSource.includes('id="eqPresetRow"'));
  assert.ok(indexSource.includes('id="eqBands"'));
  assert.ok(audioSource.includes("function renderEqualizer()"));
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.ok(styleSource.includes(".settingsCategoryView > .panelSection.active.settingsInlineDetail"));
  assert.ok(styleSource.includes(".settingsGrid[hidden]"));
  assert.match(styleSource, /\.settingsGrid\[hidden\]\s*\{\s*display:\s*none !important;/);
  assert.ok(styleSource.includes("animation: none !important"));
  assert.equal(styleSource.includes("settingsDetailScreenFromBottom"), false);
});

test("settings search input text and caret follow active theme tokens", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  const ruleStart = styleSource.lastIndexOf("#settingsSearch {");
  assert.ok(ruleStart >= 0);
  const searchRule = styleSource.slice(ruleStart, styleSource.indexOf("}", ruleStart));
  assert.ok(searchRule.includes("color: var(--text)"));
  assert.ok(searchRule.includes("caret-color: var(--accent)"));
});

test("custom theme background editor previews mobile and desktop layouts with rotation and persistent per-device settings", () => {
  assert.ok(indexSource.includes('id="themeBackgroundEditor"'));
  assert.ok(indexSource.includes('id="themeBgPreviewMobile"'));
  assert.ok(indexSource.includes('id="themeBgPreviewDesktop"'));
  assert.ok(indexSource.includes('data-theme-bg-rotation="270"'));
  assert.ok(indexSource.includes('data-theme-bg-setting="mobile.zoom"'));
  assert.ok(indexSource.includes('data-theme-bg-setting="desktop.x"'));
  assert.ok(indexSource.includes('id="btnSaveCustomThemeBackground"'));
  assert.ok(audioSource.includes('CUSTOM_THEME_BACKGROUND_LAYOUT_KEY = "mp_custom_theme_background_layout_v1"'));
  assert.ok(audioSource.includes("prepareCustomThemeBackground(blob, rotation)"));
  assert.ok(audioSource.includes("context.rotate(rotation * Math.PI / 180)"));
  assert.ok(audioSource.includes('window.matchMedia("(max-width: 760px)")'));
  assert.ok(audioSource.includes("customThemeBackgroundLayout[device]"));
  assert.ok(audioSource.includes("saveCustomThemeBackgroundLayout(layout)"));
  assert.ok(audioSource.includes("saveCustomThemeBackground(sourceBlob)"));
  assert.ok(audioSource.includes('backgroundPosition = "center, " + view.x + "% " + view.y + "%"'));
});


test("custom theme background preview reads rotation from its layout and keeps save enabled after a successful preview", () => {
  const previewStart = audioSource.indexOf("function updateCustomThemeBackgroundPreviews()");
  const previewEnd = audioSource.indexOf("async function prepareCustomThemeBackground", previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  const previewSource = audioSource.slice(previewStart, previewEnd);
  assert.ok(previewSource.includes("customThemeBackgroundLayout.rotation"));
  assert.ok(!previewSource.includes("=== rotation"), "preview must not read an undeclared rotation variable");

  const inputStart = audioSource.indexOf('el.customThemeBackgroundInput.addEventListener("change"');
  const inputEnd = audioSource.indexOf('document.querySelectorAll("[data-theme-bg-rotation]")', inputStart);
  assert.ok(inputStart >= 0 && inputEnd > inputStart);
  const inputSource = audioSource.slice(inputStart, inputEnd);
  assert.ok(inputSource.includes("previewReady"));
  assert.ok(inputSource.includes(".catch(error =>"));

  const saveStart = audioSource.indexOf('saveCustomThemeBackgroundButton.addEventListener("click"');
  const saveEnd = audioSource.indexOf("const cancelCustomThemeBackgroundButton", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const saveSource = audioSource.slice(saveStart, saveEnd);
  assert.ok(saveSource.includes("await initDB()"));
  assert.ok(saveSource.includes('saveCustomThemeBackgroundButton.dataset.saving === "true"'));
  assert.ok(saveSource.includes("finally"));
});


test("app background and buttons support horizontal navigation swipes without confusing taps", () => {
  const start = uiSource.indexOf("function isNavigationSwipeGesture(");
  const end = uiSource.indexOf("function activateNavigationTab", start);
  assert.ok(start >= 0 && end > start, "navigation swipe helpers must exist");
  const helperSource = uiSource.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(helperSource + "; this.isNavigationSwipeGesture = isNavigationSwipeGesture; this.getNavigationSwipeIndex = getNavigationSwipeIndex;", sandbox);
  assert.equal(sandbox.isNavigationSwipeGesture(100, 8), true);
  assert.equal(sandbox.isNavigationSwipeGesture(10, 2), false, "a tap must not count as a swipe");
  assert.equal(sandbox.isNavigationSwipeGesture(100, 90), false, "vertical/diagonal gestures must not count as a swipe");
  assert.equal(sandbox.getNavigationSwipeIndex(0, -100, 8, 4), 1);
  assert.equal(sandbox.getNavigationSwipeIndex(2, 100, 4, 4), 1);
  assert.equal(sandbox.getNavigationSwipeIndex(1, -100, 5, 4), 2);
  assert.equal(sandbox.getNavigationSwipeIndex(0, 100, 4, 4), -1);
  assert.equal(sandbox.getNavigationSwipeIndex(1, -40, 0, 4), -1);
  assert.equal(sandbox.getNavigationSwipeIndex(1, -100, 90, 4), -1);
  assert.match(uiSource, /navigationSwipeRoot\.addEventListener\("touchstart"/);
  assert.match(uiSource, /navigationSwipeRoot\.addEventListener\("touchend"/);
  assert.match(uiSource, /navigationSwipeRoot\.addEventListener\("touchcancel"/);
  assert.match(uiSource, /document\.getElementById\("shell"\) \|\| document\.querySelector\("\.shell"\)/);
  assert.ok(uiSource.includes('const swipeIgnoreSelector = "input, textarea, select, a, video, iframe, canvas,'));
  assert.equal(uiSource.includes('const swipeIgnoreSelector = "input, textarea, select, button,'), false, "buttons must not be excluded");
  assert.match(uiSource, /target\?\.closest\("\.song"\) && !target\.closest\("button"\)/);
  assert.match(uiSource, /navigationSwipeClickSuppression/);
  assert.match(uiSource, /event\.stopImmediatePropagation\(\)/);
  assert.ok(librarySource.includes('row.className = "song"'));
  assert.ok(librarySource.includes("playSong(song);"));
  assert.ok(youtubeSource.includes('row.className = "song"'));
  assert.ok(youtubeSource.includes('row.addEventListener("click", () => playSong(song))'));
  assert.match(uiSource, /isNavigationSwipeBlocked\(\)/);
});
test("swipe navigation uses directional slide animations and respects reduced motion", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(uiSource, /swipeDirection > 0 \? "tabSwipeInFromRight" : "tabSwipeInFromLeft"/);
  assert.match(styleSource, /\.tabSwipeInFromRight[\s\S]*?animation: tabSwipeInFromRight/);
  assert.match(styleSource, /\.tabSwipeInFromLeft[\s\S]*?animation: tabSwipeInFromLeft/);
  assert.match(styleSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.tabSwipeInFromRight,[\s\S]*?\.tabSwipeInFromLeft/);
});

test("bottom navigation separators are intentionally low contrast", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(styleSource, /border-top-color: color-mix\(in srgb, var\(--line\) 90%, var\(--text\) 10%\)/);
  assert.match(styleSource, /border-right: 1px solid color-mix\(in srgb, var\(--line\) 90%, var\(--text\) 10%\)/);
  assert.match(styleSource, /border-top-color: rgba\(24, 32, 44, \.12\)/);
  assert.match(styleSource, /border-right-color: rgba\(24, 32, 44, \.08\)/);
});


test("main content keeps vertical scrolling and clears swipe animation on button navigation", () => {
  const styleSource = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.match(uiSource, /activePanel\?\.classList\.remove\("tabSwipeInFromLeft", "tabSwipeInFromRight"\)/);
  assert.match(styleSource, /\.mainContent\s*\{\s*touch-action:\s*pan-y;\s*\}/);
  assert.match(styleSource, /#shell\s*\{\s*touch-action:\s*pan-y;\s*\}/);
});


test("manual dynamic-range compression control is persisted and inserted in the shared output path", () => {
  assert.match(stateSource, /loudnessCompression: Math\.max\(0, Math\.min\(100, Math\.round\(loadNum\(STORAGE\.loudnessCompression, 0\)\)\)\)/);
  assert.match(stateSource, /loudnessCompressionNumber: document\.getElementById\("loudnessCompressionNumber"\)/);
  assert.match(indexSource, /id="loudnessCompression" min="0" max="100" step="1"/);
  assert.match(indexSource, /id="loudnessCompressionNumber" min="0" max="100" step="1"/);
  assert.match(audioSource, /function applyLoudnessCompression\(value, persist = true\)/);
  assert.match(audioSource, /loudnessCompressorNode\.ratio\.setTargetAtTime\(1 \+ intensity \* 7/);
  assert.match(audioSource, /const makeupDb = intensity \* 6/);
  assert.match(audioSource, /localStorage\.setItem\(STORAGE\.loudnessCompression, String\(state\.loudnessCompression\)\)/);
  assert.match(audioSource, /outputLevelGainNode\.connect\(loudnessCompressorNode\);[\s\S]*?loudnessCompressorNode\.connect\(loudnessMakeupGainNode\);[\s\S]*?loudnessMakeupGainNode\.connect\(speakerBusNode\);/);
  assert.match(audioSource, /STORAGE\.loudnessCompression,/);
});
