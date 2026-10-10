import { supabase } from '@/lib/supabase'

export type DeathCertificateStatus = 'requested' | 'processing' | 'ready'

export type DeathCertificateDocument = {
  id: string
  service_request_id: string
  status: DeathCertificateStatus
  file_url: string | null
  storage_path: string | null
  original_file_name: string | null
  mime_type: string | null
  file_size_bytes: number | null
  requested_at: string
  completed_at: string | null
  updated_at: string
}

const BUCKET = 'death-certificates'
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

export async function loadDeathCertificate(serviceRequestId: string) {
  const { data, error } = await supabase
    .from('death_certificate_requests')
    .select('id, service_request_id, status, file_url, storage_path, original_file_name, mime_type, file_size_bytes, requested_at, completed_at, updated_at')
    .eq('service_request_id', serviceRequestId)
    .maybeSingle()
  if (error) throw error
  return (data || null) as DeathCertificateDocument | null
}

export async function requestDeathCertificate(serviceRequestId: string) {
  const { data, error } = await supabase.rpc('request_death_certificate', { p_request_id: serviceRequestId })
  if (error) throw error
  return data as DeathCertificateDocument
}

export async function startDeathCertificate(documentId: string) {
  const { data, error } = await supabase.rpc('start_death_certificate_processing', { p_document_id: documentId })
  if (error) throw error
  return data as DeathCertificateDocument
}

export async function uploadDeathCertificate(documentId: string, file: File) {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP, or PDF file.')
  if (file.size < 1 || file.size > MAX_FILE_BYTES) throw new Error('The Death Certificate must be 10 MB or smaller.')

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('You must be signed in to upload a Death Certificate.')

  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const storagePath = documentId + '/' + userData.user.id + '/' + crypto.randomUUID() + '.' + extension
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError

  const { data, error } = await supabase.rpc('complete_death_certificate_secure', {
    p_document_id: documentId,
    p_storage_path: storagePath,
    p_original_file_name: file.name,
    p_mime_type: file.type,
    p_file_size_bytes: file.size,
  })
  if (error) throw error
  return data as DeathCertificateDocument
}

export async function deathCertificateAccessUrl(document: DeathCertificateDocument) {
  if (document.storage_path) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(document.storage_path, 60)
    if (error) throw error
    if (!data.signedUrl) throw new Error('A secure document link could not be created.')
    return data.signedUrl
  }
  if (document.file_url) return document.file_url
  throw new Error('The Death Certificate file is unavailable.')
}
