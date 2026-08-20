import { useCallback, useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getWebAdminDeviceInfo, logWebAdminActivity, recordWebAdminLoginActivity, type WebAdminDeviceInfo } from '@/utils/adminActivity'
import './AdminActivityPages.css'

type AdminRole = 'super_admin' | 'admin' | 'funeral_admin' | 'user'
type LoginActivity = {
  id: string
  adminId: string
  adminEmail?: string
  event: 'login_success' | 'logout' | 'other_sessions_signed_out'
  deviceId?: string
  deviceName?: string
  deviceType?: string
  platform?: string
  osVersion?: string
  browser?: string
  screenSize?: string
  ipAddress?: string
  country?: string
  createdAt?: string
}

const eventLabels = {
  login_success: 'Successful sign-in',
  logout: 'Signed out',
  other_sessions_signed_out: 'Other sessions secured',
} as const

function dateParts(value?: string) {
  if (!value) return { date: 'No date', time: '' }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: 'No date', time: '' }
  return {
    date: parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true }),
  }
}

function AdminLoginSecurityPage() {
  const [user, setUser] = useState<User | null>(null)
  const [role, setRole] = useState<AdminRole>('user')
  const [device, setDevice] = useState<WebAdminDeviceInfo | null>(null)
  const [items, setItems] = useState<LoginActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [securing, setSecuring] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDevice(getWebAdminDeviceInfo())
      const { data: sessionData } = await supabase.auth.getSession()
      const currentUser = sessionData.session?.user || null
      setUser(currentUser)
      if (currentUser) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', currentUser.id).maybeSingle()
        setRole((String(profile?.role || 'user').toLowerCase() as AdminRole) || 'user')
      }
      const { data, error: loadError } = await supabase.from('admin_login_activity').select('*').order('createdAt', { ascending: false }).limit(100)
      if (loadError) throw loadError
      setItems((data || []) as LoginActivity[])
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Login history could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const stats = useMemo(() => ({
    signIns: items.filter((item) => item.event === 'login_success').length,
    devices: new Set(items.map((item) => item.deviceId).filter(Boolean)).size,
    latest: items[0]?.createdAt ? dateParts(items[0].createdAt).date : 'No activity',
  }), [items])

  const signOutOthers = async () => {
    if (!window.confirm('Sign out every other device? This browser will remain signed in.')) return
    setSecuring(true)
    setNotice('')
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' })
      if (signOutError) throw signOutError
      await Promise.all([
        recordWebAdminLoginActivity('other_sessions_signed_out', role),
        logWebAdminActivity({ adminId: user?.id, action: 'other_sessions_signed_out', targetType: 'security', targetId: user?.id, summary: 'Signed out all other account sessions.' }),
      ])
      setNotice('Your other sessions have been signed out.')
      await load()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Other sessions could not be signed out.')
    } finally {
      setSecuring(false)
    }
  }

  return (
    <section className='panel admin-security-panel'>
      <div className='admin-page-heading'>
        <div className='admin-page-title-wrap'>
          <span className='admin-page-icon' aria-hidden='true'>
            <svg viewBox='0 0 24 24' fill='none'><path d='M6 11H18V21H6V11Z' strokeWidth='1.8' strokeLinejoin='round' /><path d='M9 11V8A3 3 0 0 1 15 8V11' strokeWidth='1.8' strokeLinecap='round' /><path d='M12 15V17' strokeWidth='1.8' strokeLinecap='round' /></svg>
          </span>
          <div><h2>Login &amp; Security</h2><p className='panel-sub'>Monitor account access, browser details, locations, and active sessions.</p></div>
        </div>
        <button type='button' className='admin-page-action' onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh activity'}</button>
      </div>

      {notice ? <div className='admin-inline-alert success'>{notice}</div> : null}
      {error ? <div className='admin-inline-alert error'>{error}</div> : null}

      <div className='security-summary-grid'>
        <article><span>Current session</span><strong className='status-value'>Active</strong><small>{device?.browser || 'Detecting browser'}</small></article>
        <article><span>Recorded sign-ins</span><strong>{stats.signIns}</strong><small>Latest 100 events</small></article>
        <article><span>Known devices</span><strong>{stats.devices}</strong><small>Based on browser IDs</small></article>
        <article><span>Latest activity</span><strong className='date-value'>{stats.latest}</strong><small>Newest event recorded</small></article>
      </div>

      <div className='security-overview-grid'>
        <article className='security-session-card'>
          <div className='security-card-header'><div><span className='admin-section-label'>CURRENT BROWSER</span><h3>{device?.device_name || 'Detecting this browser...'}</h3></div><span className='session-active-badge'>ACTIVE NOW</span></div>
          <div className='session-details'>
            <div><span>Device type</span><strong>{device?.device_type || 'Unavailable'}</strong></div>
            <div><span>Operating system</span><strong>{device?.os_version || 'Unavailable'}</strong></div>
            <div><span>Screen size</span><strong>{device?.screen_size || 'Unavailable'}</strong></div>
            <div><span>Last account sign-in</span><strong>{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString(undefined, { hour12: true }) : 'Unavailable'}</strong></div>
          </div>
        </article>

        <aside className='security-action-card'>
          <span className='admin-section-label'>SECURITY ACTION</span>
          <h3>Unrecognized access?</h3>
          <p>Revoke all other active sessions while keeping this browser signed in.</p>
          <button type='button' onClick={() => void signOutOthers()} disabled={securing}>{securing ? 'Securing account...' : 'Sign out other devices'}</button>
          <small>You will not be signed out from this browser.</small>
        </aside>
      </div>

      <div className='admin-section-heading'>
        <div><h3>{role === 'super_admin' ? 'Admin login activity' : 'Your login activity'}</h3><p className='panel-sub'>Recent sign-ins, sign-outs, devices, and network information.</p></div>
        <span>{items.length} events</span>
      </div>

      {loading && !items.length ? <div className='admin-empty-state'>Loading login activity...</div> : null}
      {!loading && !items.length ? <div className='admin-empty-state'>{error ? 'Login history is unavailable.' : 'No login history has been recorded yet.'}</div> : null}

      {items.length ? (
        <div className='table-wrap security-table-wrap'>
          <table className='request-table security-table'>
            <thead><tr><th>Event</th><th>Account</th><th>Device</th><th>Network</th><th>Date and time</th></tr></thead>
            <tbody>{items.map((item) => {
              const current = Boolean(device?.device_id && item.deviceId === device.device_id)
              const when = dateParts(item.createdAt)
              return (
                <tr key={item.id}>
                  <td data-label='Event'><span className={`security-event-badge ${item.event}`}>{eventLabels[item.event] || 'Account activity'}</span>{current ? <span className='current-device-label'>Current device</span> : null}</td>
                  <td data-label='Account'><strong>{role === 'super_admin' ? item.adminEmail || 'Admin account' : user?.email || 'Your account'}</strong><small>{item.adminId === user?.id ? 'Current account' : 'Administrator'}</small></td>
                  <td data-label='Device'><strong>{item.deviceName || 'Unknown device'}</strong><small>{[item.browser, item.osVersion].filter(Boolean).join(' / ') || item.platform || 'Platform unavailable'}</small></td>
                  <td data-label='Network'><span>{item.ipAddress || 'IP unavailable'}</span><small>{item.country || 'Location unavailable'}</small></td>
                  <td data-label='Date and time'><span className='activity-date'>{when.date}</span><small>{when.time}</small></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

export default AdminLoginSecurityPage
