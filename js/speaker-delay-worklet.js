class SpeakerDelayCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.max(1, Math.round(sampleRate * 5));
    this.buffer = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.filled = 0;
    this.totalFrames = 0;
    this.port.onmessage = event => {
      const data = event.data || {};
      if (data.type !== "capture") return;
      const samples = new Float32Array(this.filled);
      const start = (this.writeIndex - this.filled + this.capacity) % this.capacity;
      for (let i = 0; i < this.filled; i++) samples[i] = this.buffer[(start + i) % this.capacity];
      this.port.postMessage({
        type: "capture",
        id: data.id,
        data: samples,
        startFrame: this.totalFrames - this.filled,
        sampleRate
      }, [samples.buffer]);
    };
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const channel = input[0] || input[1] || null;
    const output = outputs[0] || [];
    const frameCount = output[0]?.length || channel?.length || 128;
    for (let i = 0; i < frameCount; i++) {
      this.buffer[this.writeIndex] = channel ? (Number(channel[i]) || 0) : 0;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.filled = Math.min(this.capacity, this.filled + 1);
    }
    for (const outputChannel of output) outputChannel.fill(0);
    this.totalFrames = currentFrame + frameCount;
    return true;
  }
}

registerProcessor("speaker-delay-capture", SpeakerDelayCaptureProcessor);