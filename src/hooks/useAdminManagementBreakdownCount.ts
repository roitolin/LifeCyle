import { useEffect, useState } from "react";
import { supabase } from "@/services/supabaseClient";
import { fetchNotificationsForUser, getCurrentSupabaseUserId } from "@/utils/supabaseNotifications";

type Breakdown = {
  shops: number;
  requests: number;
  total: number;
};

export function useAdminManagementBreakdownCount() {
  const [counts, setCounts] = useState<Breakdown>({ shops: 0, requests: 0, total: 0 });

  useEffect(() => {
    let active = true;

    const load = async () => {
      const adminId = await getCurrentSupabaseUserId();
      if (!adminId || !active) return;
      const notifications = await fetchNotificationsForUser(adminId);
      let shops = 0;
      let requests = 0;

      notifications.filter((item: any) => !item.read).forEach((item: any) => {
        const type = item.type;
        if (type === "shop_pending") shops += 1;
        if (type === "request_pending") requests += 1;
      });

      setCounts({ shops, requests, total: shops + requests });
    };

    void load();
    const channel = supabase
      .channel(`admin-management-breakdown-count-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void load();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  return counts;
}
