import confetti from "canvas-confetti";

// Preload cache variables
let celebrationAudioBuffer = null;
let audioContext = null;

// ✅ Preload the audio file into memory immediately when the app loads
export async function preloadCelebrationAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = new AudioContextClass();

    // Fetch the MP3 file once
    const response = await fetch(
      "https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3",
    );
    const arrayBuffer = await response.arrayBuffer();

    // Decode into AudioBuffer for instant, zero-latency playback
    celebrationAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    console.log("🎉 Celebration audio preloaded successfully!");
  } catch (err) {
    console.warn("⚠️ Failed to preload celebration audio:", err);
  }
}

// Start preloading in the background
preloadCelebrationAudio();

export function triggerCelebration(percentage) {
  const duration = 5000; // Celebration burst (5 seconds)
  const animationEnd = Date.now() + duration;

  // ✅ Play the preloaded audio buffer directly from memory
  if (audioContext && celebrationAudioBuffer) {
    try {
      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
      const source = audioContext.createBufferSource();
      source.buffer = celebrationAudioBuffer;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.2; // 20% volume (very soft)

      source.connect(gainNode);
      gainNode.connect(audioContext.destination);

      source.start(0);
    } catch (err) {
      console.warn("Audio buffer playback error:", err);
    }
  } else {
    // Fallback just in case the trigger happens before the preload finishes
    try {
      const audio = new Audio(
        "https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3",
      );
      audio.volume = 0.2;
      audio
        .play()
        .catch((e) => console.warn("Fallback audio autoplay blocked"));
    } catch (e) {}
  }

  // ✅ Trigger Confetti
  const interval = setInterval(function () {
    const timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);

    // Fire from left edge
    confetti({
      particleCount,
      startVelocity: 45,
      spread: 60,
      angle: 60,
      zIndex: 9999,
      origin: { x: 0, y: 1 },
    });
    // Fire from right edge
    confetti({
      particleCount,
      startVelocity: 45,
      spread: 60,
      angle: 120,
      zIndex: 9999,
      origin: { x: 1, y: 1 },
    });
  }, 250);
}
