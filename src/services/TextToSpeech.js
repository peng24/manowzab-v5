import { useSystemStore } from "../stores/systemStore";

// ✅ Global Storage to Prevent Garbage Collection
window.ttsActiveUtterances = [];

export class TextToSpeech {
  constructor() {
    this.queue = [];
    this.isSpeaking = false;
    this.voices = [];
    this.poller = null;
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    this.currentSource = null; // ✅ Track active AudioBufferSource
    this.stuckTimer = null; // ✅ Safety timer to detect stuck state
    this.STUCK_TIMEOUT = 15000; // ✅ 15 seconds max per utterance
    this.consecutiveGoogleFailures = 0; // ✅ Track consecutive Google TTS failures
    this.MAX_CONSECUTIVE_FAILURES = 5; // ✅ Switch to Native permanently after N failures
    this.googleDisabledPermanently = false; // ✅ Flag for permanent Native mode
    this.googleCooldownUntil = 0; // ✅ Timestamp to retry Google TTS after failure

    // Bind methods
    this.processQueue = this.processQueue.bind(this);
    this.loadVoices = this.loadVoices.bind(this);

    // Set up voice loading
    window.speechSynthesis.onvoiceschanged = this.loadVoices;
    this.loadVoices();

    // Aggressive poller: Check every 500ms until voices load
    this.poller = setInterval(this.loadVoices, 500);
  }

  /**
   * Load voices
   */
  loadVoices() {
    const vs = window.speechSynthesis.getVoices();

    if (vs.length === 0) {
      return;
    }

    this.voices = vs;

    // Clear poller once voices are loaded
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }

    console.log("🔍 Loaded " + this.voices.length + " voices.");
  }

  /**
   * ✅ Auto-resume AudioContext — recovers from iPad idle suspension
   * Called before every speak attempt to ensure audio is ready
   */
  async ensureAudioContextReady() {
    try {
      if (this.audioCtx.state === "suspended") {
        console.log("🔄 AudioContext suspended — attempting auto-resume...");
        await this.audioCtx.resume();
        console.log("✅ AudioContext resumed successfully");
      }
      return this.audioCtx.state === "running";
    } catch (e) {
      console.warn("⚠️ AudioContext auto-resume failed:", e);
      return false;
    }
  }

  /**
   * Get best Thai voice
   * Priority: Google Thai > Premwadee/Pattara > Narisa > lang=th
   */
  getBestVoice() {
    if (this.voices.length === 0) {
      this.loadVoices();
      return null;
    }

    // Priority 1: Google Thai
    let voice = this.voices.find(
      (v) =>
        v.name.includes("Google") &&
        (v.name.includes("Thai") || v.name.includes("ไทย")),
    );
    if (voice) return voice;

    // Priority 2: Microsoft (Premwadee/Pattara)
    voice = this.voices.find(
      (v) => v.name.includes("Premwadee") || v.name.includes("Pattara"),
    );
    if (voice) return voice;

    // Priority 3: Apple Narisa
    voice = this.voices.find((v) => v.name.includes("Narisa"));
    if (voice) return voice;

    // Priority 4: Any Thai voice
    voice = this.voices.find((v) => v.lang.startsWith("th"));
    if (voice) return voice;

    return null;
  }

  /**
   * Sanitize text for TTS: Remove Emojis and Symbols
   */
  sanitize(text) {
    if (!text) return "";

    const emojiRegex =
      /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF]|\uD83F[\uDC00-\uDFFF]|[\u2000-\u26FF])/g;

    let cleanText = text.replace(emojiRegex, "");
    cleanText = cleanText.replace(/[#*~_]/g, "");
    cleanText = cleanText.replace(/\s+/g, " ").trim();

    if (cleanText.length > 500) {
      cleanText = cleanText.substring(0, 500);
    }

    return cleanText;
  }

  /**
   * Speak using Google Cloud TTS API with key rotation
   */
  async speakOnline(text) {
    const systemStore = useSystemStore.getState();

    const rawKeys = systemStore.googleApiKey;
    const keys = rawKeys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);

    if (keys.length === 0) {
      console.warn("⚠️ No Google API Keys found, falling back to Native TTS");
      this.speakNative(text);
      return;
    }

    const sanitized = this.sanitize(text);
    const safeText = sanitized.substring(0, 500);

    console.log(
      `☁️ Google Cloud TTS: ${safeText.substring(0, 50)}... (${keys.length} keys available)`,
    );

    const startIndex = (systemStore.activeKeyIndex || 1) - 1;

    for (let count = 0; count < keys.length; count++) {
      const i = (startIndex + count) % keys.length;
      const currentKey = keys[i];

      try {
        console.log(`🔑 Trying key ${i + 1}/${keys.length}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${currentKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input: { text: safeText },
              voice: { languageCode: "th-TH", name: "th-TH-Standard-A" },
              audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0.0 },
            }),
            signal: controller.signal,
          },
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const isQuotaError = response.status === 403 || response.status === 429;
          if (isQuotaError) {
            console.warn(`🚨 Key #${i+1} Quota Exceeded (${response.status})`);
          }
          throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const binaryString = atob(data.audioContent);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) bytes[j] = binaryString.charCodeAt(j);

        const isReady = await this.ensureAudioContextReady();
        if (!isReady) {
          console.warn("⚠️ AudioContext not running — falling back to Native");
          this.consecutiveGoogleFailures++;
          this.speakNative(text);
          return;
        }

        try {
          const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
          this.currentSource = this.audioCtx.createBufferSource();
          this.currentSource.buffer = audioBuffer;
          this.currentSource.connect(this.audioCtx.destination);

          let hasEnded = false;
          const advanceQueue = () => {
            if (hasEnded) return;
            hasEnded = true;
            this.clearStuckTimer();
            if (this._currentOnComplete) {
              this._currentOnComplete();
              this._currentOnComplete = null;
            }
            this.isSpeaking = false;
            this.currentSource = null;
            this.processQueue();
          };

          this.currentSource.onended = advanceQueue;
          this.currentSource.start(0);

          if (systemStore.activeKeyIndex !== i + 1) {
            useSystemStore.setState({ activeKeyIndex: i + 1 });
            systemStore.updatePresenceTtsKey();
          }

          this.consecutiveGoogleFailures = 0;
          this.googleCooldownUntil = 0;
          console.log(`✅ Google TTS success with key ${i + 1}`);
          return;
        } catch (decodeErr) {
          console.error("❌ Audio decode error:", decodeErr);
          this.clearStuckTimer();
          this.isSpeaking = false;
          this.speakNative(text);
          this.startStuckTimer();
          return;
        }
      } catch (error) {
        if (error.name === "AbortError") {
          this.consecutiveGoogleFailures++;
          console.warn(`⏳ Key ${i + 1} timed out.`);
        } else {
          console.warn(`⚠️ Key ${i + 1} failed: ${error.message}`);
        }

        if (count === keys.length - 1) {
          this.consecutiveGoogleFailures++;
          this.googleCooldownUntil = Date.now() + (5 * 60 * 1000); // 5 min cooldown
          console.error(`❌ All Google Keys failed. 5-min cooldown. Retrying at: ${new Date(this.googleCooldownUntil).toLocaleTimeString()}`);
          this._checkPermanentSwitch();
          this.speakNative(text);
        }
      }
    }
  }

  /**
   * Speak using native browser TTS
   */
  speakNative(text) {
    try {
      const voice = this.getBestVoice();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "th-TH";
      utterance.volume = 1.0;
      utterance.rate = 1.0;
      if (voice) utterance.voice = voice;

      console.log("🎙️ Native TTS:", text.substring(0, 50) + (text.length > 50 ? "..." : ""));
      window.ttsActiveUtterances.push(utterance);

      let hasEnded = false;
      const cleanupAndAdvance = () => {
        if (hasEnded) return;
        hasEnded = true;
        const index = window.ttsActiveUtterances.indexOf(utterance);
        if (index > -1) window.ttsActiveUtterances.splice(index, 1);
        this.clearStuckTimer();
        if (this._currentOnComplete) {
          this._currentOnComplete();
          this._currentOnComplete = null;
        }
        this.isSpeaking = false;
        this.processQueue();
      };

      utterance.onend = cleanupAndAdvance;
      utterance.onerror = (e) => {
        if (e.error === "interrupted") return;
        console.error("❌ Native TTS Error:", e);
        cleanupAndAdvance();
      };
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("❌ Native TTS setup failed:", e);
      this.clearStuckTimer();
      if (this._currentOnComplete) { this._currentOnComplete(); this._currentOnComplete = null; }
      this.isSpeaking = false;
      this.processQueue();
    }
  }

  clearStuckTimer() {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }

  startStuckTimer() {
    this.clearStuckTimer();
    this.stuckTimer = setTimeout(() => {
      if (this.isSpeaking) {
        console.warn(`⚠️ TTS stuck for ${this.STUCK_TIMEOUT / 1000}s — auto-resetting queue`);
        if (this._currentOnComplete) { this._currentOnComplete(); this._currentOnComplete = null; }
        this.isSpeaking = false;
        this.processQueue();
      }
    }, this.STUCK_TIMEOUT);
  }

  _checkPermanentSwitch() {
    if (this.consecutiveGoogleFailures >= this.MAX_CONSECUTIVE_FAILURES && !this.googleDisabledPermanently) {
      this.googleDisabledPermanently = true;
      console.error(`🔴 Google TTS failed ${this.consecutiveGoogleFailures} times — permanent Native TTS.`);
    }
  }

  async processQueue() {
    if (this.queue.length === 0 || this.isSpeaking) return;
    this.isSpeaking = true;
    const item = this.queue.shift();
    const text = typeof item === "string" ? item : item.text;
    this._currentOnComplete = typeof item === "object" ? item.onComplete : null;

    await this.ensureAudioContextReady();
    this.startStuckTimer();

    const systemStore = useSystemStore.getState();
    const isCoolingDown = Date.now() < this.googleCooldownUntil;

    if (systemStore.useOnlineTts && systemStore.googleApiKey && !this.googleDisabledPermanently && !isCoolingDown) {
      this.speakOnline(text);
    } else {
      if (isCoolingDown) console.log("🧊 Google TTS is cooling down... using Native.");
      this.speakNative(text);
    }
  }

  speak(author, message) {
    const sanitized = this.sanitize(message);
    if (!sanitized) return Promise.resolve();
    const textToSpeak = author ? `${author} ... ${sanitized}` : sanitized;
    return new Promise((resolve) => {
      this.queue.push({ text: textToSpeak, onComplete: resolve });
      this.processQueue();
      setTimeout(() => resolve(), 20000);
    });
  }

  reset() {
    this.clearStuckTimer();
    if (this.currentSource) {
      try { this.currentSource.onended = null; this.currentSource.stop(); this.currentSource.disconnect(); } catch (e) {}
      this.currentSource = null;
    }
    window.speechSynthesis.cancel();
    this.queue.forEach((item) => { if (typeof item === "object" && item.onComplete) item.onComplete(); });
    this.queue = [];
    if (this._currentOnComplete) { this._currentOnComplete(); this._currentOnComplete = null; }
    this.isSpeaking = false;
    window.ttsActiveUtterances = [];
    console.log("🔄 TTS Reset (Clean)");
  }
}

export const ttsService = new TextToSpeech();
