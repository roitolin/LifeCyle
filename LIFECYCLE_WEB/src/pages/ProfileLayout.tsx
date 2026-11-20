import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import PageBackButton from '@/components/PageBackButton'
import HeaderAccountMenu, { type HeaderAccountProfile } from '@/components/HeaderAccountMenu'
import { supabase } from '@/lib/supabase'
import { getProfileAvatar } from '@/utils/profileAvatar'
import './UserProfilePage.css'

const accountLinks = [
  { to: '/user/profile', label: 'Profile' },
  { to: '/user/requests', label: 'Service requests' },
  { to: '/user/purchase', label: 'My Payments' },
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
  { to: '/user/developers', label: 'Our developers' },
  { to: '/user/feedback', label: 'Feedback' },
]

type ProfileLayoutProps = {
  children: ReactNode
  title: string
  subtitle?: string
  mainClassName?: string
  headerAction?: ReactNode
}

export default function ProfileLayout({ children, title, subtitle, mainClassName, headerAction }: ProfileLayoutProps) {
  const [viewer, setViewer] = useState<User | null>(null)
  const [profile, setProfile] = useState<HeaderAccountProfile | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavCloseRef = useRef<HTMLButtonElement>(null)
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

  useEffect(() => {
    if (!mobileNavOpen) return

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    const closeAboveMobile = () => {
      if (window.innerWidth > 768) setMobileNavOpen(false)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeAboveMobile)
    window.requestAnimationFrame(() => mobileNavCloseRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeAboveMobile)
    }
  }, [mobileNavOpen])

  const navLink = ({ to, label }: { to: string, label: string }, onNavigate?: () => void) => (
    <Link key={to} to={to} onClick={onNavigate} className={location.pathname === to ? 'active' : undefined}>{label}</Link>
  )
  const avatarUrl = getProfileAvatar(profile?.photoURL, profile?.gender)

  return (
    <div className="sp-page profile-page">
      {mobileNavOpen ? (
        <div className="profile-mobile-menu-layer">
          <button
            type="button"
            className="profile-mobile-menu-backdrop"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close account navigation"
          />
          <aside className="profile-mobile-menu" role="dialog" aria-modal="true" aria-label="Account navigation">
            <div className="profile-mobile-menu-head">
              <span>Menu</span>
              <button
                ref={mobileNavCloseRef}
                type="button"
                className="profile-mobile-menu-close"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close account navigation"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="profile-mobile-menu-profile">
              <img src={avatarUrl} alt="" className="profile-mobile-menu-avatar" />
              <div>
                <strong>{profile?.fullName || 'My account'}</strong>
                <span>{viewer?.email}</span>
              </div>
            </div>

            <nav className="profile-mobile-nav" aria-label="Mobile account navigation">
              <div className="profile-mobile-nav-group">
                {accountLinks.map(link => navLink(link, () => setMobileNavOpen(false)))}
              </div>
              <div className="profile-mobile-nav-group">
                {supportLinks.map(link => navLink(link, () => setMobileNavOpen(false)))}
              </div>
              <div className="profile-mobile-nav-group">
                <Link to="/privacy-policy" onClick={() => setMobileNavOpen(false)} className={location.pathname === '/privacy-policy' ? 'active' : undefined}>Privacy policy</Link>
                <Link to="/policies" onClick={() => setMobileNavOpen(false)} className={location.pathname === '/policies' ? 'active' : undefined}>Platform policies</Link>
              </div>
            </nav>
          </aside>
        </div>
      ) : null}

      <header className="sp-header profile-app-header">
        <div className="sp-header-inner profile-app-header-inner">
          <div className="profile-mobile-brand-row">
            <button
              type="button"
              className="profile-mobile-menu-trigger"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open account navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileNavOpen}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <BrandLogo compact className="profile-brand-logo" />
          </div>
          <div className="profile-mobile-header-actions">
            <PageBackButton className="profile-mobile-home-link" />
          </div>
          <div className="profile-desktop-header-actions">
            <Link to="/funeral" className="profile-browse-link">Browse services</Link>
            <HeaderAccountMenu profile={profile} fallbackName={viewer?.email} showNotifications={false} />
          </div>
        </div>
      </header>

      <div className="sp-body">
        <div className="sp-body-inner profile-body-grid">
          <aside className="profile-sidebar">
            <nav className="profile-nav" aria-label="Account navigation">
              <div className="profile-nav-group">{accountLinks.map(link => navLink(link))}</div>
              <div className="profile-nav-group profile-nav-support">{supportLinks.map(link => navLink(link))}</div>
              <div className="profile-nav-group profile-nav-legal">
                <Link to="/privacy-policy">Privacy policy</Link>
                <Link to="/policies">Platform policies</Link>
              </div>
            </nav>
          </aside>

          <main className={mainClassName ? `profile-main ${mainClassName}` : 'profile-main'}>
            <div className="profile-header">
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
              {headerAction}
            </div>
            <div className="profile-content">{children}</div>
          </main>
        </div>
      </div>
    </div>
  )
}
