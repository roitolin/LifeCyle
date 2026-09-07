import { supabase } from '@/services/supabaseClient';

export type DeathCertificateStatus =
  | 'requested'
  | 'processing'
  | 'ready';

export type DeathCertificateRequest = {
  id: string;
  service_request_id: string;
  status: DeathCertificateStatus;
  file_url: string | null;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
};

const schemaUnavailable = (error: any) =>
  error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === '42883';

export const deathCertificateErrorMessage = (error: any) => {
  if (schemaUnavailable(error)) {
    return 'The Death Certificate Request database update has not been deployed yet.';
  }
  return error?.message || 'The death certificate request could not be updated.';
};

export async function loadDeathCertificateRequest(serviceRequestId: string) {
  const { data, error } = await supabase
    .from('death_certificate_requests')
    .select('id, service_request_id, status, file_url, requested_at, completed_at, updated_at')
    .eq('service_request_id', serviceRequestId)
    .maybeSingle();

  if (error) throw error;
  return (data || null) as DeathCertificateRequest | null;
}

export async function requestDeathCertificate(serviceRequestId: string) {
  const { data, error } = await supabase.rpc('request_death_certificate', {
    p_request_id: serviceRequestId,
  });
  if (error) throw error;
  return data as DeathCertificateRequest;
}

export async function startDeathCertificateProcessing(documentId: string) {
  const { data, error } = await supabase.rpc('start_death_certificate_processing', {
    p_document_id: documentId,
  });
  if (error) throw error;
  return data as DeathCertificateRequest;
}

export async function sendDeathCertificate(documentId: string, fileUrl: string) {
  const { data, error } = await supabase.rpc('complete_death_certificate', {
    p_document_id: documentId,
    p_file_url: fileUrl,
  });
  if (error) throw error;
  return data as DeathCertificateRequest;
}
