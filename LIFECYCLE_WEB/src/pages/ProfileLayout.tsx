import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import './UserProfilePage.css'

export default function ProfileLayout({ children, title, subtitle }: { children: React.ReactNode, title: string, subtitle: string }) {
  const [viewer, setViewer] = useState<User | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }
      setViewer(session.user)
      const { data } = await supabase.from('users').select('*').eq('id', session.user.id).maybeSingle()
      if (data) setProfile(data)
    }
    load()
  }, [navigate])

  return (
    <div className="sp-page profile-page">
      {/* Topbar */}
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left">
            <Link to="/funeral">Home</Link>
          </div>
          <div className="sp-topbar-right">
            <div className="sp-user-menu">
              <div className="sp-user-menu-trigger">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Avatar" className="sp-user-avatar" />
                ) : (
                  <div className="sp-user-avatar-placeholder">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                  </div>
                )}
                <span className="sp-user-name">{profile?.fullName || viewer?.email}</span>
                <svg className="sp-user-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <div className="sp-user-dropdown">
                    <Link to="/user/purchase">Purchases</Link>
                    <Link to="/user/notifications">Notifications</Link>
                    <Link to="/auth/logout">Log out</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Header */}
      <header className="sp-header" style={{ padding: '16px 0' }}>
        <div className="sp-header-inner" style={{ alignItems: 'center' }}>
          <Link to="/funeral" className="sp-logo">
            <div className="sp-logo-box" style={{ width: 40, height: 40, fontSize: 20 }}>LC</div>
            <span style={{ fontSize: 22 }}>LifeCycle</span>
          </Link>
          <div style={{ flex: 1, fontSize: 20, color: 'var(--text-main)' }}>Settings</div>
        </div>
      </header>

      {/* Body Layout */}
      <div className="sp-body">
        <div className="sp-body-inner profile-body-grid">
          {/* Left Sidebar */}
          <aside className="profile-sidebar">
            <nav className="profile-nav" aria-label="Profile settings">
              <section className="profile-nav-section">
                <div className={`profile-nav-item ${location.pathname === '/user/profile' ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  My Account
                </div>
                <div className="profile-nav-sub"><Link to="/user/profile" className={location.pathname === '/user/profile' ? 'active' : ''}>Profile</Link></div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${location.pathname === '/user/notifications' ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  Notifications
                </div>
                <div className="profile-nav-sub"><Link to="/user/notifications" className={location.pathname === '/user/notifications' ? 'active' : ''}>View Notifications</Link></div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${location.pathname === '/user/favorites' ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                  My Favorites
                </div>
                <div className="profile-nav-sub"><Link to="/user/favorites" className={location.pathname === '/user/favorites' ? 'active' : ''}>View Favorites</Link></div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${['/seller', '/user/requests', '/user/purchase'].includes(location.pathname) ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l2-5h14l2 5"/><path d="M5 13v7h14v-7"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></svg>
                  Services &amp; Payments
                </div>
                <div className="profile-nav-sub">
                  <Link to="/seller" className={location.pathname === '/seller' ? 'active' : ''}>Shop Management</Link>
                  <Link to="/user/requests" className={location.pathname === '/user/requests' ? 'active' : ''}>My Service Requests</Link>
                  <Link to="/user/purchase" className={location.pathname === '/user/purchase' ? 'active' : ''}>My Payments</Link>
                </div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${['/user/account-settings', '/user/privacy-data'].includes(location.pathname) ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
                  Security &amp; Privacy
                </div>
                <div className="profile-nav-sub">
                  <Link to="/user/account-settings" className={location.pathname === '/user/account-settings' ? 'active' : ''}>Account Settings</Link>
                  <Link to="/user/privacy-data" className={location.pathname === '/user/privacy-data' ? 'active' : ''}>Privacy &amp; Data</Link>
                </div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${location.pathname === '/user/notification-preferences' ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
                  Preferences
                </div>
                <div className="profile-nav-sub"><Link to="/user/notification-preferences" className={location.pathname === '/user/notification-preferences' ? 'active' : ''}>Notification Preferences</Link></div>
              </section>

              <section className="profile-nav-section">
                <div className={`profile-nav-item ${['/user/help', '/user/contact', '/user/about', '/user/feedback'].includes(location.pathname) ? 'active' : ''}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
                  Help &amp; Information
                </div>
                <div className="profile-nav-sub">
                  <Link to="/user/about" className={location.pathname === '/user/about' ? 'active' : ''}>About LifeCycle</Link>
                  <Link to="/user/feedback" className={location.pathname === '/user/feedback' ? 'active' : ''}>Rate &amp; Feedback</Link>
                  <Link to="/user/help" className={location.pathname === '/user/help' ? 'active' : ''}>Help Centre</Link>
                  <Link to="/user/contact" className={location.pathname === '/user/contact' ? 'active' : ''}>Contact Support</Link>
                  <Link to="/privacy-policy">Privacy Policy</Link>
                  <Link to="/policies">Terms of Use</Link>
                </div>
              </section>
            </nav>
          </aside>

          {/* Main Content */}
          <main className="profile-main">
            <div className="profile-header">
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="profile-content">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}



