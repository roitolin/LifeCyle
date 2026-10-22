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
  storage_path: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
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
    .select('id, service_request_id, status, file_url, storage_path, original_file_name, mime_type, file_size_bytes, requested_at, completed_at, updated_at')
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

export async function sendDeathCertificate(
  documentId: string,
  upload: {
    storagePath: string;
    originalFileName: string;
    mimeType: string;
    fileSizeBytes: number;
  }
) {
  const { data, error } = await supabase.rpc('complete_death_certificate_secure', {
    p_document_id: documentId,
    p_storage_path: upload.storagePath,
    p_original_file_name: upload.originalFileName,
    p_mime_type: upload.mimeType,
    p_file_size_bytes: upload.fileSizeBytes,
  });
  if (error) throw error;
  return data as DeathCertificateRequest;
}

export async function getDeathCertificateAccessUrl(document: DeathCertificateRequest) {
  if (document.storage_path) {
    const { data, error } = await supabase.storage
      .from('death-certificates')
      .createSignedUrl(document.storage_path, 60);
    if (error) throw error;
    if (!data.signedUrl) throw new Error('A secure Death Certificate link could not be created.');
    return data.signedUrl;
  }
  if (document.file_url) return document.file_url;
  throw new Error('The Death Certificate file is unavailable.');
}
