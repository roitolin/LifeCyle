import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Link } from 'react-router-dom'

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

  const statusColor = (s: string) => {
    if (s === 'verified') return '#26a25b'
    if (s === 'live') return '#1677ff'
    if (s === 'offline') return '#64748b'
    if (s === 'pending') return '#f59e0b'
    if (s === 'rejected') return '#ef4444'
    return '#64748b'
  }

  return (
    <section className="panel">
      <h2>System Overview</h2>
      <p className="panel-sub">Monitor users, funeral shops, products, service requests, and feedback.</p>

      {loading ? <p className="panel-sub">Loading admin dashboard...</p> : null}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}

      {!loading && !error && (
        <>
          <div className="stats-grid">
            <article className="stat-card"><strong>{stats.totalUsers}</strong><span>Total Users</span></article>
            <article className="stat-card"><strong>{stats.totalShops}</strong><span>Funeral Shops</span></article>
            <article className="stat-card"><strong>{stats.pendingShops}</strong><span>Pending Shops</span></article>
            <article className="stat-card"><strong>{stats.verifiedShops}</strong><span>Verified Shops</span></article>
            <article className="stat-card"><strong>{stats.liveShops}</strong><span>Live Shops</span></article>
            <article className="stat-card"><strong>{stats.rejectedShops}</strong><span>Rejected Shops</span></article>
            <article className="stat-card"><strong>{stats.totalProducts}</strong><span>Total Products</span></article>
            <article className="stat-card"><strong>{stats.activeProducts}</strong><span>Active Products</span></article>
            <article className="stat-card"><strong>{stats.totalRequests}</strong><span>Service Requests</span></article>
            <article className="stat-card"><strong>{stats.pendingRequests}</strong><span>Pending Requests</span></article>
            <article className="stat-card"><strong>{stats.totalFeedback}</strong><span>Feedback Entries</span></article>
          </div>

          <div className="quick-actions">
            <Link to="/admin/users" className="ghost-btn btn-link">Manage Users</Link>
            <Link to="/admin/funeral-shops" className="ghost-btn btn-link">Review Shops</Link>
            <Link to="/admin/orders" className="ghost-btn btn-link">Manage Service Requests</Link>
            <Link to="/admin/payments" className="ghost-btn btn-link">Payments</Link>
            <Link to="/admin/moderation" className="ghost-btn btn-link">Moderation</Link>
          </div>

          <h3 style={{ marginTop: '18px' }}>Recent Users</h3>
          {recentUsers.length === 0 ? (
            <p className="panel-sub">No users found.</p>
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

          <h3 style={{ marginTop: '18px' }}>Recent Funeral Shops</h3>
          {recentShops.length === 0 ? (
            <p className="panel-sub">No funeral shops found.</p>
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
                      <td style={{ color: statusColor(s.status), fontWeight: 700 }}>{s.status}</td>
                      <td>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default AdminDashboardPage
