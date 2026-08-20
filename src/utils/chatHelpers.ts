import { supabase } from "@/services/supabaseClient";

function isMissingSeenReceiptRpc(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "PGRST202"
    || error.code === "42883"
    || /mark_chat_messages_seen/i.test(error.message || "");
}

/**
 * Adds only the signed-in user's immutable seen receipt. The RPC is the
 * secure path; the direct-update fallback keeps older databases usable until
 * the receipt migration is applied.
 */
export const markChatMessagesSeen = async (
  conversationId: string,
  userId: string,
  messageIds: string[] | null
): Promise<void> => {
  if (messageIds && messageIds.length === 0) return;

  const { error: rpcError } = await supabase.rpc("mark_chat_messages_seen", {
    target_conversation_id: conversationId,
    target_message_ids: messageIds,
  });
  if (!rpcError) return;
  if (!isMissingSeenReceiptRpc(rpcError)) throw rpcError;

  let query = supabase
    .from("messages")
    .select("id, readBy")
    .eq("conversationId", conversationId)
    .neq("senderId", userId);
  if (messageIds) query = query.in("id", messageIds);

  const { data, error: fetchError } = await query;
  if (fetchError) throw fetchError;

  for (const message of data || []) {
    const currentReadBy = Array.isArray(message.readBy) ? message.readBy : [];
    const nextReadBy = Array.from(new Set([...currentReadBy, userId]));
    if (nextReadBy.length === currentReadBy.length
      && nextReadBy.every((id: string) => currentReadBy.includes(id))) continue;

    const { error: updateError } = await supabase
      .from("messages")
      .update({ readBy: nextReadBy })
      .eq("id", message.id)
      .eq("conversationId", conversationId);
    if (updateError) throw updateError;
  }
};

/**
 * Ensures a conversation document exists and keeps participants normalized.
 */
export const ensureConversationForUsers = async (
  _db: any, // kept for signature compatibility
  uid1: string,
  uid2: string,
  preferredConversationId?: string
): Promise<string> => {
  if (!uid1 || !uid2) throw new Error("Both conversation participants are required.");
  if (uid1 === uid2) throw new Error("A direct conversation requires two different users.");

  const participants = [uid1, uid2].sort();
  const selectFields = "id, participants, hiddenFor";

  let conv: { id: string; participants: string[]; hiddenFor?: string[] } | null = null;

  if (preferredConversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .select(selectFields)
      .eq("id", preferredConversationId)
      .maybeSingle();

    if (error) throw error;
    if (data) {
      const exactParticipants =
        Array.isArray(data.participants) &&
        data.participants.length === participants.length &&
        participants.every((id) => data.participants.includes(id));
      if (!exactParticipants) {
        throw new Error("This conversation link does not match its participants.");
      }
      conv = data;
    }
  }

  if (!conv) {
    const { data, error: lookupError } = await supabase
      .from("conversations")
      .select(selectFields)
      .contains("participants", participants)
      .containedBy("participants", participants)
      .order("updatedAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) throw lookupError;
    conv = data;
  }

  if (conv) {
    const hiddenFor = Array.isArray(conv.hiddenFor)
      ? conv.hiddenFor.filter((id: string) => id !== uid1)
      : [];

    if (hiddenFor.length !== (conv.hiddenFor?.length || 0)) {
      const { error: restoreError } = await supabase
        .from("conversations")
        .update({ hiddenFor })
        .eq("id", conv.id);
      if (restoreError) throw restoreError;
    }
    return conv.id;
  }

  const { data: createdConversation, error: createError } = await supabase.from("conversations").insert({
      participants,
      hiddenFor: [],
      updatedAt: new Date().toISOString()
    }).select("id").single();

  if (createError || !createdConversation?.id) {
    throw createError || new Error("Failed to create conversation.");
  }

  return createdConversation.id;
};

