import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'
import {
  loadCommandCenterOperations,
  operationAge,
  type OperationCounts,
  type OperationItem,
  type OperationKind,
} from './adminOperations'
import './AdminOperations.css'

type DashboardStats = {
  totalUsers: number
  totalShops: number
  pendingShops: number
  verifiedShops: number
  liveShops: number
  rejectedShops: number
  totalProducts: number
  activeProducts: number
  totalRequests: number
  pendingRequests: number
  totalFeedback: number
}

type RecentUser = {
  id: string
  email: string
  fullName: string | null
  role: string | null
  createdAt: string | null
}

type RecentShop = {
  id: string
  shopName: string
  status: string
  generalLocation: string | null
  createdAt: string | null
}

const EMPTY_OPERATION_COUNTS: OperationCounts = { shop: 0, payment: 0, refund: 0, deletion: 0, service: 0 }
const OPERATION_LABELS: Record<OperationKind, string> = {
  shop: 'Shop application',
  payment: 'Payment verification',
  refund: 'Refund request',
  deletion: 'Privacy request',
  service: 'Service escalation',
}

function AdminDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalShops: 0,
    pendingShops: 0,
    verifiedShops: 0,
    liveShops: 0,
    rejectedShops: 0,
    totalProducts: 0,
    activeProducts: 0,
    totalRequests: 0,
    pendingRequests: 0,
    totalFeedback: 0,
  })
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([])
  const [recentShops, setRecentShops] = useState<RecentShop[]>([])
  const [adminRole, setAdminRole] = useState('')
  const [operationItems, setOperationItems] = useState<OperationItem[]>([])
  const [operationCounts, setOperationCounts] = useState<OperationCounts>(EMPTY_OPERATION_COUNTS)
  const [operationsLoading, setOperationsLoading] = useState(true)
  const [operationsError, setOperationsError] = useState('')

  useEffect(() => {
    const loadOperations = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser()
        const userId = authData.user?.id
        if (!userId) return
        const { data: profile } = await supabase.from('users').select('role').eq('id', userId).maybeSingle()
        const role = String(profile?.role || '').toLowerCase()
        setAdminRole(role)
        if (!['admin', 'super_admin'].includes(role)) return
        const result = await loadCommandCenterOperations()
        setOperationItems(result.items)
        setOperationCounts(result.counts)
      } catch (loadError) {
        setOperationsError(loadError instanceof Error ? loadError.message : 'Unable to load the operations queue.')
      } finally {
        setOperationsLoading(false)
      }
    }
    void loadOperations()
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [
          usersRes,
          shopsRes,
          pendingShopsRes,
          verifiedShopsRes,
          liveShopsRes,
          rejectedShopsRes,
          productsRes,
          activeProductsRes,
          requestsRes,
          pendingRequestsRes,
          feedbackRes,
          recentUsersRes,
          recentShopsRes,
        ] = await Promise.all([
          supabase.from('users').select('*', { count: 'exact', head: true }),
          supabase.from('funeral_shops').select('*', { count: 'exact', head: true }),
          supabase.from('funeral_shops').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('funeral_shops').select('*', { count: 'exact', head: true }).eq('status', 'verified'),
          supabase.from('funeral_shops').select('*', { count: 'exact', head: true }).eq('status', 'live'),
          supabase.from('funeral_shops').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
          supabase.from('funeral_products').select('*', { count: 'exact', head: true }),
          supabase.from('funeral_products').select('*', { count: 'exact', head: true }).eq('active', true),
          supabase.from('funeral_service_requests').select('*', { count: 'exact', head: true }),
          supabase.from('funeral_service_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending_shop_acceptance'),
          supabase.from('app_feedback').select('*', { count: 'exact', head: true }),
          supabase.from('users').select('id, email, fullName, role, createdAt').order('createdAt', { ascending: false }).limit(5),
          supabase.from('funeral_shops').select('id, shopName, status, generalLocation, createdAt').order('createdAt', { ascending: false }).limit(5),
        ])

        setStats({
          totalUsers: usersRes.count ?? 0,
          totalShops: shopsRes.count ?? 0,
          pendingShops: pendingShopsRes.count ?? 0,
          verifiedShops: verifiedShopsRes.count ?? 0,
          liveShops: liveShopsRes.count ?? 0,
          rejectedShops: rejectedShopsRes.count ?? 0,
          totalProducts: productsRes.count ?? 0,
          activeProducts: activeProductsRes.count ?? 0,
          totalRequests: requestsRes.count ?? 0,
          pendingRequests: pendingRequestsRes.count ?? 0,
          totalFeedback: feedbackRes.count ?? 0,
        })

        setRecentUsers((recentUsersRes.data ?? []) as RecentUser[])
        setRecentShops((recentShopsRes.data ?? []) as RecentShop[])
      } catch {
        setError('Unable to load admin metrics right now.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const isRootAdmin = adminRole === 'admin' || adminRole === 'super_admin'

  return (
    <section className="panel admin-dashboard-page">
      <div className="dashboard-intro">
        <div>
          <h2>System overview</h2>
          <p className="panel-sub">Platform totals and pending administrative work.</p>
        </div>
        <span className="dashboard-date">
          Updated {new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}
        </span>
      </div>

      {loading ? <div className="admin-loading-state">Loading dashboard data...</div> : null}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}

      {!loading && !error && (
        <>
          <div className="dashboard-metrics" aria-label="Platform totals">
            <article className="dashboard-metric">
              <span>Registered users</span>
              <strong>{stats.totalUsers.toLocaleString()}</strong>
              <small>Across all account types</small>
            </article>
            <article className="dashboard-metric">
              <span>Funeral shops</span>
              <strong>{stats.totalShops.toLocaleString()}</strong>
              <small>{stats.liveShops.toLocaleString()} currently live</small>
            </article>
            <article className="dashboard-metric">
              <span>Catalog items</span>
              <strong>{stats.totalProducts.toLocaleString()}</strong>
              <small>{stats.activeProducts.toLocaleString()} active listings</small>
            </article>
            <article className="dashboard-metric">
              <span>Service requests</span>
              <strong>{stats.totalRequests.toLocaleString()}</strong>
              <small>{stats.pendingRequests.toLocaleString()} awaiting action</small>
            </article>
          </div>

          <section className="dashboard-section">
            <div className="dashboard-section-head">
              <div>
                <h3>Pending work</h3>
                <p>Open items by administrative area.</p>
              </div>
            </div>
            <div className="dashboard-queue">
              {isRootAdmin ? (
                <>
                  <Link to="/admin/funeral-shops" className="dashboard-queue-row"><span><strong>Shop applications</strong><small>Waiting for registration review</small></span><b>{operationCounts.shop}</b></Link>
                  <Link to="/admin/payments" className="dashboard-queue-row"><span><strong>Payment verification</strong><small>Shop submissions awaiting review</small></span><b>{operationCounts.payment}</b></Link>
                  <Link to="/admin/payments?tab=refunds" className="dashboard-queue-row"><span><strong>Service refunds</strong><small>Pending or approved refund requests</small></span><b>{operationCounts.refund}</b></Link>
                  <Link to="/admin/account-deletions" className="dashboard-queue-row"><span><strong>Account deletions</strong><small>Verified privacy requests</small></span><b>{operationCounts.deletion}</b></Link>
                  <Link to="/admin/orders" className="dashboard-queue-row"><span><strong>Service escalations</strong><small>Requests or payments awaiting action</small></span><b>{operationCounts.service}</b></Link>
                </>
              ) : (
                <>
                  <Link to="/admin/funeral-shops" className="dashboard-queue-row"><span><strong>Shop applications</strong><small>Waiting for registration review</small></span><b>{stats.pendingShops}</b></Link>
                  <Link to="/admin/orders" className="dashboard-queue-row"><span><strong>Pending service requests</strong><small>Not yet accepted by a shop</small></span><b>{stats.pendingRequests}</b></Link>
                  <Link to="/admin/feedback" className="dashboard-queue-row"><span><strong>Feedback entries</strong><small>Customer feedback on record</small></span><b>{stats.totalFeedback}</b></Link>
                  <Link to="/admin/funeral-shops" className="dashboard-queue-row"><span><strong>Rejected shops</strong><small>Applications with a recorded decision</small></span><b>{stats.rejectedShops}</b></Link>
                </>
              )}
            </div>
          </section>

          {isRootAdmin ? (
            <section className="dashboard-section dashboard-priority-queue">
              <div className="dashboard-section-head">
                <div><h3>Priority queue</h3><p>Oldest and highest-risk open items.</p></div>
              </div>
              {operationsLoading ? <div className="operations-state">Loading prioritized work...</div> : null}
              {operationsError ? <p className="auth-message auth-message-error">{operationsError}</p> : null}
              {!operationsLoading && !operationsError && operationItems.length === 0 ? <div className="operations-empty small"><h3>No priority items</h3><p>There is no open work in this queue.</p></div> : null}
              {!operationsLoading && operationItems.length > 0 ? (
                <div className="operations-queue-list">
                  {operationItems.slice(0, 8).map((item) => (
                    <article className="operations-queue-card" key={item.kind + '-' + item.id}>
                      <div className="operations-queue-copy">
                        <div className="operations-queue-heading">
                          <span className={'operations-priority is-' + item.priority}>{item.priority}</span>
                          <span className="operations-kind-label">{OPERATION_LABELS[item.kind]}</span>
                          <span className="operations-age">{operationAge(item.createdAt)}</span>
                        </div>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                      </div>
                      <div className="operations-queue-action"><Link to={item.href}>Review</Link></div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="dashboard-section dashboard-table-section">
            <div className="dashboard-section-head"><h3>Recent users</h3></div>
            {recentUsers.length === 0 ? (
              <p className="panel-sub dashboard-table-empty">No users found.</p>
            ) : (
              <div className="table-wrap">
                <table className="request-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.map(u => (
                    <tr key={u.id}>
                      <td>{u.fullName || '—'}</td>
                      <td>{u.email}</td>
                      <td>{u.role || 'user'}</td>
                      <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="dashboard-section dashboard-table-section">
            <div className="dashboard-section-head"><h3>Recent funeral shops</h3></div>
            {recentShops.length === 0 ? (
              <p className="panel-sub dashboard-table-empty">No funeral shops found.</p>
            ) : (
              <div className="table-wrap">
                <table className="request-table">
                <thead>
                  <tr>
                    <th>Shop Name</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {recentShops.map(s => (
                    <tr key={s.id}>
                      <td>{s.shopName}</td>
                      <td>{s.generalLocation || '—'}</td>
                      <td><span className={`status-pill ${s.status || 'none'}`}>{s.status || 'Not set'}</span></td>
                      <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

export default AdminDashboardPage
