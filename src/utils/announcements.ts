import { supabase } from "@/services/supabaseClient";
import { generateId } from "./generateId";

export const createAnnouncement = async (payload: {
  createdBy: string;
  title: string;
  body: string;
  isPinned?: boolean;
}) => {
  const trimmedTitle = payload.title.trim();
  const trimmedBody = payload.body.trim();

  if (!trimmedTitle || !trimmedBody) {
    throw new Error("Announcement title and message are required.");
  }

  const announcementId = generateId();
  const { error: annError } = await supabase.from("announcements").insert({
    id: announcementId,
    title: trimmedTitle,
    body: trimmedBody,
    isPinned: Boolean(payload.isPinned),
    status: "active",
    createdBy: payload.createdBy,
  });

  if (annError) throw annError;

  const { data: users } = await supabase
    .from("users")
    .select("id, role")
    .neq("role", "admin"); // Exclude admins

  if (users && users.length > 0) {
    const notifications = users.map(user => ({
      userId: user.id,
      type: "announcement_new",
      title: `Announcement: ${trimmedTitle}`,
      body: trimmedBody,
      data: { announcementId },
      read: false,
    }));

    // Batch insert
    await supabase.from("notifications").insert(notifications);
  }

  return announcementId;
};

