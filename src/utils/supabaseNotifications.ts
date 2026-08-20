import { supabase } from "@/services/supabaseClient";

export type NotificationPayload = {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

export type AppNotification = NotificationPayload & {
  id: string;
  read: boolean;
  createdAt: string | null;
};

export const getCurrentSupabaseUserId = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};

export const createNotification = async ({ userId, type, title, body, data = null }: NotificationPayload) => {
  const { error } = await supabase.from("notifications").insert({
    userId,
    type,
    title,
    body,
    data,
    read: false,
  });
  if (error) throw error;
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
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("userId", userId)
    .eq("read", false);

  if (error) throw error;
  return count || 0;
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

export const deleteNotificationsByIds = async (ids: string[]) => {
  if (ids.length === 0) return;
  const { error } = await supabase.from("notifications").delete().in("id", ids);
  if (error) throw error;
};
