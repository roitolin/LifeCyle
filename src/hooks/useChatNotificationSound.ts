import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { supabase } from "@/services/supabaseClient";
import { useAuth } from "@/context/AuthContext";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  subscribeNotificationPreferences,
  type NotificationPreferences,
} from "@/utils/notificationPreferences";
import {
  cancelAllNotificationSounds,
  cancelPendingChatNotificationSounds,
  isActiveChat,
  queueChatNotificationSound,
} from "@/utils/notificationSound";

const MAX_REMEMBERED_MESSAGE_IDS = 1000;

function getLastMessageId(lastMessage: any) {
  const id = String(lastMessage?.id || "").trim();
  return id || null;
}

function rememberMessageId(ids: Set<string>, id: string) {
  if (ids.has(id)) return false;
  ids.add(id);
  if (ids.size > MAX_REMEMBERED_MESSAGE_IDS) {
    const oldestId = ids.values().next().value;
    if (typeof oldestId === "string") ids.delete(oldestId);
  }
  return true;
}

export function useChatNotificationSound() {
  const { user } = useAuth();
  const userId = user?.uid;

  const preferencesRef = useRef<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });

  useEffect(() => {
    if (!userId) return undefined;

    let active = true;
    const seenMessageIds = new Set<string>();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribePreferences: () => void = () => undefined;

    const handleEvent = (newRow: any) => {
      if (!active) return;
      if (!newRow?.participants?.includes(userId)) return;

      const lastMessage = newRow.lastMessage;
      const messageId = getLastMessageId(lastMessage);
      if (!messageId) return;

      if (lastMessage.readBy?.includes(userId)) {
        rememberMessageId(seenMessageIds, messageId);
        cancelPendingChatNotificationSounds();
        return;
      }

      if (!rememberMessageId(seenMessageIds, messageId)) return;
      if (AppState.currentState !== "active") return;
      if (newRow.hiddenFor?.includes(userId)) return;

      const preferences = preferencesRef.current;
      if (!preferences.messages || !preferences.sound) return;
      if (lastMessage.senderId === userId) return;

      const conversationId = String(newRow.id || "").trim();
      if (conversationId && isActiveChat(conversationId)) return;

      queueChatNotificationSound(1);
    };

    const setup = async () => {
      if (!active) return;
      const preferences = await getNotificationPreferences(userId);
      if (!active) return;
      preferencesRef.current = preferences;
      if (!preferences.sound) cancelAllNotificationSounds();
      else if (!preferences.messages) cancelPendingChatNotificationSounds();

      const { data: conversations, error } = await supabase
        .from("conversations")
        .select("lastMessage")
        .contains("participants", [userId]);
      if (error) {
        console.warn("Unable to initialize chat notification sounds:", error);
      } else {
        (conversations || []).forEach((conversation: any) => {
          const messageId = getLastMessageId(conversation.lastMessage);
          if (messageId) rememberMessageId(seenMessageIds, messageId);
        });
      }
      if (!active) return;

      unsubscribePreferences = subscribeNotificationPreferences(
        userId,
        (nextPreferences) => {
          preferencesRef.current = nextPreferences;
          if (!nextPreferences.sound) {
            cancelAllNotificationSounds();
          } else if (!nextPreferences.messages) {
            cancelPendingChatNotificationSounds();
          }
        }
      );

      channel = supabase
        .channel(`chat-notification-sound-${userId}-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          (payload: any) => {
            handleEvent(payload.new);
          }
        )
        .subscribe();
    };

    void setup();

    return () => {
      active = false;
      unsubscribePreferences();
      cancelPendingChatNotificationSounds();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
