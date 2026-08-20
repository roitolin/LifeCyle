import { supabase } from "@/services/supabaseClient";

export type ConversationPreference = "pinned" | "archived" | "unread";

export async function saveConversationPreference(
  conversationId: string,
  preference: ConversationPreference,
  enabled: boolean
) {
  const { data, error } = await supabase.rpc("set_conversation_preference", {
    target_conversation_id: conversationId,
    preference_name: preference,
    preference_enabled: enabled,
  });

  if (error) throw error;
  if (data !== true) {
    throw new Error("This conversation could not be updated.");
  }
}
