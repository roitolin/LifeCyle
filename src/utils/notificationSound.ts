import { createAudioPlayer, preload, type AudioPlayer } from "expo-audio";
import { ensureAppAudioReady, playSoundFromStart } from "./soundPlayback";

const NOTIFICATION_SOUND = require("../../sound/NotificationsSound.mp3");

let soundPlayer: AudioPlayer | null = null;
type NotificationSoundSource = "app" | "chat";

let pendingAppPlays = 0;
let pendingChatPlays = 0;
let draining = false;
let activeSource: NotificationSoundSource | null = null;
let lastPlayedSource: NotificationSoundSource | null = null;
let appCancellationVersion = 0;
let chatCancellationVersion = 0;
let activeChatId: string | null = null;
const playedNotificationIds = new Set<string>();
const MAX_REMEMBERED_NOTIFICATION_IDS = 500;

let preloadAttempted = false;
async function safelyPreloadSound() {
  if (preloadAttempted) return;
  preloadAttempted = true;
  try {
    await Promise.race([
      preload(NOTIFICATION_SOUND),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // Preload is an optional optimization; createAudioPlayer loads on demand if network times out
  }
}

async function ensurePlayer(): Promise<AudioPlayer | null> {
  try {
    await ensureAppAudioReady();
    if (!soundPlayer) {
      void safelyPreloadSound();
      soundPlayer = createAudioPlayer(NOTIFICATION_SOUND, { keepAudioSessionActive: true });
      soundPlayer.volume = 1;
    }
    return soundPlayer;
  } catch (error) {
    console.warn("Unable to load notification sound:", error);
    return null;
  }
}

export async function prepareNotificationSound() {
  await ensurePlayer();
}

function normalizedPlayCount(count: number) {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function pauseSoundPlayer() {
  try {
    soundPlayer?.pause();
  } catch (error) {
    console.warn("Unable to stop notification sound:", error);
  }
}

function nextPendingSource(): NotificationSoundSource | null {
  if (pendingAppPlays > 0 && pendingChatPlays > 0) {
    return lastPlayedSource === "app" ? "chat" : "app";
  }
  if (pendingAppPlays > 0) return "app";
  if (pendingChatPlays > 0) return "chat";
  return null;
}

function cancellationVersionFor(source: NotificationSoundSource) {
  return source === "app" ? appCancellationVersion : chatCancellationVersion;
}

export function registerActiveChat(conversationId: string | null) {
  activeChatId = conversationId;
}

export function isActiveChat(conversationId: string) {
  return activeChatId === conversationId;
}

export function queueNotificationSound(count: number) {
  const plays = normalizedPlayCount(count);
  if (plays === 0) return;
  pendingAppPlays += plays;
  void drain();
}

export function queueNotificationSoundOnce(notificationId: string) {
  const normalizedId = notificationId.trim();
  if (!normalizedId || playedNotificationIds.has(normalizedId)) return false;

  playedNotificationIds.add(normalizedId);
  if (playedNotificationIds.size > MAX_REMEMBERED_NOTIFICATION_IDS) {
    const oldestId = playedNotificationIds.values().next().value;
    if (typeof oldestId === 'string') playedNotificationIds.delete(oldestId);
  }

  queueNotificationSound(1);
  return true;
}

export function queueChatNotificationSound(count: number) {
  const plays = normalizedPlayCount(count);
  if (plays === 0) return;
  pendingChatPlays += plays;
  void drain();
}

export function cancelPendingAppNotificationSounds() {
  pendingAppPlays = 0;
  appCancellationVersion += 1;
  if (activeSource === "app") pauseSoundPlayer();
}

export function cancelPendingChatNotificationSounds() {
  pendingChatPlays = 0;
  chatCancellationVersion += 1;
  if (activeSource === "chat") pauseSoundPlayer();
}

export function cancelAllNotificationSounds() {
  pendingAppPlays = 0;
  pendingChatPlays = 0;
  appCancellationVersion += 1;
  chatCancellationVersion += 1;
  pauseSoundPlayer();
}

export function disposeChatNotificationSound() {
  cancelAllNotificationSounds();
  try {
    soundPlayer?.remove();
  } catch (error) {
    console.warn("Unable to dispose notification sound:", error);
  }
  soundPlayer = null;
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    let source = nextPendingSource();
    while (source) {
      if (source === "app") pendingAppPlays -= 1;
      else pendingChatPlays -= 1;

      const cancellationVersion = cancellationVersionFor(source);
      activeSource = source;
      const player = await ensurePlayer();
      if (!player) {
        pendingAppPlays = 0;
        pendingChatPlays = 0;
        break;
      }

      if (cancellationVersion !== cancellationVersionFor(source)) {
        activeSource = null;
        source = nextPendingSource();
        continue;
      }

      try {
        await playSoundFromStart(player);
      } catch (error) {
        console.warn("Unable to play notification sound:", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      lastPlayedSource = source;
      activeSource = null;
      source = nextPendingSource();
    }
  } finally {
    activeSource = null;
    draining = false;
  }
}
