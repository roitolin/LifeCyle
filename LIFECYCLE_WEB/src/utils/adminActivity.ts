import { supabase } from '@/lib/supabase'

export type AdminLoginEvent = 'login_success' | 'logout' | 'other_sessions_signed_out'

export type WebAdminDeviceInfo = {
  device_id: string
  device_name: string
  device_type: string
  platform: string
  os_version: string
  browser: string
  screen_size: string
  user_agent: string
}

type ActivityPayload = {
  adminId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  summary: string
  metadata?: Record<string, unknown>
}

const DEVICE_ID_KEY = 'lifecycle_admin_device_id'
const ADMIN_ROLES = new Set(['admin', 'super_admin', 'funeral_admin'])

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
  if (windows) return `Windows ${windows[1]}`
  const android = userAgent.match(/Android ([\d.]+)/i)
  if (android) return `Android ${android[1]}`
  const ios = userAgent.match(/(?:iPhone OS|CPU OS) ([\d_]+)/i)
  if (ios) return `iOS ${ios[1].replace(/_/g, '.')}`
  const mac = userAgent.match(/Mac OS X ([\d_]+)/i)
  if (mac) return `macOS ${mac[1].replace(/_/g, '.')}`
  if (/Linux/i.test(userAgent)) return 'Linux'
  return navigator.platform || 'Unknown OS'
}

function getDeviceId() {
  const stored = window.localStorage.getItem(DEVICE_ID_KEY)
  if (stored) return stored
  const created = globalThis.crypto?.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`
  window.localStorage.setItem(DEVICE_ID_KEY, created)
  return created
}

export function getWebAdminDeviceInfo(): WebAdminDeviceInfo {
  const userAgent = navigator.userAgent || 'Unknown browser'
  const browser = getBrowserName(userAgent)
  const operatingSystem = getOperatingSystem(userAgent)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)

  return {
    device_id: getDeviceId(),
    device_name: `${browser} on ${operatingSystem}`,
    device_type: isMobile ? 'Mobile browser' : 'Web browser',
    platform: navigator.platform || 'web',
    os_version: operatingSystem,
    browser,
    screen_size: `${window.screen.width}x${window.screen.height}`,
    user_agent: userAgent,
  }
}

export async function recordWebAdminLoginActivity(event: AdminLoginEvent, role?: string | null) {
  if (role && !ADMIN_ROLES.has(role)) return
  try {
    const { error } = await supabase.rpc('record_admin_login_activity', {
      p_event: event,
      p_device: getWebAdminDeviceInfo(),
    })
    if (error) console.warn('Admin login activity could not be recorded:', error.message)
  } catch (error) {
    console.warn('Admin login activity could not be recorded:', error)
  }
}

export async function logWebAdminActivity(payload: ActivityPayload) {
  if (!payload.adminId) return
  try {
    const { error } = await supabase.from('admin_audit_logs').insert({
      adminId: payload.adminId,
      action: payload.action,
      targetType: payload.targetType,
      targetId: payload.targetId || null,
      summary: payload.summary,
      metadata: { source: 'web', ...(payload.metadata || {}) },
    })
    if (error) console.warn('Admin activity could not be recorded:', error.message)
  } catch (error) {
    console.warn('Admin activity could not be recorded:', error)
  }
}
