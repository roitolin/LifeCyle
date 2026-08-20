import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotificationPreferences = {
  serviceRequests: boolean;
  payments: boolean;
  messages: boolean;
  announcements: boolean;
  sound: boolean;
};

export type NotificationPreferenceCategory = Exclude<
  keyof NotificationPreferences,
  "sound"
>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  serviceRequests: true,
  payments: true,
  messages: true,
  announcements: true,
  sound: true,
};

const STORAGE_KEY_PREFIX = "@bloodlink/notification-preferences/";
const listeners = new Map<
  string,
  Set<(preferences: NotificationPreferences) => void>
>();
const writeQueues = new Map<string, Promise<void>>();

const storageKeyFor = (userId: string) =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId.trim())}`;

const copyDefaults = (): NotificationPreferences => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES,
});

const normalizePreferences = (
  value: Partial<NotificationPreferences> | null | undefined
): NotificationPreferences => ({
  serviceRequests:
    typeof value?.serviceRequests === "boolean"
      ? value.serviceRequests
      : DEFAULT_NOTIFICATION_PREFERENCES.serviceRequests,
  payments:
    typeof value?.payments === "boolean"
      ? value.payments
      : DEFAULT_NOTIFICATION_PREFERENCES.payments,
  messages:
    typeof value?.messages === "boolean"
      ? value.messages
      : DEFAULT_NOTIFICATION_PREFERENCES.messages,
  announcements:
    typeof value?.announcements === "boolean"
      ? value.announcements
      : DEFAULT_NOTIFICATION_PREFERENCES.announcements,
  sound:
    typeof value?.sound === "boolean"
      ? value.sound
      : DEFAULT_NOTIFICATION_PREFERENCES.sound,
});

const notifyListeners = (
  userId: string,
  preferences: NotificationPreferences
) => {
  listeners.get(userId)?.forEach((listener) => {
    listener({ ...preferences });
  });
};

export async function getNotificationPreferences(
  userId: string | null | undefined
): Promise<NotificationPreferences> {
  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) return copyDefaults();

  try {
    const pendingWrite = writeQueues.get(normalizedUserId);
    if (pendingWrite) await pendingWrite;

    const stored = await AsyncStorage.getItem(storageKeyFor(normalizedUserId));
    if (!stored) return copyDefaults();

    return normalizePreferences(
      JSON.parse(stored) as Partial<NotificationPreferences>
    );
  } catch (error) {
    console.warn("Unable to load notification preferences:", error);
    return copyDefaults();
  }
}

export async function saveNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences
): Promise<NotificationPreferences> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("A signed-in user is required to save notification preferences.");
  }

  const normalized = normalizePreferences(preferences);
  const previousWrite = writeQueues.get(normalizedUserId) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(() =>
      AsyncStorage.setItem(
        storageKeyFor(normalizedUserId),
        JSON.stringify(normalized)
      )
    );

  writeQueues.set(normalizedUserId, nextWrite);
  try {
    await nextWrite;
  } finally {
    if (writeQueues.get(normalizedUserId) === nextWrite) {
      writeQueues.delete(normalizedUserId);
    }
  }

  notifyListeners(normalizedUserId, normalized);
  return { ...normalized };
}

export async function updateNotificationPreferences(
  userId: string,
  changes: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(userId);
  return saveNotificationPreferences(userId, { ...current, ...changes });
}

export function subscribeNotificationPreferences(
  userId: string,
  listener: (preferences: NotificationPreferences) => void
) {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) return () => undefined;

  const userListeners = listeners.get(normalizedUserId) ?? new Set();
  userListeners.add(listener);
  listeners.set(normalizedUserId, userListeners);

  return () => {
    const currentListeners = listeners.get(normalizedUserId);
    currentListeners?.delete(listener);
    if (currentListeners?.size === 0) listeners.delete(normalizedUserId);
  };
}

export function getNotificationPreferenceCategory(
  notificationType: string
): NotificationPreferenceCategory | null {
  const type = notificationType.trim().toLowerCase();

  if (type.includes("payment")) return "payments";

  if (
    type === "support_message" ||
    type === "message" ||
    type.startsWith("message_") ||
    type.startsWith("chat_")
  ) {
    return "messages";
  }

  if (type === "announcement_new" || type === "funeral_new_product") {
    return "announcements";
  }

  if (
    type.startsWith("request_") ||
    type.startsWith("funeral_request_")
  ) {
    return "serviceRequests";
  }

  return null;
}

export function isNotificationTypeEnabled(
  notificationType: string,
  preferences: NotificationPreferences
) {
  const category = getNotificationPreferenceCategory(notificationType);
  return category === null || preferences[category];
}

export function filterNotificationsByPreferences<T extends { type: string }>(
  notifications: T[],
  preferences: NotificationPreferences
) {
  return notifications.filter((notification) =>
    isNotificationTypeEnabled(notification.type, preferences)
  );
}
