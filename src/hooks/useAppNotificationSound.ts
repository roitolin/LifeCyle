import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { supabase } from "@/services/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferenceCategory,
  getNotificationPreferences,
  isNotificationTypeEnabled,
  subscribeNotificationPreferences,
  type NotificationPreferences,
} from "@/utils/notificationPreferences";
import {
  cancelAllNotificationSounds,
  cancelPendingAppNotificationSounds,
  prepareNotificationSound,
  queueNotificationSoundOnce,
} from "@/utils/notificationSound";

export function useAppNotificationSound() {
  const { user } = useAuth();
  const userId = user?.uid;

  const preferencesRef = useRef<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    let unsubscribePreferences: () => void = () => undefined;

    const handleInsert = (payload: any) => {
      if (!active) return;
      const row = payload.new;
      if (!row || String(row.userId || "") !== userId) return;

      const notificationId = String(row.id || "").trim();
      const notificationType =
        typeof row.type === "string" ? row.type.trim() : "";
      if (!notificationId || !notificationType || row.read !== false) return;
      if (AppState.currentState !== "active") return;

      const preferences = preferencesRef.current;
      if (!preferences.sound) return;
      if (getNotificationPreferenceCategory(notificationType) === "messages") {
        return;
      }
      if (!isNotificationTypeEnabled(notificationType, preferences)) return;

      queueNotificationSoundOnce(notificationId);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      if (!active) return;
      const [preferences] = await Promise.all([
        getNotificationPreferences(userId),
        prepareNotificationSound(),
      ]);
      if (!active) return;
      preferencesRef.current = preferences;
      if (!preferences.sound) cancelAllNotificationSounds();

      unsubscribePreferences = subscribeNotificationPreferences(
        userId,
        (nextPreferences) => {
          preferencesRef.current = nextPreferences;
          if (!nextPreferences.sound) {
            cancelAllNotificationSounds();
          }
        }
      );

      channel = supabase
        .channel(`app-notification-sound-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `userId=eq.${userId}`,
          },
          handleInsert
        )
        .subscribe();
    };

    void setup();

    return () => {
      active = false;
      unsubscribePreferences();
      cancelPendingAppNotificationSounds();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
