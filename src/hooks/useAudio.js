import { useSystemStore } from "../stores/systemStore";
import { ttsService } from "../services/TextToSpeech";

// Global Singleton AudioContext
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Global Unified Audio Queue
const audioQueue = [];
let isAudioProcessing = false;
let activeOscillators = [];

export function useAudio() {
  const isSoundOn = useSystemStore(state => state.isSoundOn);

  const playSfx = (type = "success") => {
    return new Promise(async (resolve) => {
      try {
        if (!isSoundOn) return;

        if (audioCtx && audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        if (!audioCtx) return;

        const ctx = audioCtx;
        const now = ctx.currentTime;

        activeOscillators.forEach((osc) => {
          try {
            osc.stop();
            osc.disconnect();
          } catch (e) {}
        });
        activeOscillators = [];

        if (type === "success") {
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.type = "sine";
          osc1.frequency.setValueAtTime(1200, now);
          gain1.gain.setValueAtTime(0.03, now);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
          osc1.connect(gain1);
          gain1.connect(ctx.destination);
          osc1.start(now);
          osc1.stop(now + 0.4);

          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = "sine";
          osc2.frequency.setValueAtTime(1600, now);
          gain2.gain.setValueAtTime(0.02, now);
          gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(now);
          osc2.stop(now + 0.3);

          activeOscillators.push(osc1, osc2);
        } else if (type === "error") {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(250, now);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.3);
          activeOscillators.push(osc);
        } else if (type === "cancel") {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(600, now);
          osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.15);
          activeOscillators.push(osc);
        }
      } catch (err) {
        console.warn("⚠️ SFX Playback skipped:", err);
      } finally {
        resolve();
      }
    });
  };

  const resetVoice = () => {
    audioQueue.length = 0;
    activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) {}
    });
    activeOscillators = [];
    ttsService.reset();
    isAudioProcessing = false;
  };

  const processAudioQueue = async () => {
    if (isAudioProcessing || audioQueue.length === 0) return;
    isAudioProcessing = true;

    const task = audioQueue.shift();
    const QUEUE_SAFETY_TIMEOUT = 20000;

    try {
      if (task.sfxType) {
        await playSfx(task.sfxType);
      }
      if (task.message) {
        const ttsPromise = ttsService.speak(task.author, task.message);
        if (ttsPromise instanceof Promise) {
          await Promise.race([
            ttsPromise.catch((e) => console.warn("TTS Error:", e)),
            new Promise((resolve) => setTimeout(resolve, QUEUE_SAFETY_TIMEOUT)),
          ]);
        }
      }
    } catch (err) {
      console.error("Audio Queue Error:", err);
    } finally {
      isAudioProcessing = false;
      setTimeout(() => processAudioQueue(), 0);
    }
  };

  const queueAudio = (sfxType, author, message) => {
    if (!isSoundOn) return;
    audioQueue.push({ sfxType, author, message });
    processAudioQueue();
  };

  return {
    queueAudio,
    playSfx,
    resetVoice,
  };
}
