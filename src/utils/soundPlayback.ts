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
  if (player.currentStatus.isLoaded) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let subscription: { remove(): void } | undefined;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(() => {
      finish(new Error("The sound did not finish loading within 10 seconds."));
    }, 10_000);

    subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.isLoaded) finish();
    });

    // Close the gap between the first check and listener registration.
    if (settled) subscription.remove();
    else if (player.currentStatus.isLoaded) finish();
  });
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
