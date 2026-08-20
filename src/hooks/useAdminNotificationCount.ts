import { useState, useEffect } from "react";
import { supabase } from "@/services/supabaseClient";
import { countUnreadNotificationsForUser, getCurrentSupabaseUserId } from "@/utils/supabaseNotifications";

export function useAdminNotificationCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const adminId = await getCurrentSupabaseUserId();
      if (!adminId || !active) return;
      setUnreadCount(await countUnreadNotificationsForUser(adminId));
    };

    void load();

    const channel = supabase
      .channel(`admin-notifications-unread-count-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  return unreadCount;
}
