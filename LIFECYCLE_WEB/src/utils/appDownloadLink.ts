import { supabase } from '@/lib/supabase'
import { logWebAdminActivity } from '@/utils/adminActivity'

export const ENV_APP_DOWNLOAD_URL =
  (import.meta.env.VITE_APP_DOWNLOAD_URL as string | undefined)?.trim() || ''

export type AppDownloadSettings = {
  downloadUrl: string
  isActive: boolean
  updatedAt: string
}

export function normalizeAppDownloadUrl(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim()
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return ''

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    if (!parsed.hostname) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export function validateAppDownloadUrlInput(raw: string):
  | { ok: true; url: string }
  | { ok: false; error: string } {
  const trimmed = String(raw || '').trim()
  if (!trimmed) {
    return { ok: true, url: '' }
  }
  if (trimmed.length > 2048) {
    return { ok: false, error: 'Use a link with at most 2,048 characters.' }
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: 'Remove spaces from the download link.' }
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ok: false,
        error: 'Enter a valid web link starting with https:// or http://.',
      }
    }
    if (!parsed.hostname) {
      return {
        ok: false,
        error: 'Enter a complete download link (for example, https://play.google.com/store/apps/...).',
      }
    }
    return { ok: true, url: parsed.toString() }
  } catch {
    return {
      ok: false,
      error: 'Enter a complete link starting with https:// or http://.',
    }
  }
}

export function isMissingAppDownloadTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  const code = String(record.code || '')
  const message = String(record.message || '').toLowerCase()
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    message.includes('app_download_settings') &&
      (message.includes('schema cache') || message.includes('does not exist'))
  )
}

export async function fetchPublicAppDownloadUrl(): Promise<string> {
  const fallback = normalizeAppDownloadUrl(ENV_APP_DOWNLOAD_URL)

  try {
    const { data, error } = await supabase
      .from('app_download_settings')
      .select('download_url, is_active')
      .eq('id', 1)
      .maybeSingle()

    if (error || !data || !data.is_active) return fallback
    return normalizeAppDownloadUrl(data.download_url as string | null) || fallback
  } catch {
    return fallback
  }
}

export async function fetchAdminAppDownloadSettings(): Promise<{
  settings: AppDownloadSettings
  tableMissing: boolean
}> {
  const { data, error } = await supabase
    .from('app_download_settings')
    .select('download_url, is_active, updated_at')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    if (isMissingAppDownloadTableError(error)) {
      return {
        settings: { downloadUrl: '', isActive: false, updatedAt: '' },
        tableMissing: true,
      }
    }
    throw error
  }

  return {
    settings: {
      downloadUrl: normalizeAppDownloadUrl((data?.download_url as string | null) || '') ||
        String(data?.download_url || '').trim(),
      isActive: Boolean(data?.is_active),
      updatedAt: String(data?.updated_at || ''),
    },
    tableMissing: false,
  }
}

export async function saveAdminAppDownloadSettings(input: {
  downloadUrl: string | null
  isActive: boolean
}): Promise<AppDownloadSettings> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('Your admin session expired. Sign in again.')

  const cleanedUrl = input.downloadUrl ? normalizeAppDownloadUrl(input.downloadUrl) : ''
  if (input.downloadUrl && !cleanedUrl) {
    throw new Error('Enter a valid link starting with https:// or http://.')
  }
  if (input.isActive && !cleanedUrl) {
    throw new Error('Enter a valid download link before enabling public redirects.')
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('app_download_settings')
    .upsert(
      {
        id: 1,
        download_url: cleanedUrl || null,
        is_active: Boolean(cleanedUrl && input.isActive),
        updated_by: userData.user.id,
        updated_at: nowIso,
      },
      { onConflict: 'id' },
    )
    .select('download_url, is_active, updated_at')
    .single()

  if (error) throw error

  void logWebAdminActivity({
    adminId: userData.user.id,
    action: cleanedUrl ? 'app_download_link_saved' : 'app_download_link_cleared',
    targetType: 'app_download_settings',
    targetId: '1',
    summary: cleanedUrl
      ? `${input.isActive ? 'Enabled' : 'Saved (paused)'} the Install Our App redirect link.`
      : 'Cleared the Install Our App redirect link.',
    metadata: {
      isActive: Boolean(cleanedUrl && input.isActive),
      hasUrl: Boolean(cleanedUrl),
    },
  })

  return {
    downloadUrl: String(data?.download_url || '').trim(),
    isActive: Boolean(data?.is_active),
    updatedAt: String(data?.updated_at || nowIso),
  }
}

