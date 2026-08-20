import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchNotificationsForUser } from '@/utils/supabaseNotifications'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { logWebAdminActivity, recordWebAdminLoginActivity } from '@/utils/adminActivity'
import './AdminLayout.css'

type ProfileData = {
  fullName: string
  photoURL: string
  gender: string
}

type AdminRole = 'super_admin' | 'admin' | 'funeral_admin' | 'user'

type AdminNotification = {
  id: string
  title?: string
  message?: string
  body?: string
  type?: string
  read?: boolean
  createdAt?: { toDate?: () => Date } | string | null
}

function getDefaultAvatar(gender: string) {
  if (gender === 'female') return '/Female_Default_Profile.png'
  return '/Male_Default_Profile.png'
}

function getTimeLabel(value: { toDate?: () => Date } | string | null | undefined) {
  if (!value) return ''
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return value.toDate?.()?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) || ''
  }
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState<AdminRole>('user')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [profile, setProfile] = useState<ProfileData>({ fullName: 'Admin', photoURL: '', gender: '' })
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [refreshingView, setRefreshingView] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const mainRef = useRef<HTMLElement | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const lastTapRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchPullEnabledRef = useRef(false)
  const lastTrackedClickRef = useRef({ signature: '', time: 0 })

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

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      const list = await fetchNotificationsForUser(user.id)
      if (!active) return
      setNotifications(list as AdminNotification[])
    }

    void load()
    const channel = supabase
      .channel(`admin-layout-notifications-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void load()
      })
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [user])

  const visibleNotifications = useMemo(() => (user ? notifications : []), [notifications, user])
  const unreadCount = useMemo(() => visibleNotifications.filter((item) => !item.read).length, [visibleNotifications])
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

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  const triggerContentRefresh = useCallback(() => {
    setRefreshNonce(Date.now())
    setRefreshingView(true)
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = window.setTimeout(() => {
      setRefreshingView(false)
    }, 700)
  }, [])

  const handleDoubleTapRefresh = () => {
    const now = Date.now()
    if (now - lastTapRef.current <= 420) {
      lastTapRef.current = 0
      triggerContentRefresh()
      return
    }
    lastTapRef.current = now
  }

  const getCurrentScrollTop = () => {
    const container = mainRef.current
    if (container && container.scrollHeight > container.clientHeight) {
      return container.scrollTop
    }
    return window.scrollY || document.documentElement.scrollTop || 0
  }

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return
    touchStartYRef.current = event.touches[0]?.clientY || 0
    touchPullEnabledRef.current = getCurrentScrollTop() <= 2
    if (touchPullEnabledRef.current) {
      setPullDistance(0)
    }
  }

  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
    if (!touchPullEnabledRef.current || event.touches.length !== 1) return
    const delta = (event.touches[0]?.clientY || 0) - touchStartYRef.current
    if (delta <= 0) {
      setPullDistance(0)
      touchPullEnabledRef.current = false
      return
    }
    setPullDistance(Math.min(120, delta * 0.55))
  }

  const handleTouchEnd = () => {
    if (pullDistance >= 75) {
      triggerContentRefresh()
    }
    setPullDistance(0)
    touchPullEnabledRef.current = false
  }

  const handleLogout = async () => {
    await Promise.all([
      recordWebAdminLoginActivity('logout', userRole),
      logWebAdminActivity({
        adminId: user?.id,
        action: 'logout_clicked',
        targetType: 'security',
        targetId: user?.id,
        summary: 'Signed out of the admin web console.',
      }),
    ])
    await supabase.auth.signOut()
    navigate('/')
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
        <Link to="/" className="brand user-brand">
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

          <NavLink to={homePath} end className={({ isActive }) => `user-nav-link${isActive ? ' active' : ''}`}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M3 11L12 3L21 11V21H14V15H10V21H3V11Z" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sidebar-label">{homeLabel}</span>
          </NavLink>
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
            <span className="sidebar-label">Items</span>
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

      <main
        ref={mainRef}
        className="user-main"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <header className="user-header">
          <div className="user-header-right">
            {pullDistance > 0 ? (
              <span className="pull-refresh-status">
                {pullDistance >= 75 ? 'Release to refresh' : 'Pull down to refresh'}
              </span>
            ) : null}
            <button
              type="button"
              className={`layout-refresh-btn${refreshingView ? ' is-refreshing' : ''}`}
              onClick={handleDoubleTapRefresh}
              title="Double-tap to refresh this page"
              aria-label="Refresh current page (double tap)"
            >
              {refreshingView ? 'Refreshing...' : 'Refresh x2'}
            </button>
            <div className="user-menu-wrap">
              <button
                type="button"
                className="admin-notification-btn"
                onClick={() => setNotificationsOpen((prev) => !prev)}
                aria-haspopup="dialog"
                aria-expanded={notificationsOpen}
                aria-controls="admin-notification-menu"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3C9.2 3 7 5.2 7 8V10.7L5.4 13.4A1 1 0 0 0 6.3 15H17.7A1 1 0 0 0 18.6 13.4L17 10.7V8C17 5.2 14.8 3 12 3Z" strokeWidth="1.8" />
                  <path d="M10 18C10.4 19.2 11.1 20 12 20C12.9 20 13.6 19.2 14 18" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                {unreadCount > 0 ? <span className="admin-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
              </button>

              {notificationsOpen ? (
                <div id="admin-notification-menu" className="user-dropdown admin-notification-dropdown" role="dialog" aria-label="Admin notifications" aria-modal="false">
                  {visibleNotifications.length === 0 ? <p className="panel-sub">No notifications yet.</p> : null}
                  {visibleNotifications.slice(0, 12).map((item) => (
                    <article key={item.id} className={`admin-notification-row${item.read ? '' : ' unread'}`}>
                      <strong>{item.title || item.type || 'Notification'}</strong>
                      <p>{item.message || item.body || ''}</p>
                      <span>{getTimeLabel(item.createdAt)}</span>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>

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
                  <button type="button" className="user-dropdown-item" data-no-activity="true" onClick={handleLogout}>Logout</button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="user-content admin-content-full-bleed">
          <Outlet key={refreshNonce} />
        </div>
      </main>
    </div>
  )
}

export default AdminLayout
