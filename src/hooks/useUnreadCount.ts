import { useState, useEffect } from "react";
import { supabase } from "@/services/supabaseClient";
import {
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
        const [notificationsResult, preferences] = await Promise.all([
          supabase
            .from("notifications")
            .select("type,read")
            .eq("userId", userId)
            .eq("read", false),
          getNotificationPreferences(userId),
        ]);
        if (notificationsResult.error) throw notificationsResult.error;
        if (!active || version !== loadVersion) return;
        const enabledNotifications = filterNotificationsByPreferences(
          (notificationsResult.data || []).filter((notification) => !isChatNotificationType(notification.type)),
          preferences
        );
        setUnreadCount(enabledNotifications.length);
      } catch (error) {
        console.warn("Unable to load unread notification count:", error);
      }
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setupPreferences = async () => {
      userId = await getCurrentSupabaseUserId();
      if (!userId || !active) return;
      unsubscribePreferences = subscribeNotificationPreferences(userId, () => {
        void load();
      });
      channel = supabase
        .channel(`notifications-unread-count-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `userId=eq.${userId}`,
          },
          () => void load(),
        )
        .subscribe();
      await load();
    };

    void setupPreferences();

    return () => {
      active = false;
      unsubscribePreferences();
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  return unreadCount;
}
