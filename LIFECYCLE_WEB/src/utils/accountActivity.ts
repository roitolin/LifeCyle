import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type AccountLoginEvent = 'login_success' | 'logout'
export type AccountSessionHealth = 'active' | 'revoked' | 'unavailable'

type WebAccountDeviceInfo = {
  device_id: string
  device_name: string
  device_type: string
  platform: string
  os_version: string
  browser: string
  screen_size: string
  user_agent: string
}

const DEVICE_ID_KEY = 'lifecycle_account_device_id'

function getBrowserName(userAgent: string) {
  if (/Edg\//i.test(userAgent)) return 'Microsoft Edge'
  if (/OPR\//i.test(userAgent)) return 'Opera'
  if (/Chrome\//i.test(userAgent)) return 'Google Chrome'
  if (/Firefox\//i.test(userAgent)) return 'Mozilla Firefox'
  if (/Safari\//i.test(userAgent)) return 'Safari'
  return 'Web browser'
}

function getOperatingSystem(userAgent: string) {
  const windows = userAgent.match(/Windows NT ([\d.]+)/i)
  if (windows) return 'Windows ' + windows[1]
  const android = userAgent.match(/Android ([\d.]+)/i)
  if (android) return 'Android ' + android[1]
  const ios = userAgent.match(/(?:iPhone OS|CPU OS) ([\d_]+)/i)
  if (ios) return 'iOS ' + ios[1].replace(/_/g, '.')
  const mac = userAgent.match(/Mac OS X ([\d_]+)/i)
  if (mac) return 'macOS ' + mac[1].replace(/_/g, '.')
  if (/Linux/i.test(userAgent)) return 'Linux'
  return navigator.platform || 'Unknown OS'
}

function getDeviceId() {
  const stored = window.localStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored

  const created =
    globalThis.crypto?.randomUUID?.() ||
    'web-' + Date.now() + '-' + Math.random().toString(16).slice(2)
  window.localStorage.setItem(DEVICE_ID_KEY, created)
  return created
}

export function getWebAccountDeviceInfo(): WebAccountDeviceInfo {
  const userAgent = navigator.userAgent || 'Unknown browser'
  const browser = getBrowserName(userAgent)
  const operatingSystem = getOperatingSystem(userAgent)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)

  return {
    device_id: getDeviceId(),
    device_name: browser + ' on ' + operatingSystem,
    device_type: isMobile ? 'Mobile browser' : 'Web browser',
    platform: 'web',
    os_version: operatingSystem,
    browser,
    screen_size: window.screen.width + 'x' + window.screen.height,
    user_agent: userAgent,
  }
}

async function resolveSession(session?: Session | null) {
  if (session) return session
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

async function resolveSessionId(session?: Session | null) {
  const activeSession = await resolveSession(session)
  if (!activeSession) return null

  const { data, error } = await supabase.auth.getClaims(activeSession.access_token)
  if (error) throw error

  const sessionId = String(data?.claims?.session_id || '').trim()
  return sessionId || null
}

export async function registerWebAccountSession(
  session?: Session | null,
): Promise<AccountSessionHealth> {
  try {
    const sessionId = await resolveSessionId(session)
    if (!sessionId) return 'unavailable'

    const { data, error } = await supabase.rpc('register_account_session', {
      p_session_id: sessionId,
      p_device: getWebAccountDeviceInfo(),
    })
    if (error) {
      console.warn('Web account session could not be registered:', error.message)
      return 'unavailable'
    }
    return data ? 'active' : 'revoked'
  } catch (error) {
    console.warn('Web account session could not be registered:', error)
    return 'unavailable'
  }
}

export async function verifyWebAccountSession(): Promise<AccountSessionHealth> {
  try {
    const sessionId = await resolveSessionId()
    if (!sessionId) return 'revoked'

    const { data, error } = await supabase.rpc('touch_account_session', {
      p_session_id: sessionId,
    })
    if (error) {
      console.warn('Web account session could not be verified:', error.message)
      return 'unavailable'
    }
    return data ? 'active' : 'revoked'
  } catch (error) {
    console.warn('Web account session could not be verified:', error)
    return 'unavailable'
  }
}

export async function recordWebAccountLoginActivity(event: AccountLoginEvent) {
  try {
    const { error } = await supabase.rpc('record_account_login_activity', {
      p_event: event,
      p_device: getWebAccountDeviceInfo(),
    })
    if (error) console.warn('Web login activity could not be recorded:', error.message)
  } catch (error) {
    console.warn('Web login activity could not be recorded:', error)
  }
}

export async function markWebAccountSessionSignedOut(reason = 'signed_out') {
  try {
    const sessionId = await resolveSessionId()
    if (!sessionId) return

    const { error } = await supabase.rpc('mark_current_account_session_signed_out', {
      p_session_id: sessionId,
      p_reason: reason,
    })
    if (error) console.warn('Web account session could not be marked signed out:', error.message)
  } catch (error) {
    console.warn('Web account session could not be marked signed out:', error)
  }
}
