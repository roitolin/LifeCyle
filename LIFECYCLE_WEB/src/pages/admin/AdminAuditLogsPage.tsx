import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import './AdminActivityPages.css'

type ActivityLog = {
  id: string
  summary?: string
  details?: string
  action?: string
  targetType?: string
  targetId?: string
  targetUserId?: string
  adminId?: string
  createdAt?: string | null
}

type Category = 'all' | 'navigation' | 'actions' | 'security' | 'system'

const filters: { value: Category; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'navigation', label: 'Page visits' },
  { value: 'actions', label: 'Admin actions' },
  { value: 'security', label: 'Security' },
  { value: 'system', label: 'System' },
]

function getCategory(item: ActivityLog): Exclude<Category, 'all'> {
  if (item.targetType === 'screen' || item.action === 'screen_viewed') return 'navigation'
  if (item.targetType === 'security' || String(item.action).includes('session')) return 'security'
  if (item.targetType === 'system') return 'system'
  return 'actions'
}

function readable(value?: string) {
  return String(value || 'activity').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateParts(value?: string | null) {
  if (!value) return { date: 'No date', time: '' }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: 'No date', time: '' }
  return {
    date: parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    time: parsed.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true }),
  }
}

function AdminAuditLogsPage() {
  const [items, setItems] = useState<ActivityLog[]>([])
  const [adminNames, setAdminNames] = useState<Record<string, string>>({})
  const [currentUserId, setCurrentUserId] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      setCurrentUserId(sessionData.session?.user.id || '')
      const { data, error: loadError } = await supabase
        .from('admin_audit_logs')
        .select('*')
        .order('createdAt', { ascending: false })
        .limit(250)
      if (loadError) throw loadError
      const logs = (data || []) as ActivityLog[]
      setItems(logs)
      const ids = [...new Set(logs.map((item) => item.adminId).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: admins } = await supabase.from('users').select('id,email,fullName').in('id', ids)
        setAdminNames(Object.fromEntries((admins || []).map((admin: any) => [admin.id, admin.fullName || admin.email || admin.id])))
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Activity logs could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const counts = useMemo(() => {
    const result: Record<Category, number> = { all: items.length, navigation: 0, actions: 0, security: 0, system: 0 }
    items.forEach((item) => { result[getCategory(item)] += 1 })
    return result
  }, [items])

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return items.filter((item) => {
      if (category !== 'all' && getCategory(item) !== category) return false
      if (!normalized) return true
      const actor = item.adminId ? adminNames[item.adminId] : ''
      return [item.summary, item.details, item.action, item.targetType, item.targetId, actor]
        .some((value) => String(value || '').toLowerCase().includes(normalized))
    })
  }, [adminNames, category, items, query])

  return (
    <section className='panel admin-activity-panel'>
      <div className='admin-page-heading'>
        <div className='admin-page-title-wrap'>
          <span className='admin-page-icon' aria-hidden='true'>
            <svg viewBox='0 0 24 24' fill='none'><path d='M3 12H7L9.2 7L13 17L15.2 12H21' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' /></svg>
          </span>
          <div><h2>Activity Logs</h2><p className='panel-sub'>Review administrator navigation, clicks, account changes, and security events.</p></div>
        </div>
        <button type='button' className='admin-page-action' onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh logs'}
        </button>
      </div>

      <div className='activity-summary-grid'>
        <article><span>Total records</span><strong>{counts.all}</strong><small>Last 250 events</small></article>
        <article><span>Page visits</span><strong>{counts.navigation}</strong><small>Admin navigation</small></article>
        <article><span>Admin actions</span><strong>{counts.actions}</strong><small>Controls and updates</small></article>
        <article><span>Security</span><strong>{counts.security}</strong><small>Session activity</small></article>
      </div>

      <div className='activity-controls'>
        <label className='activity-search'>
          <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'><circle cx='11' cy='11' r='6' strokeWidth='1.8' /><path d='M16 16L21 21' strokeWidth='1.8' strokeLinecap='round' /></svg>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search activity, admin, or target' />
        </label>
        <div className='activity-filters' role='group' aria-label='Activity category'>
          {filters.map((filter) => (
            <button type='button' key={filter.value} className={category === filter.value ? 'active' : ''} onClick={() => setCategory(filter.value)}>
              {filter.label}<span>{counts[filter.value]}</span>
            </button>
          ))}
        </div>
      </div>

      {error ? <div className='admin-inline-alert error'>{error}</div> : null}
      {loading && !items.length ? <div className='admin-empty-state'>Loading activity records...</div> : null}
      {!loading && !visible.length ? <div className='admin-empty-state'>{error ? 'Activity is unavailable.' : 'No activity matches these filters.'}</div> : null}

      {visible.length ? (
        <div className='table-wrap activity-table-wrap'>
          <table className='request-table activity-table'>
            <thead><tr><th>Activity</th><th>Administrator</th><th>Area</th><th>Date and time</th></tr></thead>
            <tbody>
              {visible.map((item) => {
                const itemCategory = getCategory(item)
                const actor = item.adminId === currentUserId ? 'You' : item.adminId ? adminNames[item.adminId] || item.adminId : 'Unknown admin'
                const targetId = item.targetId || item.targetUserId
                const when = dateParts(item.createdAt)
                return (
                  <tr key={item.id}>
                    <td data-label='Activity'>
                      <div className='activity-primary'><div><strong>{readable(item.action)}</strong><p>{item.summary || item.details || 'Activity recorded'}</p></div></div>
                    </td>
                    <td data-label='Administrator'><strong className='activity-actor'>{actor}</strong><small>{item.adminId === currentUserId ? 'Current account' : item.adminId || 'No ID'}</small></td>
                    <td data-label='Area'><span className={`activity-type-badge ${itemCategory}`}>{readable(item.targetType || itemCategory)}</span>{targetId ? <small className='activity-target'>{targetId}</small> : null}</td>
                    <td data-label='Date and time'><span className='activity-date'>{when.date}</span><small>{when.time}</small></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <footer className='activity-footer'><span>Showing {visible.length} of {items.length} records</span><span>Newest activity first</span></footer>
    </section>
  )
}

export default AdminAuditLogsPage
