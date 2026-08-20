import {
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from "expo-audio";

let audioModePromise: Promise<void> | null = null;

export async function ensureAppAudioReady() {
  await setIsAudioActiveAsync(true);
  if (!audioModePromise) {
    audioModePromise = setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
    }).catch((error) => {
      audioModePromise = null;
      throw error;
    });
  }
  await audioModePromise;
}

async function waitUntilLoaded(player: AudioPlayer) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (player.currentStatus.isLoaded) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The sound did not finish loading.");
}

export async function playSoundFromStart(player: AudioPlayer) {
  await ensureAppAudioReady();
  await waitUntilLoaded(player);
  player.pause();
  player.muted = false;
  player.volume = 1;
  await player.seekTo(0);
  player.play();
}
