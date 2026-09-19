// js/audio.js
class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.audioEl = new Audio();
    this.audioEl.crossOrigin = "anonymous";
    
    this.source = this.ctx.createMediaElementSource(this.audioEl);
    this.panner = this.ctx.createStereoPanner();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;

    // EQノード生成
    const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    this.eqFilters = freqs.map(freq => {
      const filter = this.ctx.createBiquadFilter();
      filter.type = freq <= 310 ? 'lowshelf' : (freq >= 12000 ? 'highshelf' : 'peaking');
      filter.frequency.value = freq;
      filter.gain.value = 0;
      return filter;
    });

    // 接続の構築
    let node = this.source;
    this.eqFilters.forEach(filter => {
      node.connect(filter);
      node = filter;
    });
    node.connect(this.panner);
    this.panner.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.autoPanAngle = 0;
    this.autoPanTimer = null;
  }

  playSong(src) {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.audioEl.src = src;
    this.audioEl.play();
    AppState.isPlaying = true;
  }

  togglePlay() {
    if (this.audioEl.paused) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.audioEl.play();
      AppState.isPlaying = true;
    } else {
      this.audioEl.pause();
      AppState.isPlaying = false;
    }
  }

  setVolume(val) {
    this.audioEl.volume = Math.min(Math.max(val, 0), 1);
    AppState.settings.volume = val;
  }

  setRate(val) {
    this.audioEl.playbackRate = val;
    AppState.settings.rate = val;
  }

  setPan(val) {
    this.panner.pan.value = val;
  }

  setDMode(mode) {
    AppState.settings.dMode = mode;
    clearInterval(this.autoPanTimer);
    if (mode === '2D') {
      this.setPan(AppState.settings.pan);
    } else {
      let speed = 0.02;
      if (mode === '4D') speed = 0.05;
      if (mode === '8D') speed = 0.1;
      if (mode === '16D') speed = 0.2;

      this.autoPanTimer = setInterval(() => {
        this.autoPanAngle += speed;
        this.panner.pan.value = Math.sin(this.autoPanAngle);
      }, 50);
    }
  }

  setEqGain(index, val) {
    if (this.eqFilters[index]) {
      this.eqFilters[index].gain.value = val;
      AppState.eqGains[index] = val;
    }
  }
}

const audio = new AudioEngine();
