import { getAdminIds } from "./adminConfig";
import { supabase } from "@/services/supabaseClient";
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
  data?: Record<string, unknown> | null
) => {
  const eventId = String(data?.requestId || data?.reportId || data?.feedbackId || Date.now());
  const dedupeKey = `admin:${type}:${eventId}`;
  const { data: delivered, error: rpcError } = await supabase.rpc("notify_active_admins", {
    p_type: type,
    p_title: title,
    p_body: body,
    p_data: data || null,
    p_dedupe_key: dedupeKey,
  });
  if (!rpcError) return Number(delivered) || 0;
  if (!["42883", "PGRST202"].includes(String(rpcError.code || ""))) {
    console.warn("Server-side admin notification routing failed; using the client fallback.", rpcError);
  }

  const adminIds = await getAdminIds();
  if (adminIds.length === 0) {
    console.warn("Admin notification skipped because no active administrator was found.");
    return 0;
  }
  const deliveries = await Promise.allSettled(
    adminIds.map((adminId) =>
      createNotification({
        userId: adminId,
        type,
        title,
        body,
        data: data || null,
        dedupeKey,
      })
    )
  );
  const failures = deliveries.filter((delivery) => delivery.status === "rejected");
  if (failures.length > 0) {
    console.error(`Failed to deliver ${failures.length} of ${deliveries.length} admin notifications.`);
  }
  return deliveries.length - failures.length;
};
