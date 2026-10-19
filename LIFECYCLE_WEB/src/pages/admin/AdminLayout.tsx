import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { logWebAdminActivity, recordWebAdminLoginActivity } from '@/utils/adminActivity'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import NotificationDropdown, { type WebNotification } from '@/components/NotificationDropdown'
import './AdminLayout.css'

type ProfileData = {
  fullName: string
  photoURL: string
  gender: string
}

type AdminRole = 'super_admin' | 'admin' | 'funeral_admin' | 'user'

function getDefaultAvatar(gender: string) {
  if (gender === 'female') return '/Female.png'
  return '/Male.png'
}

function resolveAdminNotificationRoute(item: WebNotification) {
  const type = String(item.type || '').toLowerCase()
  const data = item.data || {}
  const requestId = data.requestId || data.serviceRequestId
  const shopId = data.shopId
  const userId = data.userId

  if (requestId) return '/admin/orders/' + encodeURIComponent(String(requestId))
  if (type.includes('order') || type.includes('request') || type.includes('booking') || type.includes('casket')) return '/admin/orders'
  if (type.includes('payout')) return '/admin/payout-accounts'
  if (type.includes('payment')) return '/admin/payments'
  if (shopId) return '/admin/funeral-shops/' + encodeURIComponent(String(shopId)) + '/details'
  if (type.includes('shop')) return '/admin/funeral-shops'
  if (type.includes('account_deletion')) return '/admin/account-deletions'
  if (type.includes('feedback') || type.includes('review')) return '/admin/feedback'
  if (type.includes('support') || type.includes('message') || type.includes('chat')) return '/admin/support'
  if (userId) return '/admin/users/' + encodeURIComponent(String(userId))
  if (type.includes('user') || type.includes('account')) return '/admin/users'
  return '/admin/dashboard'
}


function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<AdminRole>('user')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [profile, setProfile] = useState<ProfileData>({ fullName: 'Admin', photoURL: '', gender: '' })
  const lastTrackedClickRef = useRef({ signature: '', time: 0 })
  const { openConfirm, confirmDialog } = useConfirmDialog()

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return
      try {
        const { data } = await supabase
          .from('users')
          .select('fullName, photoURL, gender, role')
          .eq('id', user.id)
          .maybeSingle()
        const profileData = data as { fullName?: string; photoURL?: string; gender?: string; role?: string } | null
        setProfile({
          fullName: profileData?.fullName?.trim() || 'Admin',
          photoURL: profileData?.photoURL?.trim() || '',
          gender: String(profileData?.gender || '').toLowerCase(),
        })
        setUserRole((String(profileData?.role || 'user').toLowerCase() as AdminRole) || 'user')
      } catch {
        setProfile({ fullName: 'Admin', photoURL: '', gender: '' })
        setUserRole('user')
      }
    }
    void loadProfile()
  }, [user])

  const avatarSrc = profile.photoURL || getDefaultAvatar(profile.gender)
  const isRootAdmin = userRole === 'super_admin' || userRole === 'admin'
  const isFuneralAdmin = isRootAdmin || userRole === 'funeral_admin'
  const adminTitle =
    userRole === 'super_admin'
      ? 'Super Admin Console'
      : userRole === 'funeral_admin'
        ? 'Funeral Admin Console'
        : 'Admin Console'
  const homePath = '/admin/dashboard'
  const homeLabel = 'Dashboard'
  const handleLogout = async () => {
    await Promise.allSettled([
      recordWebAdminLoginActivity('logout', userRole),
      logWebAdminActivity({
        adminId: user?.id,
        action: 'logout_clicked',
        targetType: 'security',
        targetId: user?.id,
        summary: 'Signed out of the admin web console.',
      }),
    ])
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    navigate('/')
  }

  const confirmLogout = () => {
    setMenuOpen(false)
    openConfirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log Out',
      cancelLabel: 'Cancel',
      pendingLabel: 'Logging out...',
      tone: 'session',
      onConfirm: handleLogout,
    })
  }

  useEffect(() => {
    if (!user || !['admin', 'super_admin', 'funeral_admin'].includes(userRole)) return
    void logWebAdminActivity({
      adminId: user.id,
      action: 'screen_viewed',
      targetType: 'screen',
      targetId: location.pathname,
      summary: `Opened ${location.pathname.replace('/admin/', '').replace(/-/g, ' ') || 'admin console'}.`,
      metadata: { role: userRole, path: location.pathname },
    })
  }, [location.pathname, user, userRole])

  const handleAdminClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!user || !['admin', 'super_admin', 'funeral_admin'].includes(userRole)) return
    const element = (event.target as Element).closest<HTMLElement>('button, a, [role=button]')
    if (!element || element.dataset.noActivity === 'true') return
    const label = String(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
    if (!label) return
    const signature = `${location.pathname}:${label}`
    const now = Date.now()
    if (lastTrackedClickRef.current.signature === signature && now - lastTrackedClickRef.current.time < 700) return
    lastTrackedClickRef.current = { signature, time: now }
    void logWebAdminActivity({
      adminId: user.id,
      action: 'control_clicked',
      targetType: 'control',
      targetId: location.pathname,
      summary: `Clicked ${label}.`,
      metadata: { role: userRole, path: location.pathname, control: element.tagName.toLowerCase() },
    })
  }

  return (
    <div className={`user-shell admin-console-shell${sidebarOpen ? '' : ' sidebar-collapsed'}`} onClickCapture={handleAdminClick}>
      <aside className="user-sidebar">
        <Link to={homePath} className="brand user-brand">
          <img src={APP_ICON_TRANSPARENT_URL} alt="LifeCycle logo" className="brand-logo" />
          <strong className="sidebar-label">{adminTitle}</strong>
        </Link>

        <nav className="user-nav" aria-label="Admin navigation">
          <button
            type="button"
            className="user-nav-link sidebar-toggle-row"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 7H20" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M4 12H20" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M4 17H20" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Menu</span>
          </button>

          <span className="admin-nav-section sidebar-label">Workspace</span>
          <NavLink to={homePath} end className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 11L12 3L21 11V21H14V15H10V21H3V11Z" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">{homeLabel}</span>
          </NavLink>
          {isRootAdmin ? <NavLink to="/admin/analytics" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 19V11M10 19V5M16 19V9M22 19H2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Analytics</span>
          </NavLink> : null}
          {isFuneralAdmin ? <NavLink to="/admin/funeral-shops" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 20V10L12 4L19 10V20" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9 20V14H15V20" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Funeral Shops</span>
          </NavLink> : null}
          {isFuneralAdmin ? <NavLink to="/admin/funeral-items" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M6 7H18" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M6 12H18" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M6 17H14" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M7 4H17V20H7V4Z" strokeWidth="1.8" />
              </svg>
            </span>
            <span className="sidebar-label">Products</span>
          </NavLink> : null}
          {isFuneralAdmin ? <NavLink to="/admin/orders" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M7 5H17L21 10V19H3V10L7 5Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M3 10H21" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M10 13H14" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M8 5V8H16V5" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Service Requests</span>
          </NavLink> : null}
          {isFuneralAdmin ? <NavLink to="/admin/payments" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="1.8" />
                <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="1.8" />
                <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="1.8" />
                <path d="M14 14H21V21H14V14Z" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Payments</span>
          </NavLink> : null}
          {isFuneralAdmin ? <NavLink to="/admin/payout-accounts" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="2" y="5" width="20" height="14" rx="2" strokeWidth="1.8" />
                <line x1="2" y1="10" x2="22" y2="10" strokeWidth="1.8" />
                <path d="M6 15H9" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M14 15L16 17L20 13" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Payout Accounts</span>
          </NavLink> : null}
          {isRootAdmin ? <span className="admin-nav-section sidebar-label">Root Tools</span> : null}
          {isRootAdmin ? <NavLink to="/admin/home-content" className={({ isActive }) => isActive ? 'user-nav-link active' : 'user-nav-link'}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.8" />
                <circle cx="9" cy="10" r="2" strokeWidth="1.8" />
                <path d="M4 17L9 13L13 16L16 13L20 17" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Mobile Home</span>
          </NavLink> : null}
          {isRootAdmin ? <NavLink to="/admin/announcements" className={({ isActive }) => isActive ? 'user-nav-link active' : 'user-nav-link'}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4 10V14L15 18V6L4 10Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M15 9C17 9.7 18 10.7 18 12C18 13.3 17 14.3 15 15" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M7 15L8 20H11L10 16" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Announcements</span>
          </NavLink> : null}
          {isRootAdmin ? <NavLink to="/admin/account-deletions" className={({ isActive }) => isActive ? 'user-nav-link active' : 'user-nav-link'}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 7H19M9 7V4H15V7M7 7L8 20H16L17 7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 11V16M14 11V16" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Account Deletions</span>
          </NavLink> : null}
          <span className="admin-nav-section sidebar-label">Administration</span>
          <NavLink to="/admin/users" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="8" r="3" strokeWidth="1.8" />
                <circle cx="16" cy="10" r="2.5" strokeWidth="1.8" />
                <path d="M3 20C3 16.9 5.8 14.5 9.2 14.5C12.6 14.5 15.4 16.9 15.4 20" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M13.5 20C13.7 17.9 15.2 16.3 17.2 15.8" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Users</span>
          </NavLink>
          <NavLink to="/admin/moderation" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 3L20 6V11C20 16.3 16.6 20.9 12 22C7.4 20.9 4 16.3 4 11V6L12 3Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9.5 12L11.2 13.7L14.8 10.1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Moderation</span>
          </NavLink>
          <NavLink to="/admin/feedback" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 5H19V14H8L5 17V5Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8 9H16" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M8 12H13" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Feedback</span>
          </NavLink>
          <NavLink to="/admin/support" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M4.5 6.5C4.5 5.7 5.2 5 6 5H18C18.8 5 19.5 5.7 19.5 6.5V14C19.5 14.8 18.8 15.5 18 15.5H9L5.5 18.7V6.5Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M8 9.5H16" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M8 12.5H13.5" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Support</span>
          </NavLink>
          <NavLink to="/admin/activity-logs" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 12H7L9.2 7L13 17L15.2 12H21" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">Activity Logs</span>
          </NavLink>
          <NavLink to="/admin/login-security" className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M6 11H18V21H6V11Z" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9 11V8A3 3 0 0 1 15 8V11" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M12 15V17" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="sidebar-label">Login &amp; Security</span>
          </NavLink>
        </nav>

        <div className="utility-actions">
          <p className="panel-sub">Signed in as {user?.email || 'admin'}</p>
        </div>
      </aside>

      <main className="user-main">
        <header className="user-header">
          <div className="user-header-right">
            <NotificationDropdown
              variant="seller-centre"
              className="admin-home-notifications"
              routeResolver={resolveAdminNotificationRoute}
              viewAllPath="/user/notifications"
            />

            <div className="user-menu-wrap">
              <button
                type="button"
                className="user-profile-trigger"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                aria-controls="admin-profile-menu"
              >
                <img src={avatarSrc} alt="Profile" className="user-avatar" />
                <span className="user-profile-name">{profile.fullName}</span>
                <svg viewBox="0 0 24 24" fill="none" className={`user-arrow${menuOpen ? ' open' : ''}`} aria-hidden="true">
                  <path d="M6 9L12 15L18 9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {menuOpen ? (
                <div id="admin-profile-menu" className="user-dropdown" role="dialog" aria-label="Admin profile menu" aria-modal="false">
                  <button type='button' className='user-dropdown-item' data-no-activity='true' onClick={confirmLogout}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="user-content admin-content-full-bleed">
          <Outlet />
        </div>
      </main>
      {confirmDialog}
    </div>
  )
}

export default AdminLayout
