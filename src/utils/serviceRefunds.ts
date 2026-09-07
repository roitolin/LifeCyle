import { supabase } from '@/services/supabaseClient';
import { normalizePaymentReference } from '@/utils/paymentValidation';

export type ServiceRefundStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'refunded'
  | 'cancelled';

export type ServiceRefundRequest = {
  id: string;
  service_request_id: string;
  requester_id: string;
  shop_id: string;
  status: ServiceRefundStatus;
  reason: string;
  response_note: string | null;
  refund_reference_number: string | null;
  requested_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export async function getLatestServiceRefund(serviceRequestId: string) {
  const { data, error } = await supabase
    .from('service_refund_requests')
    .select('*')
    .eq('service_request_id', serviceRequestId)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ServiceRefundRequest | null) ?? null;
}

export async function createServiceRefund(
  serviceRequestId: string,
  requesterId: string,
  shopId: string,
  reason: string
) {
  const { data, error } = await supabase
    .from('service_refund_requests')
    .insert({
      service_request_id: serviceRequestId,
      requester_id: requesterId,
      shop_id: shopId,
      reason: reason.trim(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ServiceRefundRequest;
}

export async function updateServiceRefund(
  id: string,
  status: Exclude<ServiceRefundStatus, 'pending'>,
  options: { responseNote?: string; refundReference?: string } = {}
) {
  const payload: Record<string, string | null> = { status };
  if (status === 'rejected' || status === 'approved') {
    payload.response_note = options.responseNote?.trim() || null;
  }
  if (status === 'refunded') {
    payload.refund_reference_number = normalizePaymentReference(
      options.refundReference || ''
    );
  }

  const { data, error } = await supabase
    .from('service_refund_requests')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ServiceRefundRequest;
}

export function refundStatusCopy(status: ServiceRefundStatus) {
  switch (status) {
    case 'pending':
      return { label: 'Pending Review', color: '#9a5b32', background: '#fff7ed' };
    case 'approved':
      return { label: 'Approved', color: '#1c4f7e', background: '#e0eefa' };
    case 'rejected':
      return { label: 'Rejected', color: '#991b1b', background: '#fee2e2' };
    case 'refunded':
      return { label: 'Refund Sent', color: '#166534', background: '#dcfce7' };
    default:
      return { label: 'Cancelled', color: '#4c5b57', background: '#eef1ec' };
  }
}
