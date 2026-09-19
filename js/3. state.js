// js/state.js
const AppState = {
  songs: [],
  queue: [],
  playlists: {},
  currentIndex: -1,
  isPlaying: false,
  isMuted: false,
  previousVolume: 1,
  
  // 再生設定
  settings: {
    rate: 1.0,
    pitch: 0,
    crossfade: true,
    silenceSkip: true,
    dMode: '2D',
    pan: 0,
    theme: 'system',
    customTheme: {
      c1: '#1e1e2e',
      c2: '#0f0f17',
      text: '#ffffff',
      l1: 100,
      l2: 100,
      lText: 100,
      deg: '180deg'
    }
  },

  // 統計情報
  stats: {
    playCount: 0,
    history: {}
  },

  // タイマー
  sleepTimer: null,
  timerRemaining: 0,

  // イコライザー設定 (10バンド)
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
