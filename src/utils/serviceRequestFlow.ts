import { supabase } from '@/services/supabaseClient';

export type AcceptedServiceRequestPayment = {
  id: string;
  status: 'awaiting_payment';
  paymentQrUrl: string;
  paymentAmount: number | string;
  acceptedAt?: string | null;
  shopRespondedAt?: string | null;
  [key: string]: unknown;
};

export async function acceptFuneralServiceRequest(requestId: string): Promise<AcceptedServiceRequestPayment> {
  const { error: acceptanceError } = await supabase.rpc('accept_funeral_service_request', {
    p_request_id: requestId,
  });
  if (acceptanceError) throw acceptanceError;

  const { data, error: readError } = await supabase
    .from('funeral_service_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (readError) throw readError;

  return data as AcceptedServiceRequestPayment;
}
