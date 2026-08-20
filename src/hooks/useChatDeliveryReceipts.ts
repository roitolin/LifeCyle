import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/services/supabaseClient";

function isMissingDeliveryMigration(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST202"
    || error.code === "PGRST204"
    || error.code === "42883"
    || /acknowledge_chat_deliveries/i.test(error.message || "");
}

export function useChatDeliveryReceipts() {
  const { user } = useAuth();
  const userId = user?.uid;

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    let disabled = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingConversationIds = new Set<string>();

    const acknowledge = async (conversationIds: string[] | null) => {
      if (!active || disabled) return;
      const { error } = await supabase.rpc("acknowledge_chat_deliveries", {
        target_conversation_ids: conversationIds,
      });
      if (!error) return;
      if (isMissingDeliveryMigration(error)) {
        disabled = true;
        return;
      }
      console.warn("Unable to acknowledge chat delivery:", error.message);
    };

    const flush = () => {
      flushTimer = null;
      const ids = Array.from(pendingConversationIds);
      pendingConversationIds.clear();
      if (ids.length > 0) void acknowledge(ids);
    };

    const schedule = (conversationId: string) => {
      pendingConversationIds.add(conversationId);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 80);
    };

    if (AppState.currentState === "active") void acknowledge(null);

    const channel = supabase
      .channel(`chat-delivery-receipts-${userId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: any) => {
          const message = payload.new;
          if (
            AppState.currentState === "active"
            && message?.senderId !== userId
            && typeof message?.conversationId === "string"
          ) {
            schedule(message.conversationId);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && AppState.currentState === "active") {
          void acknowledge(null);
        }
      });

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void acknowledge(null);
    });

    return () => {
      active = false;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      pendingConversationIds.clear();
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
