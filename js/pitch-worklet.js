// Music Player pitch shifter AudioWorklet.
// Uses the same two-grain overlap-add method as the ScriptProcessor fallback.
class MusicPlayerPitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.grainSize = Math.max(2048, Math.round(sampleRate * 0.09));
    this.hopSize = Math.floor(this.grainSize / 2);
    this.bufferLength = this.grainSize * 6;
    this.buffers = [new Float32Array(this.bufferLength), new Float32Array(this.bufferLength)];
    this.pitch = 1;
    this.writeIndex = 0;
    this.spawnCountdown = 0;
    this.nextSlot = 0;
    this.grains = [
      { active: false, readPos: 0, phase: 0 },
      { active: false, readPos: 0, phase: 0 }
    ];
    this.port.onmessage = event => {
      if (event.data?.type === "pitch") {
        const value = Number(event.data.value);
        if (Number.isFinite(value)) {
          const next = Math.max(0.5, Math.min(2, value));
          if (Math.abs(next - this.pitch) > 0.0001) {
            this.pitch = next;
            if (Math.abs(next - 1) >= 0.0001) this.resetHeads();
            else {
              this.grains[0].active = false;
              this.grains[1].active = false;
              this.spawnCountdown = 0;
            }
          }
        }
      }
    };
  }

  wrap(value) {
    value %= this.bufferLength;
    return value < 0 ? value + this.bufferLength : value;
  }

  readInterpolated(buffer, position) {
    const p = this.wrap(position);
    const i0 = Math.floor(p);
    const i1 = (i0 + 1) % this.bufferLength;
    const fraction = p - i0;
    return buffer[i0] * (1 - fraction) + buffer[i1] * fraction;
  }

  window(phase) {
    const x = Math.max(0, Math.min(1, phase));
    return 0.5 - 0.5 * Math.cos(Math.PI * x);
  }

  getStartDelay(pitch) {
    return this.grainSize * (pitch > 1 ? pitch + 0.35 : 1.35);
  }

  spawnGrain(pitch, writePosition) {
    const grain = this.grains[this.nextSlot];
    grain.active = true;
    grain.phase = 0;
    grain.readPos = this.wrap(writePosition - this.getStartDelay(pitch));
    this.nextSlot = this.nextSlot === 0 ? 1 : 0;
  }

  resetHeads() {
    const pitch = Math.max(0.5, Math.min(2, Number(this.pitch) || 1));
    const firstPosition = this.wrap(this.writeIndex - this.getStartDelay(pitch));
    const secondPosition = this.wrap(firstPosition - this.hopSize * pitch);
    this.grains[0].active = true;
    this.grains[0].phase = 0;
    this.grains[0].readPos = firstPosition;
    this.grains[1].active = true;
    this.grains[1].phase = 0.5;
    this.grains[1].readPos = secondPosition;
    this.nextSlot = 0;
    this.spawnCountdown = this.hopSize;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    const outputLeft = output[0];
    const outputRight = output[1] || outputLeft;
    if (!outputLeft) return true;

    const inputLeft = input[0] || null;
    const inputRight = input[1] || inputLeft;
    const pitch = Math.max(0.5, Math.min(2, Number(this.pitch) || 1));

    for (let i = 0; i < outputLeft.length; i++) {
      const left = inputLeft ? inputLeft[i] : 0;
      const right = inputRight ? inputRight[i] : left;
      this.buffers[0][this.writeIndex] = left;
      this.buffers[1][this.writeIndex] = right;

      if (Math.abs(pitch - 1) < 0.0001) {
        outputLeft[i] = left;
        if (outputRight) outputRight[i] = right;
        this.writeIndex = this.wrap(this.writeIndex + 1);
        continue;
      }

      if (this.spawnCountdown <= 0) {
        this.spawnGrain(pitch, this.writeIndex);
        this.spawnCountdown = this.hopSize;
      }

      let sumLeft = 0;
      let sumRight = 0;
      let weight = 0;
      for (const grain of this.grains) {
        if (!grain.active) continue;
        const gain = this.window(grain.phase);
        if (gain > 0) {
          sumLeft += this.readInterpolated(this.buffers[0], grain.readPos) * gain;
          sumRight += this.readInterpolated(this.buffers[1], grain.readPos) * gain;
          weight += gain;
        }
        grain.readPos = this.wrap(grain.readPos + pitch);
        grain.phase += 1 / this.grainSize;
        if (grain.phase >= 1) grain.active = false;
      }

      if (weight > 0.0001) {
        outputLeft[i] = sumLeft / weight;
        if (outputRight) outputRight[i] = sumRight / weight;
      } else {
        outputLeft[i] = 0;
        if (outputRight) outputRight[i] = 0;
      }

      this.writeIndex = this.wrap(this.writeIndex + 1);
      this.spawnCountdown--;
    }
    return true;
  }
}

registerProcessor("music-player-pitch-shifter", MusicPlayerPitchProcessor);
