  // 出力先の切替直後に発生する一時的な音声経路の不安定化を防ぐ。
  // 再生位置・再生速度・ピッチは変更せず、最終ミックスだけをごく短時間フェードアウトしてから復帰させる。

  async function runOutputTransition(task) {
    const previous = outputTransitionPromise;
    let release;
    outputTransitionPromise = new Promise(resolve => { release = resolve; });
    await previous;
    const gainNode = finalMixGainNode;
    const now = audioCtx?.currentTime || 0;
    const currentGain = gainNode ? Math.max(0, Number(gainNode.gain.value) || 0) : 1;
    try {
      if (gainNode && audioCtx) {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(currentGain, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.025);
      }
      await new Promise(resolve => setTimeout(resolve, 35));
      return await task();
    } finally {
      const restoreAt = (audioCtx?.currentTime || now) + 0.015;
      if (gainNode && audioCtx) {
        gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(currentGain, restoreAt);
      }
      release();
    }
  }

  // 対応ブラウザではAudioContextを直接出力先へ接続し、MediaStreamDestinationと
  // 非表示audio要素を経由する余分な出力段を省いて、サイト側の遅延を最小化する。

  function isAndroidStandalonePwa() {
    try {
      return /Android/i.test(navigator.userAgent || "") && (
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        navigator.standalone === true
      );
    } catch (e) {
      return false;
    }
  }

  function ensureOutputBridge() {
    if (!audioCtx || outputBridgeAudio || !audioCtx.createMediaStreamDestination) return;

    outputStreamDestination = audioCtx.createMediaStreamDestination();
    outputBridgeAudio = document.createElement("audio");
    outputBridgeAudio.autoplay = true;
    outputBridgeAudio.controls = false;
    outputBridgeAudio.playsInline = true;
    outputBridgeAudio.setAttribute("aria-hidden", "true");
    outputBridgeAudio.style.position = "fixed";
    outputBridgeAudio.style.left = "-10000px";
    outputBridgeAudio.style.top = "0";
    outputBridgeAudio.style.width = "1px";
    outputBridgeAudio.style.height = "1px";
    outputBridgeAudio.style.opacity = "0";
    outputBridgeAudio.style.pointerEvents = "none";
    outputBridgeAudio.srcObject = outputStreamDestination.stream;
    outputBridgeAudio.volume = state.speakerSettings?.mainEnabled === false ? 0 : 1;
    document.body.appendChild(outputBridgeAudio);
  }

  function getActiveSpeakerPair() {
    const mainId = getMainOutputIdentity();
    const activeAdditional = state.outputRoutes.filter(route =>
      route && route.enabled !== false && route.deviceId && route.deviceId !== mainId
    );
    return activeAdditional.length === 1 ? { mainId, additional: activeAdditional[0] } : null;
  }

  function applyPairedSpeakerRouting() {
    if (!channelSplitter || !leftGainNode || !rightGainNode) return;

    const connectRoute = (splitter, leftGain, rightGain, leftChannel = "left", rightChannel = "right") => {
      try { splitter.disconnect(leftGain); } catch (e) {}
      try { splitter.disconnect(rightGain); } catch (e) {}

      if (leftChannel === "left") splitter.connect(leftGain, 0, 0);
      else if (leftChannel === "right") splitter.connect(leftGain, 1, 0);

      if (rightChannel === "left") splitter.connect(rightGain, 0, 0);
      else if (rightChannel === "right") splitter.connect(rightGain, 1, 0);
    };

    const mainLeftChannel = ["left", "right", "off"].includes(state.speakerSettings?.leftChannel)
      ? state.speakerSettings.leftChannel
      : (state.speakerSettings?.channelMode === "right" ? "right" : "left");
    const mainRightChannel = ["left", "right", "off"].includes(state.speakerSettings?.rightChannel)
      ? state.speakerSettings.rightChannel
      : (state.speakerSettings?.channelMode === "left" ? "left" : "right");
    connectRoute(channelSplitter, leftGainNode, rightGainNode, mainLeftChannel, mainRightChannel);

    for (const [deviceId, runtime] of additionalOutputRuntimes) {
      if (!runtime?.splitter) continue;
      const route = state.outputRoutes.find(item => item.deviceId === deviceId);
      const leftChannel = ["left", "right", "off"].includes(route?.leftChannel)
        ? route.leftChannel
        : (route?.channelMode === "right" ? "right" : "left");
      const rightChannel = ["left", "right", "off"].includes(route?.rightChannel)
        ? route.rightChannel
        : (route?.channelMode === "left" ? "left" : "right");
      connectRoute(runtime.splitter, runtime.leftGain, runtime.rightGain, leftChannel, rightChannel);
    }
  }

  function clampSpeakerDelay(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n * 10) / 10)) : 0;
  }

  function getMainOutputDelay() {
    return clampSpeakerDelay(state.speakerSettings?.mainDelayMs);
  }

  function getSpeakerDelayOffsets() {
    return getUnifiedSpeakerEntries().map(entry => clampSpeakerDelay(entry.delayMs));
  }

  function getEffectiveSpeakerDelay(delayMs) {
    return state.speakerSettings?.autoDelayEnabled === false ? 0 : clampSpeakerDelay(delayMs);
  }

  function applyAllSpeakerDelayNodes() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (mainDelayNode) {
      const delayMs = getEffectiveSpeakerDelay(getMainOutputDelay());
      mainDelayNode.delayTime.setValueAtTime(Math.min(1.5, delayMs / 1000), now);
      const mainOutputTarget = (mainOutputUsesDirectSink || mainOutputUsesNativeDestination)
        ? mainOutputDirectGainNode
        : outputStreamDestination;
      if (mainOutputTarget) {
        try { analyser.disconnect(mainDelayNode); } catch (e) {}
        try { mainDelayNode.disconnect(mainOutputTarget); } catch (e) {}
        try { analyser.disconnect(mainOutputTarget); } catch (e) {}
        if (delayMs <= 0) analyser.connect(mainOutputTarget);
        else {
          analyser.connect(mainDelayNode);
          mainDelayNode.connect(mainOutputTarget);
        }
      }
    }
    for (const route of state.outputRoutes) {
      const runtime = additionalOutputRuntimes.get(route.deviceId);
      if (runtime?.delayNode) {
        const delayMs = getEffectiveSpeakerDelay(route.delayMs);
        runtime.delayNode.delayTime.setValueAtTime(Math.min(1.5, delayMs / 1000), now);
        try { runtime.merger.disconnect(runtime.delayNode); } catch (e) {}
        try { runtime.delayNode.disconnect(runtime.destination); } catch (e) {}
        try { runtime.merger.disconnect(runtime.destination); } catch (e) {}
        if (delayMs <= 0) runtime.merger.connect(runtime.destination);
        else {
          runtime.merger.connect(runtime.delayNode);
          runtime.delayNode.connect(runtime.destination);
        }
      }
    }
  }

  function applyMainOutputDelayNode() {
    const delayMs = getMainOutputDelay();
    applyAllSpeakerDelayNodes();
    if (el.mainOutputDelay) el.mainOutputDelay.value = String(delayMs);
    if (el.mainOutputDelayText) el.mainOutputDelayText.textContent = String(delayMs) + " ms";
  }

  function setMainOutputDelay(value) {
    const delayMs = clampSpeakerDelay(value);
    state.speakerSettings.mainDelayMs = delayMs;
    saveState();
    applyMainOutputDelayNode();
    renderAdditionalOutputSpeakers();
  }

  function adjustMainOutputDelay(step) {
    setMainOutputDelay(getMainOutputDelay() + step);
  }

  const autoDelayEnabledToggle = document.getElementById("autoDelayEnabled");
  if (autoDelayEnabledToggle) {
    autoDelayEnabledToggle.checked = state.speakerSettings?.autoDelayEnabled !== false;
    autoDelayEnabledToggle.addEventListener("change", () => {
      state.speakerSettings.autoDelayEnabled = autoDelayEnabledToggle.checked;
      saveState();
      applyMainOutputDelayNode();
      renderAdditionalOutputSpeakers();
      toast(autoDelayEnabledToggle.checked ? "自動遅延補正を有効にしました" : "自動遅延補正を無効にしました");
    });
  }

  async function autoMeasureSpeakerDelay(targetEntry = null) {
    const modal = document.getElementById("speakerDelayMeasurementModal");
    const list = document.getElementById("speakerDelayMeasurementList");
    let status = null;
    let measurementMicGain = 1;
    let measurementOutputGain = 1;
    let originalMainVolume = null;
    let originalRouteConnections = new Map();
    let routesSnapshotTaken = false;
    if (list) {
      list.innerHTML = "";
      status = document.createElement("div");
      status.className = "speakerMeasurementProgress";
      status.textContent = targetEntry
        ? targetEntry.label + " を測定中…\n複数回の測定音をマイクで検出しています。"
        : "スピーカーを測定中…\n複数回の測定音をマイクで検出しています。";
      status.style.whiteSpace = "pre-line";
      status.style.padding = "14px";
      status.style.textAlign = "center";
      status.style.color = "var(--text)";
      status.style.fontWeight = "600";
      list.appendChild(status);

      const controls = document.createElement("div");
      controls.className = "speakerMeasurementControls";
      const makeMeasurementControl = (labelText, initial, aria, onInput) => {
        const wrap = document.createElement("label");
        wrap.className = "speakerMeasurementControl";
        const title = document.createElement("span");
        title.textContent = labelText;
        const value = document.createElement("span");
        value.className = "speakerMeasurementControlValue";
        value.textContent = Math.round(initial * 100) + "%";
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "0";
        slider.max = "2";
        slider.step = "0.01";
        slider.value = String(initial);
        slider.setAttribute("aria-label", aria);
        slider.addEventListener("input", () => {
          const n = Math.max(0, Math.min(2, Number(slider.value)));
          value.textContent = Math.round(n * 100) + "%";
          onInput(n);
        });
        wrap.append(title, value, slider);
        return wrap;
      };
      controls.append(
        makeMeasurementControl("マイク入力", measurementMicGain, "測定用マイク入力レベル", n => {
          measurementMicGain = n;
          if (window.__musicPlayerMeasurementMicGain && audioCtx) {
            window.__musicPlayerMeasurementMicGain.gain.setTargetAtTime(n, audioCtx.currentTime, 0.03);
          }
        }),
        makeMeasurementControl("スピーカー出力", measurementOutputGain, "測定用スピーカー出力レベル", n => {
          measurementOutputGain = n;
        })
      );
      list.appendChild(controls);
    }

    if (modal) modal.hidden = false;
    document.body.classList.add("output-device-modal-open");
    ensureGraph();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") await audioCtx.resume();

    let micStream = null;
    let measurementMicGainNode = null;
    let captureNode = null;
    let captureMuteNode = null;
    const captureResolvers = new Map();
    let captureRequestId = 0;
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const median = values => {
      const sorted = values.slice().sort((a, b) => a - b);
      if (!sorted.length) return 0;
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const micSource = audioCtx.createMediaStreamSource(micStream);
      measurementMicGainNode = audioCtx.createGain();
      measurementMicGainNode.gain.value = measurementMicGain;
      window.__musicPlayerMeasurementMicGain = measurementMicGainNode;
      micSource.connect(measurementMicGainNode);

      const micAnalyser = audioCtx.createAnalyser();
      micAnalyser.fftSize = 2048;
      micAnalyser.smoothingTimeConstant = 0;
      measurementMicGainNode.connect(micAnalyser);
      const micData = new Uint8Array(micAnalyser.fftSize);
      const micFrequencyData = new Uint8Array(micAnalyser.frequencyBinCount);

      // マイク波形をAudioWorkletでサンプル精度で記録し、相関計算は測定後に行う。
      if (audioCtx.audioWorklet && typeof AudioWorkletNode === "function") {
        try {
          if (!audioCtx._musicPlayerSpeakerDelayWorkletLoaded) {
            await audioCtx.audioWorklet.addModule(new URL("js/speaker-delay-worklet.js", document.baseURI).href);
            audioCtx._musicPlayerSpeakerDelayWorkletLoaded = true;
          }
          captureNode = new AudioWorkletNode(audioCtx, "speaker-delay-capture", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: "explicit"
          });
          captureMuteNode = audioCtx.createGain();
          captureMuteNode.gain.value = 0;
          measurementMicGainNode.connect(captureNode);
          captureNode.connect(captureMuteNode);
          captureMuteNode.connect(audioCtx.destination);
          captureNode.port.onmessage = event => {
            const data = event.data || {};
            if (data.type !== "capture") return;
            const resolve = captureResolvers.get(data.id);
            if (resolve) {
              captureResolvers.delete(data.id);
              resolve(data);
            }
          };
        } catch (workletError) {
          try { captureNode?.disconnect(); } catch {}
          try { captureMuteNode?.disconnect(); } catch {}
          captureNode = null;
          captureMuteNode = null;
          console.warn("Speaker delay AudioWorklet unavailable; using analyser fallback:", workletError);
        }
      }

      const allEntries = getUnifiedSpeakerEntries().filter(entry =>
        !entry.disconnected && (entry.selected || entry.route?.enabled !== false)
      );
      if (!allEntries.length) throw new Error("no-speakers");

      let entries = allEntries;
      if (targetEntry && !targetEntry.selected) {
        const mainEntry = allEntries.find(entry => entry.selected);
        const target = allEntries.find(entry => !entry.selected && entry.deviceId === targetEntry.deviceId);
        entries = [mainEntry, target].filter(Boolean);
      } else if (targetEntry?.selected) {
        entries = [allEntries.find(entry => entry.selected) || targetEntry];
      }
      if (!entries.length) throw new Error("no-target-speaker");

      originalMainVolume = outputBridgeAudio?.volume;
      originalRouteConnections = new Map(state.outputRoutes.map(route => [
        route.deviceId,
        !!additionalOutputRuntimes.get(route.deviceId)?.connected
      ]));
      routesSnapshotTaken = true;
      const measurements = [];
      const setOnlyTarget = async target => {
        if (outputBridgeAudio) outputBridgeAudio.volume = target.selected ? 1 : 0;
        if (typeof speakerBusNode === "undefined" || !speakerBusNode) return;
        for (const item of state.outputRoutes) {
          const runtime = additionalOutputRuntimes.get(item.deviceId);
          const active = !target.selected && item.deviceId === target.deviceId && item.enabled !== false;
          if (!runtime) continue;
          if (active && !runtime.connected) {
            try { speakerBusNode.connect(runtime.splitter); runtime.connected = true; } catch {}
          } else if (!active && runtime.connected) {
            try { speakerBusNode.disconnect(runtime.splitter); runtime.connected = false; } catch {}
          }
        }
      };

      const createTemplate = sampleRate => {
        const stride = 4;
        const duration = 0.022;
        const attack = 0.003;
        const count = Math.floor(sampleRate * duration / stride);
        const sin = new Float32Array(count);
        const cos = new Float32Array(count);
        let energy = 0;
        for (let i = 0; i < count; i++) {
          const time = i * stride / sampleRate;
          const envelope = time < attack
            ? 0.0001 * Math.pow(0.12 / 0.0001, time / attack)
            : 0.12 * Math.pow(0.0001 / 0.12, (time - attack) / (duration - attack));
          const phase = 2 * Math.PI * 1100 * time;
          sin[i] = Math.sin(phase) * envelope;
          cos[i] = Math.cos(phase) * envelope;
          energy += envelope * envelope;
        }
        return { stride, sin, cos, energy };
      };

      const correlatePulse = (capture, pulseTime, template) => {
        if (!capture?.data || !capture.sampleRate) return null;
        const sampleRate = capture.sampleRate;
        const expected = Math.round(pulseTime * sampleRate) - Number(capture.startFrame || 0);
        if (expected < 0 || expected + template.sin.length * template.stride >= capture.data.length) return null;
        const maxLag = Math.min(
          Math.round(sampleRate * 0.9),
          capture.data.length - expected - template.sin.length * template.stride - 1
        );
        let bestScore = 0;
        let bestLag = -1;
        for (let lag = 0; lag <= maxLag; lag += 8) {
          let dotSin = 0;
          let dotCos = 0;
          let signalEnergy = 0;
          for (let i = 0; i < template.sin.length; i++) {
            const sample = capture.data[expected + lag + i * template.stride] || 0;
            dotSin += sample * template.sin[i];
            dotCos += sample * template.cos[i];
            signalEnergy += sample * sample;
          }
          const score = Math.sqrt(dotSin * dotSin + dotCos * dotCos) /
            Math.sqrt(Math.max(1e-12, template.energy * signalEnergy));
          if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
          }
        }
        if (bestLag < 0 || bestScore < 0.14) return null;
        return { delayMs: bestLag / sampleRate * 1000, confidence: Math.min(1, bestScore) };
      };

      const captureMicBuffer = async () => {
        const id = ++captureRequestId;
        const result = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            captureResolvers.delete(id);
            reject(new Error("mic-capture-timeout"));
          }, 2000);
          captureResolvers.set(id, data => {
            clearTimeout(timer);
            resolve(data);
          });
        });
        captureNode.port.postMessage({ type: "capture", id });
        return result;
      };

      const schedulePulse = (target, startAt) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1100, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.12 * measurementOutputGain), startAt + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.022);
        osc.connect(gain);
        gain.connect(target);
        osc.start(startAt);
        osc.stop(startAt + 0.026);
        osc.onended = () => {
          try { osc.disconnect(); gain.disconnect(); } catch {}
        };
      };

      const measureWithAnalyser = async (target, count) => {
        const values = [];
        for (let i = 0; i < count; i++) {
          const startAt = audioCtx.currentTime + 0.12;
          const startPerf = performance.now() + 120;
          schedulePulse(target, startAt);
          const deadline = startPerf + 900;
          let detected = null;
          while (performance.now() < deadline) {
            micAnalyser.getByteTimeDomainData(micData);
            micAnalyser.getByteFrequencyData(micFrequencyData);
            const binHz = audioCtx.sampleRate / micAnalyser.fftSize;
            const bandStart = Math.max(1, Math.floor(950 / binHz));
            const bandEnd = Math.min(micFrequencyData.length - 1, Math.ceil(1250 / binHz));
            let tonePeak = 0;
            let sidePeak = 0;
            for (let j = Math.max(1, bandStart - 10); j <= Math.min(micFrequencyData.length - 1, bandEnd + 10); j++) {
              if (j >= bandStart && j <= bandEnd) tonePeak = Math.max(tonePeak, micFrequencyData[j]);
              else sidePeak = Math.max(sidePeak, micFrequencyData[j]);
            }
            let waveformPeak = 0;
            for (let j = 0; j < micData.length; j++) {
              waveformPeak = Math.max(waveformPeak, Math.abs(micData[j] - 128));
            }
            if (waveformPeak > 18 && tonePeak > 24 && tonePeak >= sidePeak * 1.08) {
              detected = performance.now() - startPerf;
              break;
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          if (detected != null && detected >= 0) values.push({ delayMs: detected, confidence: 0.5 });
          await wait(120);
        }
        return values;
      };

      for (const entry of entries) {
        await setOnlyTarget(entry);
        await wait(180);
        const target = entry.selected
          ? mainDelayNode
          : additionalOutputRuntimes.get(entry.deviceId)?.delayNode;
        if (!target) continue;

        let detectedValues = [];
        if (captureNode) {
          const firstPulse = audioCtx.currentTime + 0.15;
          const pulseTimes = [firstPulse, firstPulse + 1.1, firstPulse + 2.2];
          const template = createTemplate(audioCtx.sampleRate);
          pulseTimes.forEach(time => schedulePulse(target, time));
          const captureWait = Math.max(0, (pulseTimes[2] + 1.0 - audioCtx.currentTime) * 1000);
          await wait(captureWait);
          const capture = await captureMicBuffer();
          detectedValues = pulseTimes.map(time => correlatePulse(capture, time, template)).filter(Boolean);
        } else {
          detectedValues = await measureWithAnalyser(target, 3);
        }

        if (detectedValues.length < 2) throw new Error("low-confidence-measurement:" + entry.label);
        const delays = detectedValues.map(item => item.delayMs);
        const delayMs = median(delays);
        const spreadMs = Math.max(...delays) - Math.min(...delays);
        const confidence = median(detectedValues.map(item => item.confidence));
        measurements.push({ entry, delayMs, spreadMs, confidence, samples: detectedValues.length });
      }

      if (!measurements.length) throw new Error("no-measurement");
      if (measurements.some(item => item.spreadMs > 90 || item.confidence < 0.14)) {
        throw new Error("unstable-measurement");
      }

      const maxDelay = Math.max(...measurements.map(item => item.delayMs));
      const autoDelayEnabled = state.speakerSettings?.autoDelayEnabled !== false;
      const currentDelayFor = item => {
        const stored = item.entry.selected ? state.speakerSettings?.mainDelayMs : item.entry.route?.delayMs;
        return autoDelayEnabled ? clampSpeakerDelay(stored) : 0;
      };
      if (targetEntry?.selected) {
        state.speakerSettings.mainDelayMs = 0;
      } else {
        for (const item of measurements) {
          const nextDelay = currentDelayFor(item) + maxDelay - item.delayMs;
          const correction = clampSpeakerDelay(nextDelay);
          if (item.entry.selected) state.speakerSettings.mainDelayMs = correction;
          else if (item.entry.route) item.entry.route.delayMs = correction;
        }
      }

      state.speakerSettings.lastMeasuredAt = Date.now();
      state.speakerSettings.measurementMethod = captureNode ? "microphone-worklet-correlation" : "microphone-analyser-median";
      state.speakerSettings.lastMeasurementConfidence = median(measurements.map(item => item.confidence));
      state.speakerSettings.lastMeasurementSpreadMs = Math.max(...measurements.map(item => item.spreadMs));
      state.speakerSettings.lastMeasurementSampleCount = measurements.reduce((sum, item) => sum + item.samples, 0);
      saveState();
      applyMainOutputDelayNode();
      renderAdditionalOutputSpeakers();

      if (status) {
        status.textContent = "測定完了\n" + measurements.map(item =>
          item.entry.label + ": " + item.delayMs.toFixed(1) + "ms / 信頼度 " +
          Math.round(item.confidence * 100) + "% / ばらつき " + item.spreadMs.toFixed(1) + "ms"
        ).join("\n");
      }
      const confidencePercent = Math.round(median(measurements.map(item => item.confidence)) * 100);
      toast("複数回のマイク測定（中央値）で遅延を補正しました（信頼度 " + confidencePercent + "%）");
    } catch (e) {
      const reason = String(e?.message || "");
      if (status) {
        status.textContent = reason.startsWith("low-confidence") || reason === "unstable-measurement"
          ? "測定値が安定しませんでした。マイク入力・スピーカー出力を調整して再測定してください。"
          : "音響測定に失敗しました。マイクの許可と出力機器を確認してください。";
      }
      toast(e?.name === "NotAllowedError"
        ? "マイクの使用を許可してください"
        : reason.startsWith("low-confidence") || reason === "unstable-measurement"
          ? "測定の信頼度が不足しています。再測定してください"
          : "音響測定に失敗しました");
    } finally {
      if (modal) modal.hidden = true;
      document.body.classList.remove("output-device-modal-open");
      if (window.__musicPlayerMeasurementMicGain === measurementMicGainNode) {
        delete window.__musicPlayerMeasurementMicGain;
      }
      try { captureNode?.port?.close(); } catch {}
      try { captureNode?.disconnect(); } catch {}
      try { captureMuteNode?.disconnect(); } catch {}
      try { measurementMicGainNode?.disconnect(); } catch {}
      if (outputBridgeAudio && Number.isFinite(originalMainVolume)) outputBridgeAudio.volume = originalMainVolume;
      if (routesSnapshotTaken && typeof speakerBusNode !== "undefined" && speakerBusNode) {
        for (const route of state.outputRoutes) {
          const runtime = additionalOutputRuntimes.get(route.deviceId);
          if (!runtime) continue;
          const wasConnected = originalRouteConnections.get(route.deviceId) === true;
          if (wasConnected && !runtime.connected) {
            try { speakerBusNode.connect(runtime.splitter); runtime.connected = true; } catch {}
          } else if (!wasConnected && runtime.connected) {
            try { speakerBusNode.disconnect(runtime.splitter); runtime.connected = false; } catch {}
          }
        }
      }
      if (micStream) micStream.getTracks().forEach(track => track.stop());
    }
  }
  function openSpeakerDelayMeasurementModal() {
    const modal = document.getElementById("speakerDelayMeasurementModal");
    const list = document.getElementById("speakerDelayMeasurementList");
    if (!modal || !list) return;
    if (modal.parentElement !== document.body) {
      document.body.appendChild(modal);
    }
    list.innerHTML = "";
    const entries = getUnifiedSpeakerEntries().filter(entry => !entry.disconnected && (entry.selected || entry.route?.enabled !== false));
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "speakerSectionNote";
      empty.textContent = "測定できるスピーカーがありません。";
      list.appendChild(empty);
    } else {
      for (const entry of entries) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "outputDeviceItem";
        button.style.width = "100%";
        button.style.textAlign = "left";
        button.style.color = "var(--text)";
        const name = document.createElement("strong");
        name.style.color = "var(--text)";
        name.textContent = entry.label;
        const detail = document.createElement("small");
        detail.textContent = entry.selected ? "メイン出力" : "登録スピーカー";
        button.append(name, detail);
        button.addEventListener("click", async () => {
          modal.hidden = true;
          document.body.classList.remove("output-device-modal-open");
          await autoMeasureSpeakerDelay(entry);
        });
        list.appendChild(button);
      }
    }
    modal.hidden = false;
    document.body.classList.add("output-device-modal-open");
  }

  function closeSpeakerDelayMeasurementModal() {
    const modal = document.getElementById("speakerDelayMeasurementModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("output-device-modal-open");
  }

  if (el.mainOutputDelay) {
    el.mainOutputDelay.value = String(getMainOutputDelay());
    el.mainOutputDelay.addEventListener("change", e => setMainOutputDelay(e.target.value));
  }
  if (el.btnMainOutputDelayDown) {
    el.btnMainOutputDelayDown.addEventListener("click", () => adjustMainOutputDelay(-0.1));
  }
  if (el.btnMainOutputDelayUp) {
    el.btnMainOutputDelayUp.addEventListener("click", () => adjustMainOutputDelay(0.1));
  }
  if (el.btnAutoCalibrateSpeakers) {
    el.btnAutoCalibrateSpeakers.addEventListener("click", openSpeakerDelayMeasurementModal);
  }
  const btnMeasureMicLatency = document.getElementById("btnMeasureMicLatency");
  if (btnMeasureMicLatency) {
    btnMeasureMicLatency.addEventListener("click", () => {
      openSpeakerDelayMeasurementModal();
      const status = document.getElementById("micLatencyMeasurementStatus");
      if (status) status.textContent = "マイクを使った実測を開始します。測定するスピーカーを選択してください。";
    });
  }
  const btnCloseSpeakerDelayMeasurement = document.getElementById("btnCloseSpeakerDelayMeasurement");
  const speakerDelayMeasurementModal = document.getElementById("speakerDelayMeasurementModal");
  if (btnCloseSpeakerDelayMeasurement) {
    btnCloseSpeakerDelayMeasurement.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      closeSpeakerDelayMeasurementModal();
    });
  }
  if (speakerDelayMeasurementModal) {
    speakerDelayMeasurementModal.addEventListener("click", event => {
      if (event.target === speakerDelayMeasurementModal) {
        closeSpeakerDelayMeasurementModal();
      }
    });
  }

  if (el.btnSpeakerPairSwap) el.btnSpeakerPairSwap.remove();

  function snapToDefault(value, defaultValue, threshold) {
    const n = Number(value);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.abs(n - defaultValue) <= threshold ? defaultValue : n;
  }

  function snapSettingsRangeToDefault(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "range") return;

    // 再生位置バーは設定ではないため、中央スナップの対象外。
    if (input.id === "progress" || input.id === "miniProgress") return;

    const min = Number(input.min);
    const max = Number(input.max);
    const step = Number(input.step);
    const value = Number(input.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(value) || max <= min) return;

    const defaultValue = (min + max) / 2;
    const range = max - min;
    const stepThreshold = Number.isFinite(step) && step > 0 ? step * 1.5 : 0;
    const threshold = Math.max(stepThreshold, range * 0.04);

    input.value = String(snapToDefault(value, defaultValue, threshold));
  }

  // すべての設定用rangeを同じ基準値へ吸着させる。
  // キャプチャ段階で値を補正するため、後続の各設定ハンドラーにも補正後の値が渡る。
  document.addEventListener("input", snapSettingsRangeToDefault, true);

  function updateChannelVolumeUI(side, value) {
    const clamped = Math.max(0, Math.min(2, snapToDefault(value, 1, 0.07)));
    const isLeft = side === "left";
    if (isLeft) {
      currentLeftVolumeTarget = clamped;
      state.channelLeft = clamped;
      if (leftGainNode) leftGainNode.gain.setTargetAtTime(clamped, audioCtx ? audioCtx.currentTime : 0, 0.045);
      if (el.channelLeft) el.channelLeft.value = clamped;
      if (el.channelLeftText) el.channelLeftText.textContent = `${Math.round(clamped * 100)}%`;
    } else {
      currentRightVolumeTarget = clamped;
      state.channelRight = clamped;
      if (rightGainNode) rightGainNode.gain.setTargetAtTime(clamped, audioCtx ? audioCtx.currentTime : 0, 0.045);
      if (el.channelRight) el.channelRight.value = clamped;
      if (el.channelRightText) el.channelRightText.textContent = `${Math.round(clamped * 100)}%`;
    }
    saveState();
  }

  if (el.channelLeft) {
    el.channelLeft.value = currentLeftVolumeTarget;
    el.channelLeftText && (el.channelLeftText.textContent = `${Math.round(currentLeftVolumeTarget * 100)}%`);
    el.channelLeft.addEventListener("input", e => {
      ensureGraph();
      updateChannelVolumeUI("left", e.target.value);
    });
  }
  if (el.channelRight) {
    el.channelRight.value = currentRightVolumeTarget;
    el.channelRightText && (el.channelRightText.textContent = `${Math.round(currentRightVolumeTarget * 100)}%`);
    el.channelRight.addEventListener("input", e => {
      ensureGraph();
      updateChannelVolumeUI("right", e.target.value);
    });
  }

  function getCurrentMainOutputSinkId() {
    return state.mainOutputDeviceId || "";
  }

  function getOutputDeviceLabel(device, fallback = "音声出力デバイス") {
    return device?.label || fallback;
  }

  // default出力と物理出力が同じ機器かを、deviceIdまたはgroupIdで判定する。
  // labelは同名の別機器を誤認する可能性があるため比較に使わない。
  function areSameOutputDevice(a, b) {
    if (!a || !b) return false;

    const aId = String(a.deviceId || "");
    const bId = String(b.deviceId || "");
    if (aId && bId && aId === bId) return true;

    const aGroupId = String(a.groupId || "");
    const bGroupId = String(b.groupId || "");
    return !!aGroupId && !!bGroupId && aGroupId === bGroupId;
  }

  let recentlyGrantedOutputDevice = null;
  let recentlyGrantedOutputDeviceUntil = 0;

  async function enumerateAudioOutputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === "audiooutput");

      if (
        recentlyGrantedOutputDevice?.deviceId &&
        Date.now() < recentlyGrantedOutputDeviceUntil &&
        !outputs.some(device => device.deviceId === recentlyGrantedOutputDevice.deviceId)
      ) {
        outputs.push(recentlyGrantedOutputDevice);
      } else if (Date.now() >= recentlyGrantedOutputDeviceUntil) {
        recentlyGrantedOutputDevice = null;
      }

      return outputs;
    } catch (e) {
      return recentlyGrantedOutputDevice?.deviceId && Date.now() < recentlyGrantedOutputDeviceUntil
        ? [recentlyGrantedOutputDevice]
        : [];
    }
  }

  async function getOutputPermissionState() {
    if (!navigator.permissions?.query) return null;
    try {
      const permission = await navigator.permissions.query({ name: "speaker-selection" });
      return permission.state;
    } catch (e) {
      return null;
    }
  }

  function setOutputPermissionStatusText(textValue) {
    [el.outputDevicePermissionStatus, el.outputDevicePermissionStatusMain].forEach(node => {
      if (node) node.textContent = textValue;
    });
  }

  async function updateOutputPermissionStatus() {
    if (!el.outputDevicePermissionStatus && !el.outputDevicePermissionStatusMain) return;
    const selectSupported = typeof navigator.mediaDevices?.selectAudioOutput === "function";
    const sinkSupported = typeof HTMLMediaElement?.prototype?.setSinkId === "function";
    if (!selectSupported && sinkSupported) {
      setOutputPermissionStatusText(
        "機器選択の状態: Chromeでは機器名の取得にマイクの許可が必要になる場合があります"
      );
      return;
    }
    if (!selectSupported) {
      setOutputPermissionStatusText(
        "機器選択の状態: このブラウザでは出力機器の切り替えに対応していません"
      );
      return;
    }

    const permissionState = await getOutputPermissionState();
    if (permissionState === "granted") {
      setOutputPermissionStatusText("機器選択の状態: 許可済み");
    } else if (permissionState === "denied") {
      setOutputPermissionStatusText("機器選択の状態: ブラウザでブロックされています");
    } else if (permissionState === "prompt") {
      setOutputPermissionStatusText("機器選択の状態: 未許可（許可ボタンから機器を選択してください）");
    } else {
      setOutputPermissionStatusText("機器選択の状態: 状態を確認できません");
    }
  }


  async function ensureOutputDeviceAccess() {
    const outputs = await enumerateAudioOutputs();
    const hasUsableOutput = outputs.some(d => d.deviceId && d.deviceId !== "default");
    if (hasUsableOutput) return outputs;

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (e) {}
    }

    return await enumerateAudioOutputs();
  }
  async function restoreStoredMainOutputIfAvailable() {
    const deviceId = state.mainOutputDeviceId || "";
    if (!deviceId) return true;

    const outputs = await enumerateAudioOutputs();
    const connected = outputs.some(device =>
      device.kind === "audiooutput" &&
      device.deviceId === deviceId
    );
    if (!connected) {
      await updateDisconnectedOutputDeviceIds();
      await updateOutputDeviceName();
      renderOutputDevicePicker();
      return false;
    }

    try {
      ensureGraph();
      ensureOutputBridge();
      if (outputBridgeAudio && typeof outputBridgeAudio.setSinkId === "function") {
        await outputBridgeAudio.setSinkId(deviceId);
        await startOutputBridge();
      }
      await updateOutputDeviceName();
      return true;
    } catch (e) {
      if (e?.name === "NotAllowedError" || e?.name === "NotFoundError") {
        toast("保存していたスピーカーを再接続するには、スピーカーを選び直してください");
      }
      await updateOutputDeviceName();
      renderOutputDevicePicker();
      return false;
    }
  }

  async function updateOutputDeviceName() {
    if (!el.outputDeviceName) return;
    try {
      const outputs = await enumerateAudioOutputs();
      const sinkId = state.mainOutputDeviceId || "";
      const current = outputs.find(d => d.deviceId === sinkId);
      if (current?.label) {
        state.speakerSettings.mainOutputLabel = current.label;
        el.outputDeviceName.textContent = current.label;
        saveState();
      } else if (sinkId && state.speakerSettings.mainOutputLabel) {
        el.outputDeviceName.textContent = state.speakerSettings.mainOutputLabel + "（未接続）";
      } else {
        el.outputDeviceName.textContent = "既定のスピーカー";
      }
    } catch (e) {
      el.outputDeviceName.textContent = state.speakerSettings.mainOutputLabel || "既定のスピーカー";
    }
  }

  function moveOutputDeviceModalsToBody() {
    [el.outputDeviceModal, el.outputDeviceAddModal].forEach(modal => {
      if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
      }
    });
  }

  function closeOutputDeviceModal() {
    if (el.outputDeviceModal) el.outputDeviceModal.hidden = true;
    document.body.classList.remove("output-device-modal-open");
  }

  function closeOutputDeviceAddModal() {
    if (el.outputDeviceAddModal) el.outputDeviceAddModal.hidden = true;
    document.body.classList.remove("output-device-modal-open");
  }

  async function setMainOutputDevice(deviceId) {
    ensureGraph();
    const normalized = deviceId || "";
    const previousId = mainOutputUsesDirectSink
      ? (audioCtx?.sinkId || state.mainOutputDeviceId || "")
      : (outputBridgeAudio?.sinkId || state.mainOutputDeviceId || "");
    const wasPlaying = !audio.paused;
    const selectedRouteIndex = normalized
      ? state.outputRoutes.findIndex(route => route.deviceId === normalized)
      : -1;
    const selectedRoute = selectedRouteIndex >= 0 ? state.outputRoutes[selectedRouteIndex] : null;

    const oldMain = {
      deviceId: previousId,
      label: state.speakerSettings?.mainOutputLabel || "",
      left: currentLeftVolumeTarget,
      right: currentRightVolumeTarget,
      delayMs: getMainOutputDelay()
    };

    try {
      await runOutputTransition(async () => {
        if (mainOutputUsesNativeDestination && !normalized) {
          // Android PWAの既定出力はAudioContext.destinationを維持する。
          mainOutputUsesDirectSink = false;
          mainOutputUsesNativeDestination = true;
          applyAllSpeakerDelayNodes();
          return;
        }
        if (typeof audioCtx?.setSinkId === "function") {
          mainOutputUsesNativeDestination = false;
          await audioCtx.setSinkId(normalized);
          mainOutputUsesDirectSink = true;
          if (wasPlaying && (audioCtx.state === "suspended" || audioCtx.state === "interrupted")) {
            try { await audioCtx.resume(); } catch (resumeError) {
              console.warn("Music Player AudioContext resume after output switch failed:", resumeError);
            }
          }
          if (outputBridgeAudio && !outputBridgeAudio.paused) {
            try { outputBridgeAudio.pause(); } catch (ignore) {}
          }
          applyAllSpeakerDelayNodes();
          return;
        }

        ensureOutputBridge();
        if (!outputBridgeAudio || typeof outputBridgeAudio.setSinkId !== "function") {
          throw new Error("No supported audio output routing API");
        }

        mainOutputUsesDirectSink = false;
        if (wasPlaying && outputBridgeAudio && !outputBridgeAudio.paused) {
          try { outputBridgeAudio.pause(); } catch (ignore) {}
        }
        await outputBridgeAudio.setSinkId(normalized);
        if (wasPlaying) {
          try { await audioCtx?.resume(); } catch (ignore) {}
          await outputBridgeAudio.play();
          if (outputBridgeAudio.paused) throw new Error("Output bridge did not resume");
        }
        applyAllSpeakerDelayNodes();
      });

      let newMain;

      if (selectedRoute) {
        newMain = {
          deviceId: selectedRoute.deviceId,
          label: selectedRoute.label,
          left: Number.isFinite(Number(selectedRoute.left)) ? Number(selectedRoute.left) : 1,
          right: Number.isFinite(Number(selectedRoute.right)) ? Number(selectedRoute.right) : 1,
          delayMs: clampSpeakerDelay(selectedRoute.delayMs)
        };

        const selectedRuntime = additionalOutputRuntimes.get(selectedRoute.deviceId);
        if (selectedRuntime) {
          try { speakerBusNode?.disconnect(selectedRuntime.splitter); } catch (ignore) {}
          try { selectedRuntime.audio.pause(); } catch (ignore) {}
          try { selectedRuntime.audio.srcObject = null; } catch (ignore) {}
          selectedRuntime.audio.remove();
          additionalOutputRuntimes.delete(selectedRoute.deviceId);
        }

        state.outputRoutes.splice(selectedRouteIndex, 1);
      } else {
        const outputs = await enumerateAudioOutputs();
        const current = outputs.find(device => device.deviceId === normalized);
        newMain = {
          deviceId: normalized,
          label:
            current?.label ||
            (normalized ? state.speakerSettings.mainOutputLabel || "選択したスピーカー" : "既定のスピーカー"),
          left: currentLeftVolumeTarget,
          right: currentRightVolumeTarget,
          delayMs: getMainOutputDelay(),
        channelMode: state.speakerSettings?.channelMode || "stereo"
        };
      }

      // メイン出力を切り替えても、以前のメインを自動で追加出力へ移さない。
      // 複数出力はユーザーが明示的に追加したルートだけを維持する。
      state.outputRoutes = state.outputRoutes.filter(route => route.deviceId !== newMain.deviceId);

      currentLeftVolumeTarget = Number.isFinite(Number(newMain.left)) ? Number(newMain.left) : 1;
      currentRightVolumeTarget = Number.isFinite(Number(newMain.right)) ? Number(newMain.right) : 1;
      state.channelLeft = currentLeftVolumeTarget;
      state.channelRight = currentRightVolumeTarget;
      if (leftGainNode) leftGainNode.gain.setTargetAtTime(currentLeftVolumeTarget, audioCtx.currentTime, 0.045);
      if (rightGainNode) rightGainNode.gain.setTargetAtTime(currentRightVolumeTarget, audioCtx.currentTime, 0.045);

      state.speakerSettings.mainDelayMs = clampSpeakerDelay(newMain.delayMs);
      if (mainDelayNode) {
        mainDelayNode.delayTime.setTargetAtTime(state.speakerSettings.mainDelayMs / 1000, audioCtx.currentTime, 0.01);
      }
      state.speakerSettings.mainOutputLabel = newMain.label;
      state.speakerSettings.mainOutputGroupId = newMain.groupId || "";

      state.mainOutputDeviceId = normalized;
      applyPairedSpeakerRouting();
      saveState();
      await syncAdditionalOutputRuntimes();
      if (wasPlaying) {
        await startOutputBridge?.();
      }
      await updateOutputDeviceName();
      renderAdditionalOutputSpeakers();
      renderOutputDevicePicker();
      return true;
    } catch (e) {
      try {
        if (mainOutputUsesDirectSink && typeof audioCtx?.setSinkId === "function") {
          await audioCtx.setSinkId(previousId);
        } else if (outputBridgeAudio && outputBridgeAudio.sinkId !== previousId) {
          await outputBridgeAudio.setSinkId(previousId);
          if (wasPlaying) await outputBridgeAudio.play();
        }
        applyAllSpeakerDelayNodes();
      } catch (restoreError) {
        try {
          if (outputBridgeAudio) {
            await outputBridgeAudio.setSinkId("");
            if (wasPlaying) await outputBridgeAudio.play();
          }
        } catch (ignore) {}
        state.mainOutputDeviceId = "";
      }
      if (
        (mainOutputUsesDirectSink && audioCtx?.sinkId === previousId) ||
        outputBridgeAudio?.sinkId === previousId
      ) {
        state.mainOutputDeviceId = previousId;
      } else if (outputBridgeAudio?.sinkId === "") {
        state.mainOutputDeviceId = "";
      }
      if (e?.name === "NotAllowedError") {
        toast("この出力機器を選ぶには、ブラウザの機器選択許可が必要です。「ブラウザの機器選択を許可」を押してください。");
      } else if (e?.name === "NotFoundError") {
        toast("接続中の出力機器が見つかりません。機器を接続してから一覧を再読み込みしてください。");
      } else if (e?.name === "AbortError") {
        toast("出力機器の切り替えに失敗しました。元のスピーカーへ戻しました");
      } else {
        toast("スピーカーの切り替えに失敗しました。元のスピーカーへ戻しました");
      }
      return false;
    }
  }

  function getUnifiedSpeakerEntries() {
    const mainId = getMainOutputIdentity();
    return [
      {
        selected: true,
        deviceId: mainId === "default" ? "" : mainId,
        label: state.speakerSettings?.mainOutputLabel || "既定のスピーカー",
        disconnected: mainId !== "default" && disconnectedOutputDeviceIds.has(mainId),
        left: currentLeftVolumeTarget,
        right: currentRightVolumeTarget,
        delayMs: getMainOutputDelay(),
        leftChannel: ["left", "right", "off"].includes(state.speakerSettings?.leftChannel)
          ? state.speakerSettings.leftChannel
          : (state.speakerSettings?.channelMode === "right" ? "right" : "left"),
        rightChannel: ["left", "right", "off"].includes(state.speakerSettings?.rightChannel)
          ? state.speakerSettings.rightChannel
          : (state.speakerSettings?.channelMode === "left" ? "left" : "right")
      },
      ...[...state.outputRoutes]
        .map((route, index) => ({ route, index }))
        .sort((a, b) => {
          const aDisconnected = !!a.route?.deviceId && disconnectedOutputDeviceIds.has(a.route.deviceId);
          const bDisconnected = !!b.route?.deviceId && disconnectedOutputDeviceIds.has(b.route.deviceId);
          if (aDisconnected !== bDisconnected) return aDisconnected ? 1 : -1;
          if (!aDisconnected && !bDisconnected) {
            const aAdded = Number(a.route?.addedAt) || 0;
            const bAdded = Number(b.route?.addedAt) || 0;
            if (aAdded !== bAdded) return bAdded - aAdded;
          }
          return a.index - b.index;
        })
        .map(({ route, index }) => ({
        selected: false,
        route,
        index,
        deviceId: route.deviceId,
        label: route.label,
        disconnected: !!route.deviceId && disconnectedOutputDeviceIds.has(route.deviceId),
        left: Number.isFinite(Number(route.left)) ? Number(route.left) : 1,
        right: Number.isFinite(Number(route.right)) ? Number(route.right) : 1,
        delayMs: clampSpeakerDelay(route.delayMs),
        leftChannel: ["left", "right", "off"].includes(route.leftChannel)
          ? route.leftChannel
          : (route.channelMode === "right" ? "right" : "left"),
        rightChannel: ["left", "right", "off"].includes(route.rightChannel)
          ? route.rightChannel
          : (route.channelMode === "left" ? "left" : "right")
      }))
    ];
  }

  function getAdditionalOutputStatus(route) {
    if (route?.enabled === false) return "停止中";
    const runtime = additionalOutputRuntimes.get(route?.deviceId);
    if (!runtime) return "接続待ち";
    if (runtime.playError) {
      return runtime.playError === "NotAllowedError" ? "再生許可待ち" : "再生失敗";
    }
    return "使用中";
  }

  function renameAdditionalOutputSpeaker(index) {
    const route = state.outputRoutes?.[index];
    if (!route) return;
    const current = String(route.label || "").trim();
    const next = window.prompt("スピーカーの名前を入力してください", current);
    if (next === null) return;
    const label = next.trim();
    if (!label) {
      toast("スピーカー名を空にはできません");
      return;
    }
    route.label = label;
    saveState();
    renderAdditionalOutputSpeakers();
    renderOutputDevicePicker();
    toast("スピーカー名を変更しました");
  }

  function setSpeakerChannelRoute(entry, side, mode) {
    const normalized = ["left", "right", "off"].includes(mode) ? mode : "off";
    const key = side === "left" ? "leftChannel" : "rightChannel";
    if (entry.selected) {
      if (!state.speakerSettings || typeof state.speakerSettings !== "object") state.speakerSettings = {};
      state.speakerSettings[key] = normalized;
    } else if (entry.route) {
      entry.route[key] = normalized;
    }
    saveState();
    applyPairedSpeakerRouting();
    renderAdditionalOutputSpeakers();
  }

  function cycleSpeakerChannelRoute(entry, side) {
    const current = side === "left" ? entry.leftChannel : entry.rightChannel;
    const next = current === "left" ? "right" : current === "right" ? "off" : "left";
    setSpeakerChannelRoute(entry, side, next);
  }

  async function testSpeakerOutput(entry) {
    try {
      ensureGraph();
      if (!audioCtx) return;
      if (audioCtx.state === "suspended") await audioCtx.resume();

      let target = null;
      if (entry.selected) {
        target = mainDelayNode;
      } else {
        let runtime = additionalOutputRuntimes.get(entry.deviceId);
        if (!runtime && entry.route) runtime = await createAdditionalOutputRuntime(entry.route);
        if (runtime) target = runtime.delayNode;
      }

      if (!target) {
        toast("このスピーカーをテストできません");
        return;
      }

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.connect(gain);
      gain.connect(target);
      osc.start(now);
      osc.stop(now + 0.4);
      osc.addEventListener("ended", () => {
        try { osc.disconnect(); } catch {}
        try { gain.disconnect(); } catch {}
      }, { once: true });
      toast(entry.label + " をテスト中");
    } catch {
      toast("スピーカーのテストに失敗しました");
    }
  }

  function appendSpeakerNameContent(nameEl, label, disconnected = false) {
    nameEl.classList.add("speakerNameScroll");
    const viewport = document.createElement("span");
    viewport.className = "speakerNameScrollViewport";
    const textEl = document.createElement("span");
    textEl.className = "speakerNameScrollText";
    textEl.textContent = String(label || "");
    viewport.appendChild(textEl);
    nameEl.appendChild(viewport);
    if (disconnected) {
      const disconnectedMark = document.createElement("span");
      disconnectedMark.className = "speakerDisconnectedMark";
      disconnectedMark.textContent = "⚠ 未接続";
      disconnectedMark.title = "この出力機器は現在接続されていません";
      nameEl.appendChild(disconnectedMark);
    }
    requestAnimationFrame(() => {
      const overflow = textEl.scrollWidth > viewport.clientWidth + 1;
      nameEl.classList.toggle("speakerNameIsLong", overflow);
      if (overflow) {
        const distance = Math.max(20, textEl.scrollWidth - viewport.clientWidth);
        const duration = Math.max(3.5, Math.min(12, distance / 24 + 2.5));
        nameEl.style.setProperty("--speaker-name-scroll-distance", distance + "px");
        nameEl.style.setProperty("--speaker-name-scroll-duration", duration + "s");
      }
    });
  }

  function renderAdditionalOutputSpeakers() {
    if (!el.additionalOutputSpeakers) return;
    el.additionalOutputSpeakers.innerHTML = "";

    for (const entry of getUnifiedSpeakerEntries()) {
      if (!String(entry.label || "").trim()) continue;

      const card = document.createElement("div");
      card.className = "additionalOutputSpeakerCard";
      if (entry.selected) card.classList.add("selectedSpeakerCard");

      const head = document.createElement("div");
      head.className = "additionalOutputSpeakerHead";

      const name = document.createElement("strong");
      name.className = "additionalOutputSpeakerName";
      appendSpeakerNameContent(name, entry.label, entry.disconnected);

      const actions = document.createElement("div");
      actions.className = "additionalOutputSpeakerActions";

      const status = document.createElement("small");
      status.className = "speakerRuntimeStatus";
      status.textContent = entry.selected ? (state.speakerSettings?.mainEnabled !== false ? "出力中" : "出力OFF") : getAdditionalOutputStatus(entry.route);
      status.style.marginRight = "8px";

      if (entry.selected) {
        const mainToggle = document.createElement("button");
        mainToggle.className = "btn small additionalOutputSpeakerToggle";
        mainToggle.type = "button";
        const mainEnabled = state.speakerSettings?.mainEnabled !== false;
        mainToggle.textContent = mainEnabled ? "出力中" : "出力OFF";
        mainToggle.classList.toggle("active", mainEnabled);
        mainToggle.setAttribute("aria-pressed", String(mainEnabled));
        mainToggle.setAttribute("aria-label", entry.label + "の出力状態を切り替える");
        mainToggle.addEventListener("click", e => {
          e.stopPropagation();
          toggleMainOutput();
        });
        actions.appendChild(mainToggle);
      }

      if (!entry.selected) {
        const toggle = document.createElement("button");
        toggle.className = "btn small additionalOutputSpeakerToggle";
        toggle.type = "button";
        const isEnabled = entry.route.enabled !== false;
        toggle.textContent = isEnabled ? "使用中" : "未使用";
        toggle.classList.toggle("active", isEnabled);
        toggle.setAttribute("aria-pressed", String(isEnabled));
        toggle.setAttribute("aria-label", entry.label + "の使用状態を切り替える");
        toggle.addEventListener("click", () => toggleAdditionalOutputSpeaker(entry.index));

        const edit = document.createElement("button");
        edit.className = "btn small ghost";
        edit.type = "button";
        edit.textContent = "名前を編集";
        edit.addEventListener("click", e => {
          e.stopPropagation();
          renameAdditionalOutputSpeaker(entry.index);
        });

        const remove = document.createElement("button");
        remove.className = "btn small ghost";
        remove.type = "button";
        remove.textContent = "削除";
        remove.addEventListener("click", () => removeAdditionalOutputSpeaker(entry.index));

        actions.append(status, toggle, edit, remove);
      }

      head.append(name);
      const actionRow = document.createElement("div");
      actionRow.className = "additionalOutputSpeakerActionRow";
      actionRow.append(actions);
      head.append(actionRow);

      const wrap = document.createElement("div");
      wrap.className = "channelVolumeWrap additionalChannelVolumeWrap";

      const makeChannel = (side, value) => {
        const item = document.createElement("div");
        item.className = "channelVolume";

        // 0 は有効な値なので || 1 を使わず、明示的に有限値を確認する。
        const safeValue = Number.isFinite(Number(value))
          ? Math.max(0, Math.min(2, Number(value)))
          : 1;

        const routeMode = side === "left" ? entry.leftChannel : entry.rightChannel;
        const routeModeButton = document.createElement("button");
        routeModeButton.type = "button";
        routeModeButton.className = "btn small ghost speakerChannelRouteButton";
        routeModeButton.textContent = routeMode === "off" ? "停止" : routeMode === "left" ? "L" : "R";
        routeModeButton.setAttribute("aria-label", entry.label + "の" + (side === "left" ? "L" : "R") + "出力を切り替える");
        routeModeButton.addEventListener("click", () => cycleSpeakerChannelRoute(entry, side));

        const valueEl = document.createElement("span");
        valueEl.className = "channelValue";
        valueEl.textContent = Math.round(safeValue * 100) + "%";

        const slider = document.createElement("input");
        slider.className = "channelSlider";
        slider.type = "range";
        slider.min = "0";
        slider.max = "2";
        slider.step = "0.01";
        slider.value = String(safeValue);
        slider.setAttribute("aria-label", entry.label + " " + (side === "left" ? "左" : "右") + "チャンネル音量");

        slider.addEventListener("input", e => {
          if (entry.selected) {
            updateChannelVolumeUI(side, e.target.value);
            valueEl.textContent = Math.round(
              (side === "left" ? currentLeftVolumeTarget : currentRightVolumeTarget) * 100
            ) + "%";
          } else {
            updateAdditionalOutputVolume(entry.index, side, e.target.value);
            const route = state.outputRoutes[entry.index];
            if (route) {
              valueEl.textContent = Math.round(
                (side === "left" ? route.left : route.right) * 100
              ) + "%";
            }
          }
        });

        const label = document.createElement("strong");
        label.textContent = side === "left" ? "L" : "R";
        item.append(routeModeButton, valueEl, slider, label);
        return item;
      };

      const delayWrap = document.createElement("div");
      delayWrap.className = "speakerDelayControls additionalSpeakerDelayControls";

      const delayLabel = document.createElement("span");
      delayLabel.className = "speakerDelayLabel";
      delayLabel.textContent = "遅延";

      const delayDown = document.createElement("button");
      delayDown.className = "btn small ghost";
      delayDown.type = "button";
      delayDown.textContent = "▼";

      const delayInput = document.createElement("input");
      delayInput.className = "speakerDelayInput";
      delayInput.type = "number";
      delayInput.min = "0";
      delayInput.max = "1000";
      delayInput.step = "0.1";
      delayInput.inputMode = "numeric";
      delayInput.value = String(entry.delayMs);

      const delayUnit = document.createElement("span");
      delayUnit.className = "speakerDelayUnit";
      delayUnit.textContent = "ms";

      const delayUp = document.createElement("button");
      delayUp.className = "btn small ghost";
      delayUp.type = "button";
      delayUp.textContent = "▲";

      delayDown.addEventListener("click", () => {
        if (entry.selected) setMainOutputDelay(getMainOutputDelay() - 0.1);
        else setAdditionalOutputDelay(entry.index, entry.route.delayMs - 0.1);
      });
      delayUp.addEventListener("click", () => {
        if (entry.selected) setMainOutputDelay(getMainOutputDelay() + 0.1);
        else setAdditionalOutputDelay(entry.index, entry.route.delayMs + 0.1);
      });
      delayInput.addEventListener("change", e => {
        if (entry.selected) setMainOutputDelay(e.target.value);
        else setAdditionalOutputDelay(entry.index, e.target.value);
      });

      delayWrap.append(delayLabel, delayDown, delayInput, delayUnit, delayUp);
      wrap.append(makeChannel("left", entry.left), makeChannel("right", entry.right));
      card.append(head, wrap, delayWrap);
      el.additionalOutputSpeakers.appendChild(card);
    }
  }

  function toggleMainOutput() {
    if (!state.speakerSettings || typeof state.speakerSettings !== "object") state.speakerSettings = {};
    state.speakerSettings.mainEnabled = state.speakerSettings.mainEnabled === false;
    const enabled = state.speakerSettings.mainEnabled;
    if (mainOutputDirectGainNode) {
      mainOutputDirectGainNode.gain.setTargetAtTime(enabled ? 1 : 0, audioCtx?.currentTime || 0, 0.005);
    }
    if (outputBridgeAudio) outputBridgeAudio.volume = enabled ? 1 : 0;
    saveState();
    renderAdditionalOutputSpeakers();
    toast(enabled ? "メイン出力をONにしました" : "メイン出力をOFFにしました");
  }

  function getMainOutputIdentity() {
    return getCurrentMainOutputSinkId() || "default";
  }

  function hasAdditionalOutput(deviceId) {
    const normalized = deviceId || "default";
    return getUnifiedSpeakerEntries().some(entry =>
      !entry.selected && (entry.deviceId || "default") === normalized
    );
  }

  function disconnectAdditionalOutputRuntime(deviceId) {
    const runtime = additionalOutputRuntimes.get(deviceId);
    if (!runtime) return;
    if (runtime.connected) {
      try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
      runtime.connected = false;
    }
    try { runtime.audio.pause(); } catch (e) {}
  }

  async function toggleAdditionalOutputSpeaker(index) {
    const route = state.outputRoutes[index];
    if (!route) return;

    route.enabled = route.enabled === false;
    saveState();

    await runOutputTransition(async () => {
      if (route.enabled) {
        await updateDisconnectedOutputDeviceIds();
        if (disconnectedOutputDeviceIds.has(route.deviceId)) {
          route.enabled = false;
          saveState();
          toast("このスピーカーは現在接続されていません");
          return;
        }
        const runtime = additionalOutputRuntimes.get(route.deviceId);
        if (runtime) {
          if (!runtime.connected) {
            try {
              speakerBusNode.connect(runtime.splitter);
              runtime.connected = true;
            } catch (e) {}
          }
          try {
            await runtime.audio.play();
            runtime.playError = null;
          } catch (e) {
            runtime.playError = e?.name || "PlaybackError";
            toast("追加スピーカーの再生を開始できませんでした");
          }
        } else {
          await createAdditionalOutputRuntime(route);
        }
      } else {
        disconnectAdditionalOutputRuntime(route.deviceId);
      }
    });

    applyPairedSpeakerRouting();
    renderAdditionalOutputSpeakers();
    renderOutputDevicePicker();
  }

  function removeAdditionalOutputSpeaker(index) {
    const route = state.outputRoutes[index];
    if (!route) return;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    if (runtime) {
      try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
      try { runtime.audio.pause(); } catch (e) {}
      try { runtime.audio.srcObject = null; } catch (e) {}
      runtime.audio.remove();
      additionalOutputRuntimes.delete(route.deviceId);
    }

    state.outputRoutes.splice(index, 1);
    applyPairedSpeakerRouting();
    saveState();
    renderAdditionalOutputSpeakers();
    renderOutputDevicePicker();
  }

  function updateAdditionalOutputVolume(index, side, value) {
    const route = state.outputRoutes[index];
    if (!route) return;
    const key = side === "left" ? "left" : "right";
    const n = Math.max(0, Math.min(2, Number(value)));
    route[key] = Number.isFinite(n) ? n : 1;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    if (runtime) {
      const gain = side === "left" ? runtime.leftGain : runtime.rightGain;
      gain.gain.setTargetAtTime(route[key], audioCtx?.currentTime || 0, 0.045);
    }
    saveState();
  }

  function setAdditionalOutputDelay(index, value) {
    const route = state.outputRoutes[index];
    if (!route) return;
    const delayMs = clampSpeakerDelay(value);
    route.delayMs = delayMs;

    const runtime = additionalOutputRuntimes.get(route.deviceId);
    saveState();
    applyPairedSpeakerRouting();
    applyAllSpeakerDelayNodes();
    renderAdditionalOutputSpeakers();
  }

  async function createAdditionalOutputRuntime(route) {
    if (!audioCtx || !analyser || !route?.deviceId) return null;
    if (additionalOutputRuntimes.has(route.deviceId)) return additionalOutputRuntimes.get(route.deviceId);
    if (!("setSinkId" in HTMLMediaElement.prototype) || !audioCtx.createMediaStreamDestination) return null;

    const destination = audioCtx.createMediaStreamDestination();
    const splitter = audioCtx.createChannelSplitter(2);
    const leftGain = audioCtx.createGain();
    const rightGain = audioCtx.createGain();
    const merger = audioCtx.createChannelMerger(2);
    const delayNode = audioCtx.createDelay(1.5);
    const media = document.createElement("audio");

    leftGain.gain.value = Number.isFinite(Number(route.left)) ? Number(route.left) : 1;
    rightGain.gain.value = Number.isFinite(Number(route.right)) ? Number(route.right) : 1;
    media.autoplay = true;
    media.controls = false;
    media.playsInline = true;
    media.setAttribute("aria-hidden", "true");
    media.style.display = "none";
    media.srcObject = destination.stream;
    delayNode.delayTime.value = Math.min(1.5, getEffectiveSpeakerDelay(route.delayMs) / 1000);

    speakerBusNode.connect(splitter);
    const runtime = {
      audio: media,
      destination,
      splitter,
      leftGain,
      rightGain,
      merger,
      delayNode,
      connected: true,
      playError: null
    };
    splitter.connect(leftGain, 0, 0);
    splitter.connect(rightGain, 1, 0);
    applyPairedSpeakerRouting();
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);
    // 遅延補正が0 msのときはDelayNodeを経由せず、最短経路で出力する。
    // 補正値が必要なスピーカーだけDelayNodeを使用する。
    if (getEffectiveSpeakerDelay(route.delayMs) <= 0) merger.connect(destination);
    else {
      merger.connect(delayNode);
      delayNode.connect(destination);
    }

    media.volume = 1;
    media.muted = false;
    document.body.appendChild(media);

    try {
      await media.setSinkId(route.deviceId);
    } catch (e) {
      try { speakerBusNode?.disconnect(splitter); } catch (ignore) {}
      media.pause();
      media.srcObject = null;
      media.remove();
      return null;
    }

    additionalOutputRuntimes.set(route.deviceId, runtime);
    applyPairedSpeakerRouting();
    if (route.enabled !== false && !audio.paused) {
      try {
        await media.play();
        runtime.playError = null;
      } catch (e) {
        runtime.playError = e?.name || "PlaybackError";
      }
    } else if (route.enabled === false) {
      disconnectAdditionalOutputRuntime(route.deviceId);
    }
    return runtime;
  }

  async function rebindStoredOutputRoutes(outputs = null) {
    const devices = outputs || await enumerateAudioOutputs();
    const physical = devices.filter(device =>
      device?.kind === "audiooutput" && device.deviceId && device.deviceId !== "default"
    );
    const used = new Set();

    const findMatch = (saved, excludeId = "") => {
      const exact = physical.find(device =>
        device.deviceId === saved?.deviceId && device.deviceId !== excludeId
      );
      if (exact) return exact;
      if (saved?.groupId) {
        const groupMatches = physical.filter(device =>
          device.groupId && device.groupId === saved.groupId && device.deviceId !== excludeId
        );
        if (groupMatches.length === 1) return groupMatches[0];
      }
      const label = String(saved?.label || "").trim();
      if (label) {
        const labelMatches = physical.filter(device =>
          String(device.label || "").trim() === label &&
          device.deviceId !== excludeId &&
          !used.has(device.deviceId)
        );
        if (labelMatches.length === 1) return labelMatches[0];
      }
      return null;
    };

    for (const route of state.outputRoutes) {
      if (!route?.deviceId) continue;
      const match = findMatch(route, route.deviceId);
      if (!match || match.deviceId === route.deviceId) {
        if (match) used.add(match.deviceId);
        continue;
      }
      const oldId = route.deviceId;
      const oldRuntime = additionalOutputRuntimes.get(oldId);
      if (oldRuntime) {
        try { speakerBusNode?.disconnect(oldRuntime.splitter); } catch (e) {}
        try { oldRuntime.audio.pause(); } catch (e) {}
        try { oldRuntime.audio.srcObject = null; } catch (e) {}
        try { oldRuntime.audio.remove(); } catch (e) {}
        additionalOutputRuntimes.delete(oldId);
      }
      route.deviceId = match.deviceId;
      route.label = match.label || route.label;
      route.groupId = match.groupId || route.groupId || "";
      used.add(match.deviceId);
    }

    const mainId = state.mainOutputDeviceId || "";
    if (mainId) {
      const mainSaved = {
        deviceId: mainId,
        label: state.speakerSettings?.mainOutputLabel || "",
        groupId: state.speakerSettings?.mainOutputGroupId || ""
      };
      const match = findMatch(mainSaved, mainId);
      if (match && match.deviceId !== mainId) {
        state.mainOutputDeviceId = match.deviceId;
        if (!state.speakerSettings || typeof state.speakerSettings !== "object") state.speakerSettings = {};
        state.speakerSettings.mainOutputLabel = match.label || mainSaved.label;
        state.speakerSettings.mainOutputGroupId = match.groupId || mainSaved.groupId || "";
      }
    }
    saveState();
  }

  async function updateDisconnectedOutputDeviceIds() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = new Set(
        devices
          .filter(device => device.kind === "audiooutput" && device.deviceId)
          .map(device => device.deviceId)
      );

      const next = new Set();
      for (const route of state.outputRoutes) {
        if (route?.deviceId && !outputs.has(route.deviceId)) {
          next.add(route.deviceId);
        }
      }

      const mainId = getMainOutputIdentity();
      if (mainId !== "default" && !outputs.has(mainId)) {
        next.add(mainId);
      }

      disconnectedOutputDeviceIds = next;
    } catch (e) {}
  }

  async function syncAdditionalOutputRuntimes() {
    if (!audioCtx || !analyser) return;
    const validIds = new Set(state.outputRoutes.map(route => route.deviceId).filter(Boolean));

    for (const [deviceId, runtime] of additionalOutputRuntimes) {
      if (!validIds.has(deviceId)) {
        try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
        try { runtime.audio.pause(); } catch (e) {}
        try { runtime.audio.srcObject = null; } catch (e) {}
        runtime.audio.remove();
        additionalOutputRuntimes.delete(deviceId);
      }
    }

    applyPairedSpeakerRouting();
    // 登録情報は残しても、現在接続されていない機器には音声経路を作らない。
    // 再接続時は devicechange / 再同期後に通常どおり復帰させる。
    await updateDisconnectedOutputDeviceIds();
    for (const route of state.outputRoutes) {
      if (route.enabled === false || disconnectedOutputDeviceIds.has(route.deviceId)) {
        disconnectAdditionalOutputRuntime(route.deviceId);
        continue;
      }
      await createAdditionalOutputRuntime(route);
    }
    applyAllSpeakerDelayNodes();
  }

  async function startOutputBridge() {
    if (outputBridgeAudio) {
      try {
        if (outputBridgeAudio.paused) await outputBridgeAudio.play();
      } catch (e) {}
    }

    let speakerStatusChanged = false;
    for (const [deviceId, runtime] of additionalOutputRuntimes.entries()) {
      const route = state.outputRoutes.find(item => item.deviceId === deviceId);

      // 「未使用」にした追加スピーカーは、バックグラウンド復帰や再生再開でも再生対象へ戻さない。
      if (route?.enabled === false) {
        if (!runtime.audio.paused) {
          try { runtime.audio.pause(); } catch (e) {}
        }
        continue;
      }

      try {
        if (!runtime.connected && speakerBusNode) {
          speakerBusNode.connect(runtime.splitter);
          runtime.connected = true;
        }
        if (runtime.audio.paused) await runtime.audio.play();
        if (runtime.playError) {
          runtime.playError = null;
          speakerStatusChanged = true;
        }
      } catch (e) {
        const nextError = e?.name || "PlaybackError";
        if (runtime.playError !== nextError) speakerStatusChanged = true;
        runtime.playError = nextError;
      }
    }

    if (speakerStatusChanged && typeof renderAdditionalOutputSpeakers === "function") {
      renderAdditionalOutputSpeakers();
    }
  }

  async function addAdditionalOutputSpeaker(device) {
    const deviceId = device?.deviceId || "";
    if (!deviceId) return false;
    const normalized = deviceId || "default";
    const mainId = getMainOutputIdentity();

    if (normalized === mainId) {
      toast("現在のスピーカーはすでにメイン出力です");
      return false;
    }
    if (hasAdditionalOutput(normalized)) {
      toast("そのスピーカーは追加済みです");
      return false;
    }

    const label = getOutputDeviceLabel(device, "追加スピーカー");

    const route = {
      deviceId,
      label,
      groupId: device?.groupId || "",
      left: 1,
      right: 1,
      delayMs: 0,
      enabled: true,
      leftChannel: "left",
      rightChannel: "right",
      addedAt: Date.now()
    };

    // 接続に成功してから登録する。失敗した機器を「登録スピーカー」として保存しない。
    const runtime = await createAdditionalOutputRuntime(route);
    if (!runtime) {
      toast("スピーカーを追加できませんでした");
      return false;
    }

    state.outputRoutes.push(route);
    saveState();
    renderAdditionalOutputSpeakers();
    await startOutputBridge();
    renderOutputDeviceAddPicker();
    closeOutputDeviceAddModal();
    toast("スピーカーを追加しました");
    return true;
  }

  function outputDeviceIsDefaultPhysical(device, outputs) {
    const defaultDevice = outputs.find(d => d.deviceId === "default");
    return !!defaultDevice && areSameOutputDevice(defaultDevice, device);
  }

  function getOutputDevicePriority(device) {
    const label = String(device?.label || "").toLowerCase();
    const externalPattern = /(hdmi|displayport|headphone|headset|earphone|bluetooth|usb|wireless|ヘッドホン|ヘッドセット|イヤホン|bluetooth|無線|usb)/i;
    return externalPattern.test(label) ? 0 : 1;
  }

  async function renderOutputDevicePicker() {
    if (!el.outputDeviceList || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const outputs = await ensureOutputDeviceAccess();
      const mainId = getMainOutputIdentity();

      el.outputDeviceList.innerHTML = "";

      const defaultDevice = outputs.find(d => d.deviceId === "default") || { deviceId: "", label: "既定のスピーカー" };
      const physicalOutputs = outputs
        .filter(d => d.deviceId && d.deviceId !== "default")
        .sort((a, b) => {
          const priorityDiff = getOutputDevicePriority(a) - getOutputDevicePriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          return String(a.label || "").localeCompare(String(b.label || ""), "ja");
        });
      const defaultPhysical = physicalOutputs.find(device => areSameOutputDevice(defaultDevice, device));

      const list = [
        ...(defaultPhysical ? [defaultPhysical] : []),
        ...physicalOutputs.filter(device => !defaultPhysical || !areSameOutputDevice(defaultDevice, device)),
        { deviceId: "", label: "既定のスピーカー" }
      ];

      const seen = new Set();
      for (const device of list) {
        const key = device.deviceId || "default";
        if (seen.has(key)) continue;
        seen.add(key);

        const item = document.createElement("div");
        item.className = "outputDeviceItem";

        const info = document.createElement("div");
        info.className = "outputDeviceItemInfo";

        const name = document.createElement("strong");
        appendSpeakerNameContent(name, getOutputDeviceLabel(device, "音声出力デバイス"), false);

        const stateText = document.createElement("small");
        const isMain = key === mainId || (
          key === "default" &&
          defaultPhysical &&
          mainId === defaultPhysical.deviceId
        );
        stateText.textContent = isMain ? "現在使用中" : "";

        info.append(name, stateText);

        const actions = document.createElement("div");
        actions.className = "outputDeviceItemActions";

        const mainBtn = document.createElement("button");
        mainBtn.className = "btn small";
        mainBtn.type = "button";
        mainBtn.textContent = isMain ? "使用中" : "使用する";
        mainBtn.disabled = isMain;
        mainBtn.addEventListener("click", async () => {
          await setMainOutputDevice(device.deviceId || "");
          closeOutputDeviceModal();
        });

        actions.append(mainBtn);
        item.append(info, actions);
        el.outputDeviceList.appendChild(item);
      }

      if (state.mainOutputDeviceId &&
          !outputs.some(device => device.deviceId === state.mainOutputDeviceId) &&
          typeof navigator.mediaDevices?.selectAudioOutput === "function") {
        const recoveryWrap = document.createElement("div");
        recoveryWrap.className = "outputDeviceRecovery";

        const recoveryMessage = document.createElement("div");
        recoveryMessage.className = "outputDeviceRecoveryMessage";
        recoveryMessage.textContent =
          "保存していたスピーカーが現在の出力機器IDと一致しません。再選択すると新しい機器IDで保存し直します。";

        const recoveryButton = document.createElement("button");
        recoveryButton.className = "btn small";
        recoveryButton.type = "button";
        recoveryButton.textContent = "保存済みスピーカーを再選択";
        recoveryButton.addEventListener("click", async () => {
          const device = await requestOutputDevicePermission();
          if (!device?.deviceId) return;
          await setMainOutputDevice(device.deviceId);
          await renderOutputDevicePicker();
        });

        recoveryWrap.append(recoveryMessage, recoveryButton);
        el.outputDeviceList.appendChild(recoveryWrap);
      }

      if (!physicalOutputs.length && typeof navigator.mediaDevices?.selectAudioOutput === "function") {
        const discoverWrap = document.createElement("div");
        discoverWrap.className = "outputDeviceRecovery";

        const discoverMessage = document.createElement("div");
        discoverMessage.className = "outputDeviceRecoveryMessage";
        discoverMessage.textContent =
          "非デフォルトの出力機器は、ブラウザの許可後に一覧へ表示されます。";

        const discoverButton = document.createElement("button");
        discoverButton.className = "btn small";
        discoverButton.type = "button";
        discoverButton.textContent = "接続中の出力機器を読み込む";
        discoverButton.addEventListener("click", async () => {
          try {
            const device = await navigator.mediaDevices.selectAudioOutput();
            if (!device?.deviceId) return;
            await setMainOutputDevice(device.deviceId);
            await renderOutputDevicePicker();
          } catch (e) {
            if (e?.name === "NotAllowedError") {
              toast("ブラウザで出力機器を選ぶ許可がありません。許可操作を行ってから、もう一度機器を選んでください。");
            } else if (e?.name === "NotFoundError") {
              toast("接続中の出力機器が見つかりません。機器を接続してから一覧を再読み込みしてください。");
            } else if (e?.name === "InvalidStateError") {
              toast("このボタンからもう一度実行してください");
            } else {
              toast("出力機器の読み込みに失敗しました");
            }
          }
        });

        discoverWrap.append(discoverMessage, discoverButton);
        el.outputDeviceList.appendChild(discoverWrap);
      }
    } catch (e) {
      el.outputDeviceList.textContent = "出力機器一覧を取得できませんでした。ブラウザの機器選択許可を確認し、再読み込みしてください。";
    }
  }

  async function requestOutputDevicePermission(deviceId = "") {
    if (typeof navigator.mediaDevices?.selectAudioOutput === "function") {
      try {
        const options = deviceId ? { deviceId } : undefined;
        const selected = await navigator.mediaDevices.selectAudioOutput(options);
        if (selected?.deviceId) {
          recentlyGrantedOutputDevice = selected;
          recentlyGrantedOutputDeviceUntil = Date.now() + 5000;
        }
        if (selected?.deviceId && el.outputDevicePermissionStatus) {
          el.outputDevicePermissionStatus.textContent =
            "機器選択の状態: 許可済み（選択した出力機器）";
        }
        return selected?.deviceId ? selected : null;
      } catch (e) {
        if (el.outputDevicePermissionStatus) {
          if (e?.name === "NotAllowedError") {
            el.outputDevicePermissionStatus.textContent =
              "機器選択の状態: 未許可またはブラウザでブロックされています";
          } else if (e?.name === "NotFoundError") {
            el.outputDevicePermissionStatus.textContent =
              "機器選択の状態: 利用できる出力機器がありません";
          } else {
            el.outputDevicePermissionStatus.textContent =
              "機器選択の状態: 選択を完了できませんでした";
          }
        }
        if (e?.name === "NotAllowedError") {
          toast("ブラウザで出力機器を選ぶ許可がありません。許可操作を行ってから、もう一度機器を選んでください。");
        } else if (e?.name === "NotFoundError") {
          toast("接続中の出力機器が見つかりません。機器を接続してから一覧を再読み込みしてください。");
        } else if (e?.name === "InvalidStateError") {
          toast("機器の選択を完了できませんでした。許可ボタンからもう一度操作してください。");
        } else {
          toast("出力機器の選択に失敗しました");
        }
        return null;
      }
    }

    // ChromeではselectAudioOutput()が使えないため、
    // マイク許可で出力機器の列挙・setSinkId()に必要な許可を取得する。
    if (
      typeof navigator.mediaDevices?.getUserMedia !== "function" ||
      typeof navigator.mediaDevices?.enumerateDevices !== "function"
    ) {
      toast("このブラウザでは出力機器一覧の取得に対応していません。ブラウザの対応状況を確認してください。");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());

      const outputs = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = outputs.filter(
        device => device.kind === "audiooutput" && device.deviceId
      );

      if (deviceId) {
        const selected = audioOutputs.find(device => device.deviceId === deviceId);
        if (selected) {
          recentlyGrantedOutputDevice = selected;
          recentlyGrantedOutputDeviceUntil = Date.now() + 5000;
          if (el.outputDevicePermissionStatus) {
            el.outputDevicePermissionStatus.textContent =
              "機器選択の状態: 許可済み（選択可能な出力機器を取得しました）";
          }
          return selected;
        }
      }

      const fallback = audioOutputs.find(device => device.deviceId !== "default") ||
        audioOutputs.find(device => device.deviceId === "default");
      if (fallback) {
        recentlyGrantedOutputDevice = fallback;
        recentlyGrantedOutputDeviceUntil = Date.now() + 5000;
        if (el.outputDevicePermissionStatus) {
          el.outputDevicePermissionStatus.textContent =
            "機器選択の状態: 許可済み（選択可能な出力機器を取得しました）";
        }
        return fallback;
      }

      if (el.outputDevicePermissionStatus) {
        el.outputDevicePermissionStatus.textContent =
          "機器選択の状態: 出力機器を取得できませんでした";
      }
      toast("接続中の出力機器が見つかりません。機器を接続してから一覧を再読み込みしてください。");
      return null;
    } catch (e) {
      if (el.outputDevicePermissionStatus) {
        if (e?.name === "NotAllowedError") {
          el.outputDevicePermissionStatus.textContent =
            "機器選択の状態: ブラウザの機器選択許可または必要なマイク許可を確認してください";
        } else {
          el.outputDevicePermissionStatus.textContent =
            "機器選択の状態: 出力機器を取得できませんでした";
        }
      }
      if (e?.name === "NotAllowedError") {
        toast("利用できる出力機器が表示されない場合は、ブラウザの出力機器選択許可を確認してください。");
      } else {
        toast("出力機器一覧を取得できませんでした。許可を確認してから一覧を再読み込みしてください。");
      }
      return null;
    }
  }
  async function selectOutputDeviceForMain(deviceId = "") {
    // すでに一覧へ取得できている出力機器は、そのままメインへ切り替える。
    // 未取得・未許可の機器だけ、ブラウザの出力機器選択を開く。
    if (deviceId) {
      const outputs = await enumerateAudioOutputs();
      const listedDevice = outputs.find(device => device.deviceId === deviceId);
      if (listedDevice?.deviceId) {
        return await setMainOutputDevice(listedDevice.deviceId);
      }
    }

    const requested = await requestOutputDevicePermission(deviceId);
    if (!requested?.deviceId) return false;
    return await setMainOutputDevice(requested.deviceId);
  }
  async function selectAndAddOutputDevice(deviceId = "") {
    if (deviceId) {
      const outputs = await enumerateAudioOutputs();
      const listedDevice = outputs.find(device => device.deviceId === deviceId);
      if (listedDevice?.deviceId) {
        const added = await addAdditionalOutputSpeaker(listedDevice);
        if (added) return true;
      }
    }

    const device = await requestOutputDevicePermission(deviceId);
    if (!device?.deviceId) return false;
    return await addAdditionalOutputSpeaker(device);
  }

  async function renderOutputDeviceAddPicker() {
    if (!el.outputDeviceAddList || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const outputs = await ensureOutputDeviceAccess();
      const mainId = getMainOutputIdentity();

      el.outputDeviceAddList.innerHTML = "";

      const physicalOutputs = outputs
        .filter(d => d.deviceId && d.deviceId !== "default")
        .sort((a, b) => {
          const priorityDiff = getOutputDevicePriority(a) - getOutputDevicePriority(b);
          if (priorityDiff !== 0) return priorityDiff;
          return String(a.label || "").localeCompare(String(b.label || ""), "ja");
        });
      const seen = new Set();

      for (const device of physicalOutputs) {
        const key = device.deviceId;
        if (seen.has(key)) continue;
        seen.add(key);

        const item = document.createElement("div");
        item.className = "outputDeviceItem";

        const info = document.createElement("div");
        info.className = "outputDeviceItemInfo";

        const name = document.createElement("strong");
        appendSpeakerNameContent(name, getOutputDeviceLabel(device, "音声出力デバイス"), false);

        const stateText = document.createElement("small");
        const isMain = key === mainId || (
          mainId === "default" && outputDeviceIsDefaultPhysical(device, outputs)
        );
        const isAdditional = hasAdditionalOutput(key);
        stateText.textContent = isMain ? "現在使用中" : (isAdditional ? "追加済み" : "");

        info.append(name, stateText);

        const actions = document.createElement("div");
        actions.className = "outputDeviceItemActions";

        const addBtn = document.createElement("button");
        addBtn.className = "btn small";
        addBtn.type = "button";
        addBtn.textContent = isMain ? "使用中" : (isAdditional ? "追加済み" : "追加");
        addBtn.disabled = isMain || isAdditional;
        addBtn.addEventListener("click", () => selectAndAddOutputDevice(device.deviceId || ""));

        actions.append(addBtn);
        item.append(info, actions);
        el.outputDeviceAddList.appendChild(item);
      }

      if (!physicalOutputs.length) {
        const emptyMessage = document.createElement("div");
        emptyMessage.style.color = "var(--muted)";
        emptyMessage.style.fontSize = ".82rem";
        emptyMessage.textContent =
          "接続中の出力機器が一覧にありません。「ブラウザの機器選択を許可」を押し、許可画面で機器を選んでから「接続中の機器を再読み込み」を押してください。";
        el.outputDeviceAddList.appendChild(emptyMessage);
      }
    } catch (e) {
      el.outputDeviceAddList.textContent = "出力機器一覧を取得できませんでした。ブラウザの機器選択許可を確認し、再読み込みしてください。";
    }
  }

  function openOutputDeviceModal() {
    if (!el.outputDeviceModal) return;
    moveOutputDeviceModalsToBody();
    ensureGraph();
    el.outputDeviceModal.hidden = false;
    document.body.classList.add("output-device-modal-open");
    renderOutputDevicePicker();
  }

  function openOutputDeviceAddModal() {
    if (!el.outputDeviceAddModal) return;
    if (el.outputDeviceModal) el.outputDeviceModal.hidden = true;
    moveOutputDeviceModalsToBody();
    ensureGraph();
    el.outputDeviceAddModal.hidden = false;
    document.body.classList.add("output-device-modal-open");
    renderOutputDeviceAddPicker();
  }

  async function chooseMainOutputDevice() {
    openOutputDeviceModal();
  }

  if (el.btnOpenSpeakerAdd) el.btnOpenSpeakerAdd.addEventListener("click", openOutputDeviceAddModal);

  const requestOutputPermissionFromUser = () => {
    // ブラウザ標準の出力機器選択UIは、ユーザー操作から直接呼び出す。
    void requestOutputDevicePermission().then(async device => {
      if (device?.deviceId) {
        await ensureOutputDeviceAccess();
        await renderOutputDevicePicker();
        await renderOutputDeviceAddPicker();
      }
      await updateOutputPermissionStatus();
    });
  };

  if (el.btnRequestOutputPermissionMain) {
    el.btnRequestOutputPermissionMain.addEventListener("click", requestOutputPermissionFromUser);
  }
  if (el.btnRequestOutputPermission) {
    el.btnRequestOutputPermission.addEventListener("click", requestOutputPermissionFromUser);
  }
  if (el.btnSelectOutputDirect) {
    el.btnSelectOutputDirect.addEventListener("click", async () => {
      const device = await requestOutputDevicePermission();
      if (!device?.deviceId) return;
      await setMainOutputDevice(device.deviceId);
      await renderOutputDevicePicker();
    });
  }
  if (el.btnAddOutputSpeaker) el.btnAddOutputSpeaker.addEventListener("click", openOutputDeviceAddModal);
  if (el.btnCloseOutputDeviceModal) el.btnCloseOutputDeviceModal.addEventListener("click", closeOutputDeviceModal);
  if (el.btnCloseOutputDeviceModalBottom) el.btnCloseOutputDeviceModalBottom.addEventListener("click", closeOutputDeviceModal);
  if (el.btnCloseOutputDeviceAddModal) el.btnCloseOutputDeviceAddModal.addEventListener("click", closeOutputDeviceAddModal);
  if (el.btnCloseOutputDeviceAddModalBottom) el.btnCloseOutputDeviceAddModalBottom.addEventListener("click", closeOutputDeviceAddModal);
  if (el.btnRefreshOutputAddList) el.btnRefreshOutputAddList.addEventListener("click", renderOutputDeviceAddPicker);
  if (el.btnDiscoverOutputSpeaker) {
    el.btnDiscoverOutputSpeaker.addEventListener("click", async () => {
      try {
        const device = await requestOutputDevicePermission();
        if (!device?.deviceId) return;

        await ensureOutputDeviceAccess();
        await renderOutputDevicePicker();
        await renderOutputDeviceAddPicker();
        await updateOutputPermissionStatus();

        if (device?.label) {
          toast(device.label + " の出力を許可しました");
        } else {
          toast("出力機器を取得しました");
        }
      } catch (e) {
        toast("出力機器の許可・取得に失敗しました");
        await updateOutputPermissionStatus();
      }
    });
  }

  let lastSystemDefaultOutputDeviceId = null;

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      if (document.visibilityState !== "visible") {
        pendingOutputDeviceRefresh = true;
        return;
      }
      const outputs = await enumerateAudioOutputs();
      await rebindStoredOutputRoutes(outputs);

      const physicalOutputs = outputs.filter(device =>
        device?.kind === "audiooutput" && device.deviceId && device.deviceId !== "default"
      );
      knownPhysicalOutputDeviceIds = new Set(physicalOutputs.map(device => device.deviceId));

      const defaultDevice = outputs.find(device => device.deviceId === "default");
      const defaultPhysical = defaultDevice
        ? physicalOutputs.find(device => areSameOutputDevice(defaultDevice, device))
        : null;
      const nextDefaultId = defaultPhysical?.deviceId || "";

      // OS側の既定出力が実際に変わった場合だけ、新しい機器へメイン出力を切り替える。
      // 切替成功後は追加出力をすべて解除し、新しい既定出力1台だけから再生する。
      if (
        lastSystemDefaultOutputDeviceId !== null &&
        nextDefaultId !== lastSystemDefaultOutputDeviceId
      ) {
        const switched = await setMainOutputDevice(nextDefaultId);
        if (switched) {
          for (const runtime of additionalOutputRuntimes.values()) {
            try { speakerBusNode?.disconnect(runtime.splitter); } catch (e) {}
            try { runtime.audio.pause(); } catch (e) {}
            try { runtime.audio.srcObject = null; } catch (e) {}
            try { runtime.audio.remove(); } catch (e) {}
          }
          additionalOutputRuntimes.clear();
          state.outputRoutes = [];
          saveState();
          applyPairedSpeakerRouting();
          await syncAdditionalOutputRuntimes();
          renderAdditionalOutputSpeakers();
        }
      }
      lastSystemDefaultOutputDeviceId = nextDefaultId;
      pendingOutputDeviceRefresh = false;

      await updateOutputDeviceName();
      await updateDisconnectedOutputDeviceIds();
      await renderOutputDevicePicker();
      await renderOutputDeviceAddPicker();
      await updateOutputPermissionStatus();
      await syncAdditionalOutputRuntimes();
      renderAdditionalOutputSpeakers();
    });
  }

  enumerateAudioOutputs().then(outputs => {
    const physicalOutputs = outputs.filter(device =>
      device?.kind === "audiooutput" && device.deviceId && device.deviceId !== "default"
    );
    knownPhysicalOutputDeviceIds = new Set(physicalOutputs.map(device => device.deviceId));
    const defaultDevice = outputs.find(device => device.deviceId === "default");
    const defaultPhysical = defaultDevice
      ? physicalOutputs.find(device => areSameOutputDevice(defaultDevice, device))
      : null;
    lastSystemDefaultOutputDeviceId = defaultPhysical?.deviceId || "";
  }).catch(error => {
    console.warn("Music Player output device discovery failed:", error);
  });

  updateOutputDeviceName();
  renderAdditionalOutputSpeakers();
  updateOutputPermissionStatus();

  function setClippingProtection(enabled) {
    state.clippingProtection = !!enabled;
    saveState();

    // 音声グラフの実際の構成に合わせ、L/R合成後のメイン出力経路だけを切り替える。
    // finalMixGainNode -> speakerBusNode は追加スピーカーを含む共通経路なので変更しない。
    if (audioCtx && channelMerger && outputSplitter && analyser && limiterNode) {
      try {
        try { channelMerger.disconnect(limiterNode); } catch (e) {}
        try { channelMerger.disconnect(outputSplitter); } catch (e) {}
        try { channelMerger.disconnect(analyser); } catch (e) {}
        try { limiterNode.disconnect(outputSplitter); } catch (e) {}
        try { limiterNode.disconnect(analyser); } catch (e) {}
        // 旧経路が残っていた場合も、共通スピーカーバスへの誤接続を解消する。
        try { limiterNode.disconnect(speakerBusNode); } catch (e) {}
        try { finalMixGainNode?.disconnect(limiterNode); } catch (e) {}

        if (state.clippingProtection) {
          channelMerger.connect(limiterNode);
          limiterNode.connect(outputSplitter);
          limiterNode.connect(analyser);
        } else {
          channelMerger.connect(outputSplitter);
          channelMerger.connect(analyser);
        }
      } catch (e) {
        console.error("Music Player clipping protection routing failed:", e);
      }
    }
    if (el.btnClippingProtection) {
      el.btnClippingProtection.textContent = `音割れ防止: ${state.clippingProtection ? "ON" : "OFF"}`;
      el.btnClippingProtection.classList.toggle("active", state.clippingProtection);
    }
  }

  if (el.btnClippingProtection) {
    el.btnClippingProtection.addEventListener("click", () => setClippingProtection(!state.clippingProtection));
    el.btnClippingProtection.textContent = `音割れ防止: ${state.clippingProtection ? "ON" : "OFF"}`;
    el.btnClippingProtection.classList.toggle("active", state.clippingProtection);
  }

  function getOutputLatencyDiagnostics() {
    if (!audioCtx) return { available: false };
    const baseLatency = Number.isFinite(Number(audioCtx.baseLatency)) ? Number(audioCtx.baseLatency) : null;
    const outputLatency = Number.isFinite(Number(audioCtx.outputLatency)) ? Number(audioCtx.outputLatency) : null;
    const manualDelay = Number(mainDelayNode?.delayTime?.value) || 0;
    let timestamp = null;
    try {
      if (typeof audioCtx.getOutputTimestamp === "function") timestamp = audioCtx.getOutputTimestamp();
    } catch {}
    const contextGapMs = timestamp && Number.isFinite(Number(timestamp.contextTime)) && Number(timestamp.contextTime) >= 0
      ? (audioCtx.currentTime - Number(timestamp.contextTime)) * 1000
      : null;
    const performanceAgeMs = timestamp && Number.isFinite(Number(timestamp.performanceTime)) && Number(timestamp.performanceTime) > 0
      ? performance.now() - Number(timestamp.performanceTime)
      : null;
    const estimatedTotalMs = baseLatency == null || outputLatency == null
      ? null
      : Math.max(0, (baseLatency + outputLatency + manualDelay) * 1000);
    const diagnostics = {
      available: true,
      sampleRate: Number(audioCtx.sampleRate) || null,
      baseLatencyMs: baseLatency == null ? null : Math.round(baseLatency * 1000 * 10) / 10,
      outputLatencyMs: outputLatency == null ? null : Math.round(outputLatency * 1000 * 10) / 10,
      manualDelayMs: Math.round(manualDelay * 1000 * 10) / 10,
      estimatedTotalMs: estimatedTotalMs == null ? null : Math.round(estimatedTotalMs * 10) / 10,
      outputTimestampAvailable: !!timestamp,
      outputTimestampContextGapMs: contextGapMs == null ? null : Math.round(contextGapMs * 10) / 10,
      outputTimestampPerformanceAgeMs: performanceAgeMs == null ? null : Math.round(performanceAgeMs * 10) / 10,
      contextState: audioCtx.state
    };
    window.__musicPlayerOutputLatencyDiagnostics = diagnostics;
    return diagnostics;
  }
  window.__musicPlayerGetOutputLatencyDiagnostics = getOutputLatencyDiagnostics;

  function updateMicMonitorLatencyUI() {
    if (!el.micMonitorLatencyText) return;
    if (!audioCtx) {
      el.micMonitorLatencyText.textContent = "出力遅延診断: AudioContext未初期化";
      return;
    }
    const diagnostics = getOutputLatencyDiagnostics();
    const estimated = diagnostics.estimatedTotalMs == null ? "--" : Math.round(diagnostics.estimatedTotalMs);
    const base = diagnostics.baseLatencyMs == null ? "--" : diagnostics.baseLatencyMs;
    const output = diagnostics.outputLatencyMs == null ? "--" : diagnostics.outputLatencyMs;
    const sync = diagnostics.outputTimestampContextGapMs == null ? "--" : diagnostics.outputTimestampContextGapMs;
    el.micMonitorLatencyText.textContent =
      (state.micMonitor ? "マイクモニター推定: 約" + estimated + " ms" : "マイクモニターOFF") +
      " / 出力遅延: base " + base + " ms + output " + output + " ms" +
      " / 手動補正 " + diagnostics.manualDelayMs + " ms / 出力同期差 " + sync + " ms";
  }

  function updateMicMonitorUI() {
    if (el.btnMicMonitor) {
      el.btnMicMonitor.textContent = `マイクモニター: ${state.micMonitor ? "ON" : "OFF"}`;
      el.btnMicMonitor.classList.toggle("active", state.micMonitor);
    }
    if (el.micMonitorVolume) el.micMonitorVolume.value = currentMicMonitorVolumeTarget;
    if (el.micMonitorVolumeText) {
      el.micMonitorVolumeText.textContent = `${Math.round(currentMicMonitorVolumeTarget * 100)}%`;
    }
    updateMicMonitorLatencyUI();
  }

  function stopMicFeedbackMonitor() {
    if (micFeedbackTimer) {
      clearInterval(micFeedbackTimer);
      micFeedbackTimer = null;
    }
    micFeedbackHighSimilarityFrames = 0;
    micFeedbackStableFrames = 0;
    if (micFeedbackGainNode && audioCtx) {
      micFeedbackGainNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.15);
    }
    if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "";
  }

  function micFeedbackSimilarity() {
    if (!state.micFeedbackProtection ||
        !state.micMonitor ||
        !micFeedbackAnalyser ||
        !micReferenceAnalyser ||
        !micFeedbackData ||
        !micReferenceData) {
      return { similarity: 0, micEnergy: 0, referenceEnergy: 0 };
    }

    micFeedbackAnalyser.getByteFrequencyData(micFeedbackData);
    micReferenceAnalyser.getByteFrequencyData(micReferenceData);

    let dot = 0;
    let micEnergy = 0;
    let referenceEnergy = 0;
    let micPeak = 0;
    let micPeakBin = 0;

    for (let i = 1; i < micFeedbackData.length; i++) {
      const micValue = micFeedbackData[i] / 255;
      const referenceValue = micReferenceData[i] / 255;
      dot += micValue * referenceValue;
      micEnergy += micValue * micValue;
      referenceEnergy += referenceValue * referenceValue;

      if (micValue > micPeak) {
        micPeak = micValue;
        micPeakBin = i;
      }
    }

    if (micEnergy < 0.002 || referenceEnergy < 0.004) {
      return { similarity: 0, micEnergy, referenceEnergy };
    }

    const cosine = dot / Math.sqrt(micEnergy * referenceEnergy);
    const localReference = micReferenceData[Math.min(micPeakBin, micReferenceData.length - 1)] / 255;
    const peakSupport = localReference > 0.12 ? 1 : 0;

    return {
      similarity: peakSupport ? cosine : cosine * 0.75,
      micEnergy,
      referenceEnergy
    };
  }

  function updateMicFeedbackProtection() {
    if (!state.micFeedbackProtection || !state.micMonitor || !micFeedbackGainNode || !audioCtx) {
      if (micFeedbackGainNode && audioCtx) {
        micFeedbackGainNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.15);
      }
      micFeedbackHighSimilarityFrames = 0;
      micFeedbackStableFrames = 0;
      if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "";
      return;
    }

    const result = micFeedbackSimilarity();
    const similarity = result.similarity;

    let micPeak = 0;
    if (micFeedbackData?.length) {
      for (let i = 0; i < micFeedbackData.length; i++) {
        micPeak = Math.max(micPeak, (micFeedbackData[i] || 0) / 255);
      }
    }
    if (el.micClipStatus) {
      el.micClipStatus.textContent = micPeak >= 0.96
        ? "マイク入力が大きすぎます"
        : "";
    }
    const micEnergy = result.micEnergy;
    const referenceEnergy = result.referenceEnergy;
    const referenceDominance = referenceEnergy > 0
      ? Math.min(1, referenceEnergy / Math.max(0.0001, micEnergy))
      : 0;

    if (similarity >= 0.90) {
      micFeedbackHighSimilarityFrames += 1;
      micFeedbackStableFrames += 1;
    } else {
      micFeedbackHighSimilarityFrames = Math.max(0, micFeedbackHighSimilarityFrames - 1);
      micFeedbackStableFrames = Math.max(0, micFeedbackStableFrames - 1);
    }

    const isLikelyFeedback =
      micFeedbackHighSimilarityFrames >= 5 &&
      micFeedbackStableFrames >= 5 &&
      referenceDominance >= 0.90;

    // 声などのマイク成分が優勢なら全体を強くミュートせず、
    // スピーカー由来成分が優勢なときだけ強く抑制する。
    let targetGain = 1;
    let timeConstant = 0.20;

    if (isLikelyFeedback) {
      const voicePreserve = Math.max(0, Math.min(1, 1 - referenceDominance));
      const baseGain = 0.12 + voicePreserve * 0.48;
      const strength = Math.max(0, Math.min(1, Number(state.micFeedbackStrength) || 0));
      targetGain = 1 - (1 - baseGain) * strength;
      timeConstant = 0.035;
      if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "ハウリング抑制中";
    } else if (similarity >= 0.82 && referenceDominance >= 0.75) {
      const strength = Math.max(0, Math.min(1, Number(state.micFeedbackStrength) || 0));
      targetGain = 1 - (1 - 0.70) * strength;
      timeConstant = 0.09;
      if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "反響成分を抑制中";
    } else {
      if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "";
    }

    micFeedbackGainNode.gain.setTargetAtTime(targetGain, audioCtx.currentTime, timeConstant);
  }

  function startMicFeedbackMonitor() {
    stopMicFeedbackMonitor();
    if (!state.micFeedbackProtection) return;
    micFeedbackTimer = setInterval(updateMicFeedbackProtection, 50);
  }

  function updateMicFeedbackProtectionUI() {
    // ハウリング防止は常時ON。設定項目としての切り替えUIは表示しない。
    state.micFeedbackProtection = true;
    if (el.micFeedbackStatus) el.micFeedbackStatus.textContent = "";
  }

  async function setMicFeedbackProtectionEnabled(enabled) {
    const wasMonitoring = state.micMonitor;
    state.micFeedbackProtection = true;
    saveState();
    updateMicFeedbackProtectionUI();

    if (wasMonitoring) {
      await setMicMonitorEnabled(false);
      await setMicMonitorEnabled(true);
    }
  }

  function stopMicMonitor() {
    stopMicFeedbackMonitor();
    if (micSourceNode) {
      try { micSourceNode.disconnect(); } catch (e) {}
      micSourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      micStream = null;
    }
  }

  function updateMicMonitorVolumeUI(value) {
    const n = Number(value);
    currentMicMonitorVolumeTarget = Math.max(0, Math.min(2, Number.isFinite(n) ? n : 1));
    state.micMonitorVolume = currentMicMonitorVolumeTarget;
    if (micGainNode) {
      micGainNode.gain.setTargetAtTime(
        currentMicMonitorVolumeTarget,
        audioCtx ? audioCtx.currentTime : 0,
        0.045
      );
    }
    updateMicMonitorUI();
    saveState();
  }

  async function setMicMonitorEnabled(enabled) {
    state.micMonitor = !!enabled;
    const requestId = ++micMonitorRequestId;
    updateMicMonitorUI();

    if (!state.micMonitor) {
      stopMicMonitor();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      state.micMonitor = false;
      updateMicMonitorUI();
      toast("このブラウザではマイク入力を利用できません");
      return;
    }

    ensureGraph();
    if (audioCtx && audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch {}
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { ideal: "default" },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 },
          latency: { ideal: 0 }
        }
      });

      if (requestId !== micMonitorRequestId || !state.micMonitor) {
        stream.getTracks().forEach(track => {
          try { track.stop(); } catch (e) {}
        });
        return;
      }

      stopMicMonitor();
      micStream = stream;
      micSourceNode = audioCtx.createMediaStreamSource(stream);
      micGainNode.gain.value = currentMicMonitorVolumeTarget;

      // マイクモニターは最短経路を優先し、入力→音量→最終ミックスへ直接接続する。
      // ハウリング検出用の解析系は並列に接続し、音声経路には入れない。
      micSourceNode.connect(micGainNode);
      micSourceNode.connect(micFeedbackGainNode);
      micFeedbackGainNode.connect(micFeedbackAnalyser);
      startMicFeedbackMonitor();
      toast("マイクモニターを開始しました");

      const track = stream.getAudioTracks()[0];
      if (track) {
        track.addEventListener("ended", () => {
          if (micStream !== stream) return;
          stopMicMonitor();
          state.micMonitor = false;
          updateMicMonitorUI();
          toast("マイクが切断されたため、マイクモニターをOFFにしました");
        });
      }
    } catch (e) {
      if (requestId !== micMonitorRequestId) return;
      state.micMonitor = false;
      stopMicMonitor();
      updateMicMonitorUI();

      const message = e?.name === "NotAllowedError"
        ? "マイクの使用が許可されていません。サイトのマイク権限も確認してください"
        : e?.name === "NotFoundError"
          ? "使用できるマイクが見つかりません"
          : e?.name === "NotReadableError"
            ? "マイクは見つかりましたが、別のアプリで使用中などの理由で読み取れません"
            : "マイクを開始できませんでした";
      toast(message);
    }
  }

  if (el.btnMicMonitor) {
    el.btnMicMonitor.addEventListener("click", () => {
      setMicMonitorEnabled(!state.micMonitor);
    });
  }

  if (el.micMonitorVolume) {
    el.micMonitorVolume.value = currentMicMonitorVolumeTarget;
    el.micMonitorVolume.addEventListener("input", e => {
      updateMicMonitorVolumeUI(e.target.value);
    });
  }
  updateMicMonitorUI();
  updateMicFeedbackProtectionUI();
  setInterval(updateMicMonitorLatencyUI, 500);

  if (el.btnMicFeedbackProtection) {
    el.btnMicFeedbackProtection.disabled = true;
    el.btnMicFeedbackProtection.setAttribute("aria-disabled", "true");
  }

  function updateMicFeedbackStrength(value) {
    const n = Math.max(0, Math.min(1, Number(value) / 100));
    const percent = Math.round(n * 100);
    state.micFeedbackStrength = n;
    const strengthInput = el.micFeedbackStrength || document.getElementById("micFeedbackStrength");
    const strengthText = el.micFeedbackStrengthText || document.getElementById("micFeedbackStrengthText");
    if (strengthInput) strengthInput.value = String(percent);
    if (strengthText) strengthText.textContent = percent + "%";
    saveState();
  }

  if (el.micFeedbackStrength) {
    el.micFeedbackStrength.value = String(Math.round(state.micFeedbackStrength * 100));
    el.micFeedbackStrength.addEventListener("input", e => updateMicFeedbackStrength(e.target.value));
    el.micFeedbackStrength.addEventListener("change", e => updateMicFeedbackStrength(e.target.value));
  }
  if (el.micFeedbackStrengthText) {
    el.micFeedbackStrengthText.textContent = Math.round(state.micFeedbackStrength * 100) + "%";
  }
