import { supabase } from "@/services/supabaseClient";

export type ServiceAvailability = {
  available: boolean;
  reason: string | null;
  message: string;
  capacity: number | null;
  activeBookings: number;
  remainingCapacity: number | null;
  blockedDate: string | null;
  stock: number | null;
};

export async function checkServiceAvailability({
  shopId,
  wakeStartDate,
  wakeEndDate,
  productId,
  excludeRequestId,
}: {
  shopId: string;
  wakeStartDate: string;
  wakeEndDate: string;
  productId?: string | null;
  excludeRequestId?: string | null;
}): Promise<ServiceAvailability> {
  const { data, error } = await supabase.rpc("get_funeral_service_availability", {
    p_shop_id: shopId,
    p_wake_start_date: wakeStartDate,
    p_wake_end_date: wakeEndDate,
    p_product_id: productId || null,
    p_exclude_request_id: excludeRequestId || null,
  });
  if (error) throw error;

  const result = (data || {}) as Record<string, unknown>;
  return {
    available: result.available === true,
    reason: typeof result.reason === "string" ? result.reason : null,
    message: typeof result.message === "string" ? result.message : "Availability could not be confirmed.",
    capacity: result.capacity == null ? null : Number(result.capacity),
    activeBookings: Number(result.activeBookings) || 0,
    remainingCapacity: result.remainingCapacity == null ? null : Number(result.remainingCapacity),
    blockedDate: typeof result.blockedDate === "string" ? result.blockedDate : null,
    stock: result.stock == null ? null : Number(result.stock),
  };
}
