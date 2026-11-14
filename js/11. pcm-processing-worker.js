// Music Player PCM pre-processing worker.
// Runs stateful EQ and pitch processing on bounded chunks ahead of playback.
"use strict";

const SAMPLE_RATE_DEFAULT = 48000;
const BAND_FREQUENCIES = [60, 250, 1000, 4000, 12000];
const BAND_TYPES = ["lowshelf", "peaking", "peaking", "peaking", "highshelf"];

let sampleRate = SAMPLE_RATE_DEFAULT;
let filters = [];
let pitch = 1;
let pitchState = null;
let initialized = false;
let expectedSequence = 0;

function makeBiquad(type, frequency, gainDb, q, rate) {
  const w0 = 2 * Math.PI * Math.min(frequency, rate * 0.49) / rate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);
  const alpha = sin / (2 * Math.max(0.0001, q));
  let b0, b1, b2, a0, a1, a2;

  if (type === "lowshelf") {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cos + beta);
    b1 = 2 * A * ((A - 1) - (A + 1) * cos);
    b2 = A * ((A + 1) - (A - 1) * cos - beta);
    a0 = (A + 1) + (A - 1) * cos + beta;
    a1 = -2 * ((A - 1) + (A + 1) * cos);
    a2 = (A + 1) + (A - 1) * cos - beta;
  } else if (type === "highshelf") {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cos + beta);
    b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    b2 = A * ((A + 1) + (A - 1) * cos - beta);
    a0 = (A + 1) - (A - 1) * cos + beta;
    a1 = 2 * ((A - 1) - (A + 1) * cos);
    a2 = (A + 1) - (A - 1) * cos - beta;
  } else {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  }

  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0,
    x1: [0, 0], x2: [0, 0], y1: [0, 0], y2: [0, 0]
  };
}

function configureEq(gains, preserveState = false) {
  const values = Array.isArray(gains) ? gains : [];
  const previous = filters;
  filters = BAND_FREQUENCIES.map((frequency, index) => {
    const next = makeBiquad(BAND_TYPES[index], frequency, Number(values[index]) || 0, 1, sampleRate);
    const old = previous[index];
    if (preserveState && old) {
      next.x1 = old.x1.slice();
      next.x2 = old.x2.slice();
      next.y1 = old.y1.slice();
      next.y2 = old.y2.slice();
    }
    return next;
  });
}

function createPitchState() {
  const grainSize = Math.max(2048, Math.round(sampleRate * 0.09));
  return {
    grainSize,
    hopSize: Math.floor(grainSize / 2),
    bufferLength: grainSize * 6,
    buffers: [new Float32Array(grainSize * 6), new Float32Array(grainSize * 6)],
    writeIndex: 0,
    spawnCountdown: 0,
    nextSlot: 0,
    grains: [
      { active: false, readPos: 0, phase: 0 },
      { active: false, readPos: 0, phase: 0 }
    ]
  };
}

function wrap(value, length) {
  value %= length;
  return value < 0 ? value + length : value;
}

function pitchStartDelay(value) {
  return pitchState.grainSize * (value > 1 ? value + 0.35 : 1.35);
}

function resetPitchHeads() {
  const first = wrap(pitchState.writeIndex - pitchStartDelay(pitch), pitchState.bufferLength);
  const second = wrap(first - pitchState.hopSize * pitch, pitchState.bufferLength);
  pitchState.grains[0].active = true;
  pitchState.grains[0].phase = 0;
  pitchState.grains[0].readPos = first;
  pitchState.grains[1].active = true;
  pitchState.grains[1].phase = 0.5;
  pitchState.grains[1].readPos = second;
  pitchState.nextSlot = 0;
  pitchState.spawnCountdown = pitchState.hopSize;
}

function resetAll() {
  for (const filter of filters) {
    filter.x1.fill(0); filter.x2.fill(0);
    filter.y1.fill(0); filter.y2.fill(0);
  }
  if (pitchState) {
    pitchState.buffers[0].fill(0);
    pitchState.buffers[1].fill(0);
    pitchState.writeIndex = 0;
    pitchState.spawnCountdown = 0;
    pitchState.nextSlot = 0;
    pitchState.grains.forEach(grain => { grain.active = false; grain.readPos = 0; grain.phase = 0; });
  }
  expectedSequence = 0;
}

function processEq(left, right) {
  const channels = [left, right];
  for (const filter of filters) {
    for (let channel = 0; channel < 2; channel++) {
      const input = channels[channel];
      const outputState = filter;
      let x1 = outputState.x1[channel];
      let x2 = outputState.x2[channel];
      let y1 = outputState.y1[channel];
      let y2 = outputState.y2[channel];
      for (let i = 0; i < input.length; i++) {
        const x = input[i];
        const y = outputState.b0 * x + outputState.b1 * x1 + outputState.b2 * x2
          - outputState.a1 * y1 - outputState.a2 * y2;
        input[i] = Number.isFinite(y) ? y : 0;
        x2 = x1; x1 = x;
        y2 = y1; y1 = input[i];
      }
      outputState.x1[channel] = x1;
      outputState.x2[channel] = x2;
      outputState.y1[channel] = y1;
      outputState.y2[channel] = y2;
    }
  }
}

function readInterpolated(buffer, position) {
  const p = wrap(position, pitchState.bufferLength);
  const first = Math.floor(p);
  const second = (first + 1) % pitchState.bufferLength;
  const fraction = p - first;
  return buffer[first] * (1 - fraction) + buffer[second] * fraction;
}

function processPitch(left, right) {
  if (Math.abs(pitch - 1) < 0.0001) return;
  const state = pitchState;
  const outLeft = new Float32Array(left.length);
  const outRight = new Float32Array(right.length);
  for (let i = 0; i < left.length; i++) {
    state.buffers[0][state.writeIndex] = left[i];
    state.buffers[1][state.writeIndex] = right[i];

    if (state.spawnCountdown <= 0) {
      const grain = state.grains[state.nextSlot];
      grain.active = true;
      grain.phase = 0;
      grain.readPos = wrap(state.writeIndex - pitchStartDelay(pitch), state.bufferLength);
      state.nextSlot = state.nextSlot === 0 ? 1 : 0;
      state.spawnCountdown = state.hopSize;
    }

    let sumLeft = 0, sumRight = 0, weight = 0;
    for (const grain of state.grains) {
      if (!grain.active) continue;
      const phase = Math.max(0, Math.min(1, grain.phase));
      const gain = 0.5 - 0.5 * Math.cos(Math.PI * phase);
      if (gain > 0) {
        sumLeft += readInterpolated(state.buffers[0], grain.readPos) * gain;
        sumRight += readInterpolated(state.buffers[1], grain.readPos) * gain;
        weight += gain;
      }
      grain.readPos = wrap(grain.readPos + pitch, state.bufferLength);
      grain.phase += 1 / state.grainSize;
      if (grain.phase >= 1) grain.active = false;
    }

    outLeft[i] = weight > 0.0001 ? sumLeft / weight : 0;
    outRight[i] = weight > 0.0001 ? sumRight / weight : 0;
    state.writeIndex = wrap(state.writeIndex + 1, state.bufferLength);
    state.spawnCountdown--;
  }
  left.set(outLeft);
  right.set(outRight);
}

function initialize(message) {
  sampleRate = Math.max(8000, Math.min(192000, Number(message.sampleRate) || SAMPLE_RATE_DEFAULT));
  pitch = Math.max(0.5, Math.min(2, Number(message.pitch) || 1));
  configureEq(message.eqGains);
  pitchState = createPitchState();
  resetAll();
  initialized = true;
}

self.onmessage = event => {
  const message = event.data || {};
  try {
    if (message.type === "init") {
      initialize(message);
      self.postMessage({ type: "ready", id: message.id });
      return;
    }
    if (!initialized) throw new Error("PCM processor worker is not initialized");

    if (message.type === "configure") {
      const gains = Array.isArray(message.eqGains) ? message.eqGains : null;
      if (gains) configureEq(gains, true);
      const nextPitch = Number(message.pitch);
      if (Number.isFinite(nextPitch)) {
        const clamped = Math.max(0.5, Math.min(2, nextPitch));
        if (Math.abs(clamped - pitch) > 0.0001) {
          pitch = clamped;
          pitchState.grains.forEach(grain => { grain.active = false; });
          pitchState.spawnCountdown = 0;
          if (Math.abs(pitch - 1) >= 0.0001) resetPitchHeads();
        }
      }
      self.postMessage({ type: "configured", id: message.id });
      return;
    }

    if (message.type === "reset") {
      resetAll();
      self.postMessage({ type: "reset", id: message.id });
      return;
    }

    if (message.type === "process") {
      const left = message.left instanceof Float32Array ? message.left : new Float32Array(message.left || []);
      const right = message.right instanceof Float32Array ? message.right : new Float32Array(message.right || []);
      if (!left.length || left.length !== right.length) throw new Error("PCM chunk channel lengths are invalid");
      const sequence = Number(message.sequence);
      if (Number.isFinite(sequence) && sequence !== expectedSequence) {
        throw new Error("PCM chunk sequence is discontinuous");
      }
      processEq(left, right);
      processPitch(left, right);
      expectedSequence++;
      self.postMessage({
        type: "processed", id: message.id, sequence,
        left, right, frameCount: left.length
      }, [left.buffer, right.buffer]);
      return;
    }

    if (message.type === "dispose") {
      initialized = false;
      filters = [];
      pitchState = null;
      self.postMessage({ type: "disposed", id: message.id });
    }
  } catch (error) {
    self.postMessage({ type: "error", id: message.id, message: String(error?.message || error) });
  }
};
