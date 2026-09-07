import { useState, useEffect } from "react";
import { supabase } from "@/services/supabaseClient";
import {
  fetchNotificationsForUser,
  getCurrentSupabaseUserId,
  isChatNotificationType,
} from "@/utils/supabaseNotifications";
import {
  filterNotificationsByPreferences,
  getNotificationPreferences,
  subscribeNotificationPreferences,
} from "@/utils/notificationPreferences";

export function useUnreadCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    let userId: string | null = null;
    let unsubscribePreferences: () => void = () => undefined;
    let loadVersion = 0;

    const load = async () => {
      const version = loadVersion + 1;
      loadVersion = version;
      userId = userId ?? (await getCurrentSupabaseUserId());
      if (!userId || !active) return;

      try {
        const [notifications, preferences] = await Promise.all([
          fetchNotificationsForUser(userId),
          getNotificationPreferences(userId),
        ]);
        if (!active || version !== loadVersion) return;
        const enabledNotifications = filterNotificationsByPreferences(
          notifications.filter((notification) => !isChatNotificationType(notification.type)),
          preferences
        );
        setUnreadCount(
          enabledNotifications.filter((notification) => !notification.read).length
        );
      } catch (error) {
        console.warn("Unable to load unread notification count:", error);
      }
    };

    const setupPreferences = async () => {
      userId = await getCurrentSupabaseUserId();
      if (!userId || !active) return;
      unsubscribePreferences = subscribeNotificationPreferences(userId, () => {
        void load();
      });
      await load();
    };

    void setupPreferences();

    const channel = supabase
      .channel(`notifications-unread-count-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      active = false;
      unsubscribePreferences();
      void supabase.removeChannel(channel);
    };
  }, []);

  return unreadCount;
}
