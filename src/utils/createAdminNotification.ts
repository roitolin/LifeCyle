import { getAdminId } from "./adminConfig";
import { createNotification } from "./supabaseNotifications";

export type AdminNotificationType =
  | "request_pending"
  | "shop_payment_submitted"
  | "support_message"
  | "feedback_new"
  | "rating_update"
  | "abuse_report";

export const createAdminNotification = async (
  type: AdminNotificationType,
  title: string,
  body: string,
  data?: any
) => {
  const adminId = await getAdminId();
  if (!adminId) return;

  try {
    await createNotification({
      userId: adminId,
      type,
      title,
      body,
      data: data || null,
    });
  } catch (error) {
    console.error("Error creating admin notification:", error);
  }
};
