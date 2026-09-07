import { supabase } from "@/services/supabaseClient";

export type NotificationPayload = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};

export type AppNotification = NotificationPayload & {
  id: string;
  read: boolean;
  createdAt: string | null;
};

export const CHAT_NOTIFICATION_TYPES = new Set(["support_message", "chat_message"]);

export const isChatNotificationType = (type: string) =>
  CHAT_NOTIFICATION_TYPES.has(String(type || "").toLowerCase());

export const getCurrentSupabaseUserId = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createNotification = async ({
  userId,
  type,
  title,
  body,
  data = null,
  dedupeKey = null,
}: NotificationPayload) => {
  const basePayload = { userId, type, title, body, data, read: false };
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = dedupeKey ? { ...basePayload, dedupe_key: dedupeKey } : basePayload;
    const { error } = dedupeKey
      ? await supabase.from("notifications").upsert(payload, {
          onConflict: "userId,dedupe_key",
          ignoreDuplicates: true,
        })
      : await supabase.from("notifications").insert(payload);

    if (!error) return;

    // Keep notifications working while the dedupe migration is being deployed.
    if (dedupeKey && (error.code === "42703" || error.code === "PGRST204")) {
      const { error: fallbackError } = await supabase.from("notifications").insert(basePayload);
      if (!fallbackError) return;
      lastError = fallbackError;
    } else {
      lastError = error;
    }

    if (attempt < 2) await wait(200 * (attempt + 1));
  }

  throw lastError;
};

export const fetchNotificationsForUser = async (userId: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  if (error) throw error;
  return (data || []) as AppNotification[];
};

export const countUnreadNotificationsForUser = async (userId: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("type")
    .eq("userId", userId)
    .eq("read", false);

  if (error) throw error;
  return (data || []).filter((item) => !isChatNotificationType(item.type)).length;
};

export const markNotificationRead = async (id: string) => {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
  if (error) throw error;
};

export const deleteNotificationById = async (id: string) => {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
};

export const markNotificationsRead = async (ids: string[]) => {
  if (ids.length === 0) return;
  const { error } = await supabase.from("notifications").update({ read: true }).in("id", ids);
  if (error) throw error;
};

export const markNotificationsUnread = async (ids: string[]) => {
  if (ids.length === 0) return;
  const { error } = await supabase.from("notifications").update({ read: false }).in("id", ids);
  if (error) throw error;
};

export const deleteNotificationsByIds = async (ids: string[]) => {
  if (ids.length === 0) return;
  const { error } = await supabase.from("notifications").delete().in("id", ids);
  if (error) throw error;
};
