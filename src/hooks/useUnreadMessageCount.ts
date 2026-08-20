import { useState, useEffect } from "react";
import { supabase } from "@/services/supabaseClient";
import { getCurrentSupabaseUserId } from "@/utils/supabaseNotifications";

export function useUnreadMessageCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let active = true;
    let userId: string | null = null;

    const load = async () => {
      userId = await getCurrentSupabaseUserId();
      if (!userId || !active) return;

      const { data } = await supabase
        .from("conversations")
        .select("*")
        .contains("participants", [userId]);

      const count = (data || []).reduce((total, conversation) => {
        if (conversation.hiddenFor?.includes(userId)) return total;
        if (conversation.unreadFor?.includes(userId)) return total + 1;
        const lastMessage = conversation.lastMessage;
        if (
          lastMessage &&
          lastMessage.senderId !== userId &&
          (!lastMessage.readBy || !lastMessage.readBy.includes(userId))
        ) {
          return total + 1;
        }
        return total;
      }, 0);

      if (active) setUnreadCount(count);
    };

    void load();

    const channel = supabase
      .channel(`mobile-unread-messages-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
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
