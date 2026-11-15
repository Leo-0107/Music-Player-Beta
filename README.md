# Music-Player-Beta

## JavaScript module numbering

The numeric prefixes group files by responsibility. They describe module organization, **not runtime execution order**. The startup controller (`js/1. ctrl.js`) preserves the dependency-safe loading order.

| File | Responsibility |
|---|---|
| `1. ctrl.js` | Application startup and script loading |
| `2. state.js` | Application state and defaults |
| `3. storage.js` | Persistent settings and data storage |
| `4. library.js` | Local music library |
| `5. youtube.js` | YouTube integration |
| `6. ui.js` | User interface |
| `7. audio.js` | Core audio processing |
| `8. pitch-worklet.js` | Pitch-processing AudioWorklet |
| `9. buffered-playback-engine.js` | Buffered PCM playback engine |
| `10. pcm-processing-worker.js` | PCM processing Worker |
| `11. audio-output.js` | Speaker and output-device routing |
| `12. speaker-delay-worklet.js` | Speaker-delay measurement AudioWorklet |
| `13. sw.js` | Service Worker implementation |

The root-level `sw.js` remains the browser's Service Worker entry point and imports `js/13. sw.js`.

Keep this map in sync with runtime URLs, Worker and AudioWorklet URLs, Service Worker caching, and regression-test paths when modules are renamed.
