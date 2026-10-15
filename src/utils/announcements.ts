import { supabase } from "@/services/supabaseClient";
export const createAnnouncement = async (payload: {
  createdBy: string;
  title: string;
  body: string;
  isPinned?: boolean;
  expiresAt?: string | null;
}) => {
  const trimmedTitle = payload.title.trim();
  const trimmedBody = payload.body.trim();

  if (!trimmedTitle || !trimmedBody) {
    throw new Error("Announcement title and message are required.");
  }
  if (!payload.createdBy.trim()) {
    throw new Error("A signed-in administrator is required.");
  }

  const { data, error } = await supabase.rpc("publish_announcement", {
    p_title: trimmedTitle,
    p_body: trimmedBody,
    p_audience: "all",
    p_is_pinned: Boolean(payload.isPinned),
    p_expires_at: payload.expiresAt || null,
  });

  if (error) throw error;
  return String((data as { id?: string } | null)?.id || "");
};

