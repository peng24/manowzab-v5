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

    // ✅ Regex to remove ALL Emojis (Surrogates, Dingbats, Transport, etc.)
    // This covers: 🎄, 🥳, 🙏, etc.
    const emojiRegex =
      /([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD10-\uDDFF]|\uD83F[\uDC00-\uDFFF]|[\u2000-\u26FF])/g;

    // Replace emoji with empty string
    let cleanText = text.replace(emojiRegex, "");

    // Remove specific special chars that might annoy TTS (optional)
    cleanText = cleanText.replace(/[#*~_]/g, "");

    // Clean up double spaces
    cleanText = cleanText.replace(/\s+/g, " ").trim();

    // Limit length (prevent too long speech)
    if (cleanText.length > 500) {
      cleanText = cleanText.substring(0, 500);
    }

    return cleanText;
  }

  /**
   * Convert Base64 string to Blob object
   */
  base64ToBlob(base64, type = "audio/mp3") {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type });
  }

  /**
   * Speak using Google Cloud TTS API with key rotation
   */
  async speakOnline(text) {
    const systemStore = useSystemStore.getState();

    // Parse comma-separated keys
    const rawKeys = systemStore.googleApiKey;
    const keys = rawKeys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);

    // Check if any keys exist
    if (keys.length === 0) {
      console.warn("⚠️ No Google API Keys found, falling back to Native TTS");
      this.speakNative(text);
      return;
    }

    // Sanitize and limit text
    const sanitized = this.sanitize(text);
    const safeText = sanitized.substring(0, 500); // Limit for API (Aligned with sanitize)

    console.log(
      `☁️ Google Cloud TTS: ${safeText.substring(0, 50)}... (${keys.length} keys available)`,
    );

    // Rotate keys sequentially, starting from the machine's assigned activeKeyIndex
    const startIndex = (systemStore.activeKeyIndex || 1) - 1;

    for (let count = 0; count < keys.length; count++) {
      const i = (startIndex + count) % keys.length;
      const currentKey = keys[i];

      try {
        console.log(`🔑 Trying key ${i + 1}/${keys.length}...`);

        // Create AbortController with 2-second timeout (fast fallback)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        // Call Google Cloud TTS API
        const response = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${currentKey}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              input: { text: safeText },
              // ✅ Config for Bright & Enthusiastic Female Voice
              voice: {
                languageCode: "th-TH",
                name: "th-TH-Standard-A", // Female Voice
              },
              audioConfig: {
                audioEncoding: "MP3",
                speakingRate: 1.0, // ✅ Standard Speed (Factory Default)
                pitch: 0.0, // ✅ Natural Pitch (Factory Default)
              },
            }),
            signal: controller.signal, // Bind abort signal
          },
        );

        // Clear timeout on success
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();

        // ✅ Convert Base64 to ArrayBuffer for AudioContext decoding
        const binaryString = atob(data.audioContent);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let j = 0; j < len; j++) {
          bytes[j] = binaryString.charCodeAt(j);
        }

        // ✅ Ensure AudioContext is running (auto-resume for iPad idle)
        const isReady = await this.ensureAudioContextReady();
        if (!isReady) {
          console.warn("⚠️ AudioContext not running after resume — falling back to Native");
          this.consecutiveGoogleFailures++;
          this.speakNative(text);
          return;
        }

        try {
          const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
          this.currentSource = this.audioCtx.createBufferSource();
          this.currentSource.buffer = audioBuffer;
          this.currentSource.connect(this.audioCtx.destination);

          // ✅ Guard against double processQueue calls
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

          // Update active key index in store and sync if fallback key succeeded
          const systemStore2 = useSystemStore.getState();
          if (systemStore2.activeKeyIndex !== i + 1) {
            useSystemStore.setState({ activeKeyIndex: i + 1 });
            systemStore2.updatePresenceTtsKey(); // ✅ Show other machines we took this key
          }

          // ✅ Reset failure counter on success
          this.consecutiveGoogleFailures = 0;
          console.log(`✅ Google TTS success with key ${i + 1}`);
          return; // Success! Exit the function
        } catch (decodeErr) {
          console.error("❌ Audio decode error:", decodeErr);
          this.clearStuckTimer();
          this.isSpeaking = false;
          this.speakNative(text);
          this.startStuckTimer();
          return;
        }
      } catch (error) {
        // 🚨 CASE 1: Timeout (Internet Lag / iPad idle)
        if (error.name === "AbortError") {
          this.consecutiveGoogleFailures++;
          console.warn(
            `⏳ Key ${i + 1} timed out (${this.consecutiveGoogleFailures}/${this.MAX_CONSECUTIVE_FAILURES} fails). Fallback to Native.`,
          );
          this._checkPermanentSwitch();
          this.speakNative(text);
          return;
        }

        // 🚨 CASE 2: API Error (403 Quota / 500)
        console.warn(`⚠️ Key ${i + 1} failed: ${error.message}`);

        // If this was the last key, and all failed
        if (i === keys.length - 1) {
          this.consecutiveGoogleFailures++;
          console.error(
            `❌ All Google Keys failed (${this.consecutiveGoogleFailures}/${this.MAX_CONSECUTIVE_FAILURES} consecutive fails).`,
          );
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

      if (voice) {
        utterance.voice = voice;
      }

      console.log(
        "🎙️ Native TTS:",
        text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      );

      // Push to global array to prevent garbage collection
      window.ttsActiveUtterances.push(utterance);

      // ✅ Guard against double-fire
      let hasEnded = false;
      const cleanupAndAdvance = () => {
        if (hasEnded) return;
        hasEnded = true;
        const index = window.ttsActiveUtterances.indexOf(utterance);
        if (index > -1) {
          window.ttsActiveUtterances.splice(index, 1);
        }
        this.clearStuckTimer();
        if (this._currentOnComplete) {
          this._currentOnComplete();
          this._currentOnComplete = null;
        }
        this.isSpeaking = false;
        this.processQueue();
      };

      // Handle end
      utterance.onend = cleanupAndAdvance;

      // Handle error
      utterance.onerror = (e) => {
        // Ignore "interrupted" error to reduce console noise during mode switching
        if (e.error === "interrupted") return;
        console.error("❌ Native TTS Error:", e);
        cleanupAndAdvance();
      };

      // Speak
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      // ✅ Catch-all: ensure queue never stalls on unexpected errors
      console.error("❌ Native TTS setup failed:", e);
      this.clearStuckTimer();
      if (this._currentOnComplete) {
        this._currentOnComplete();
        this._currentOnComplete = null;
      }
      this.isSpeaking = false;
      this.processQueue();
    }
  }

  /**
   * ✅ Clear stuck detection timer
   */
  clearStuckTimer() {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }

  /**
   * ✅ Start stuck detection timer — auto-resets if isSpeaking for too long
   */
  startStuckTimer() {
    this.clearStuckTimer();
    this.stuckTimer = setTimeout(() => {
      if (this.isSpeaking) {
        console.warn(
          `⚠️ TTS stuck for ${this.STUCK_TIMEOUT / 1000}s — auto-resetting queue`,
        );
        // ✅ Resolve pending Promise before moving on (prevents outer queue deadlock)
        if (this._currentOnComplete) {
          this._currentOnComplete();
          this._currentOnComplete = null;
        }
        this.isSpeaking = false;
        this.processQueue();
      }
    }, this.STUCK_TIMEOUT);
  }

  /**
   * ✅ Check if Google TTS should be permanently disabled
   */
  _checkPermanentSwitch() {
    if (
      this.consecutiveGoogleFailures >= this.MAX_CONSECUTIVE_FAILURES &&
      !this.googleDisabledPermanently
    ) {
      this.googleDisabledPermanently = true;
      console.error(
        `🔴 Google TTS failed ${this.consecutiveGoogleFailures} times consecutively — switching to Native TTS permanently for this session.`,
      );
    }
  }

  /**
   * Process queue based on system store setting
   */
  async processQueue() {
    // Stop if queue empty or already speaking
    if (this.queue.length === 0 || this.isSpeaking) {
      return;
    }

    this.isSpeaking = true;
    const item = this.queue.shift();
    const text = typeof item === "string" ? item : item.text;
    this._currentOnComplete = typeof item === "object" ? item.onComplete : null;

    // ✅ Auto-resume AudioContext before speaking (iPad idle recovery)
    await this.ensureAudioContextReady();

    // ✅ Start stuck detection timer
    this.startStuckTimer();

    // Check system store setting
    const systemStore = useSystemStore.getState();

    if (
      systemStore.useOnlineTts &&
      systemStore.googleApiKey &&
      !this.googleDisabledPermanently
    ) {
      this.speakOnline(text);
    } else {
      this.speakNative(text);
    }
  }

  /**
   * Add message to queue and return a Promise that resolves when speech finishes.
   * @returns {Promise<void>}
   */
  speak(author, message) {
    const sanitized = this.sanitize(message);
    if (!sanitized) return Promise.resolve();

    // Combine author and message
    const textToSpeak = author ? `${author} ... ${sanitized}` : sanitized;

    return new Promise((resolve) => {
      // Add to queue with a completion callback
      this.queue.push({ text: textToSpeak, onComplete: resolve });

      // Process queue
      this.processQueue();

      // Fallback timeout: ensure the Promise always resolves (max 20s)
      setTimeout(() => resolve(), 20000);
    });
  }

  /**
   * Reset TTS
   */
  reset() {
    // ✅ Clear stuck timer first
    this.clearStuckTimer();

    // ✅ Stop current AudioContext source (replaces audioPlayer cleanup)
    if (this.currentSource) {
      try {
        this.currentSource.onended = null; // Remove listener first
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (e) {
        // Ignore — source may already be stopped
      }
      this.currentSource = null;
    }

    // Stop native speech synthesis
    window.speechSynthesis.cancel();

    // Clear queue and state — resolve any pending onComplete callbacks
    this.queue.forEach((item) => {
      if (typeof item === "object" && item.onComplete) item.onComplete();
    });
    this.queue = [];
    if (this._currentOnComplete) {
      this._currentOnComplete();
      this._currentOnComplete = null;
    }
    this.isSpeaking = false;
    window.ttsActiveUtterances = []; // Clear native utterances ref

    console.log("🔄 TTS Reset (Clean)");
  }
}

// Singleton Instance
export const ttsService = new TextToSpeech();
