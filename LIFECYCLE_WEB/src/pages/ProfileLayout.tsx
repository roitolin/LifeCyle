import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import { supabase } from '@/lib/supabase'
import './UserProfilePage.css'

const accountLinks = [
  { to: '/user/profile', label: 'Profile' },
  { to: '/user/requests', label: 'Service requests' },
  { to: '/user/purchase', label: 'Payments' },
  { to: '/user/favorites', label: 'Favorites' },
  { to: '/user/notifications', label: 'Notifications' },
  { to: '/user/account-settings', label: 'Account settings' },
  { to: '/user/privacy-data', label: 'Privacy & data' },
  { to: '/user/notification-preferences', label: 'Notification preferences' },
]

const supportLinks = [
  { to: '/user/help', label: 'Help Centre' },
  { to: '/user/contact', label: 'Contact support' },
  { to: '/user/about', label: 'About LifeCycle' },
  { to: '/user/feedback', label: 'Feedback' },
]

export default function ProfileLayout({ children, title, subtitle }: { children: ReactNode, title: string, subtitle: string }) {
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
    void load()
  }, [navigate])

  const navLink = ({ to, label }: { to: string, label: string }) => (
    <Link key={to} to={to} className={location.pathname === to ? 'active' : undefined}>{label}</Link>
  )

  return (
    <div className="sp-page profile-page">
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left"><Link to="/funeral">Marketplace</Link></div>
          <div className="sp-topbar-right">
            <div className="sp-user-menu">
              <div className="sp-user-menu-trigger">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Account" className="sp-user-avatar" />
                ) : (
                  <div className="sp-user-avatar-placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                  </div>
                )}
                <span className="sp-user-name">{profile?.fullName || viewer?.email}</span>
                <svg className="sp-user-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <div className="sp-user-dropdown">
                <Link to="/user/requests">Service requests</Link>
                <Link to="/user/notifications">Notifications</Link>
                <Link to="/auth/switch-account" className="sp-dropdown-switch">Switch account</Link>
                <Link to="/auth/logout">Log out</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <header className="sp-header profile-app-header">
        <div className="sp-header-inner profile-app-header-inner">
          <BrandLogo compact />
          <Link to="/funeral" className="profile-browse-link">Browse services</Link>
        </div>
      </header>

      <div className="sp-body">
        <div className="sp-body-inner profile-body-grid">
          <aside className="profile-sidebar">
            <nav className="profile-nav" aria-label="Account navigation">
              <div className="profile-nav-group">{accountLinks.map(navLink)}</div>
              <div className="profile-nav-group profile-nav-support">{supportLinks.map(navLink)}</div>
              <div className="profile-nav-group profile-nav-legal">
                <Link to="/privacy-policy">Privacy policy</Link>
                <Link to="/policies">Platform policies</Link>
              </div>
            </nav>
          </aside>

          <main className="profile-main">
            <div className="profile-header">
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            <div className="profile-content">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
