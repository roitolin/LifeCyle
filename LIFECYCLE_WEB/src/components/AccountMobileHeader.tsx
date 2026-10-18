import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import { supabase } from '@/lib/supabase'
import '@/pages/UserProfilePage.css'

const accountLinks = [
  { to: '/user/profile', label: 'Profile' },
  { to: '/user/requests', label: 'Service requests' },
  { to: '/user/purchase', label: 'My Payments' },
  { to: '/user/favorites', label: 'Favorites' },
  { to: '/user/account-settings', label: 'Account settings' },
  { to: '/user/privacy-data', label: 'Privacy & data' },
  { to: '/user/notification-preferences', label: 'Notification preferences' },
  { to: '/user/help', label: 'Help Centre' },
  { to: '/user/contact', label: 'Contact support' },
  { to: '/user/about', label: 'About LifeCycle' },
  { to: '/user/feedback', label: 'Feedback' },
  { to: '/privacy-policy', label: 'Privacy policy' },
  { to: '/policies', label: 'Platform policies' },
]

type AccountProfile = {
  fullName?: string | null
  photoURL?: string | null
}

type AccountMobileHeaderProps = {
  homeTo?: string
}

export default function AccountMobileHeader({ homeTo = '/funeral' }: AccountMobileHeaderProps) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [email, setEmail] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  useEffect(() => {
    const loadAccount = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      setEmail(session.user.email ?? '')
      const { data } = await supabase
        .from('users')
        .select('fullName, photoURL')
        .eq('id', session.user.id)
        .maybeSingle()
      setProfile(data)
    }

    void loadAccount()
  }, [])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeAboveMobile = () => {
      if (window.innerWidth > 768) setOpen(false)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeAboveMobile)
    window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeAboveMobile)
    }
  }, [open])

  return (
    <div className="profile-page profile-mobile-account-header">
      {open ? (
        <div className="profile-mobile-menu-layer">
          <button
            type="button"
            className="profile-mobile-menu-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Close account navigation"
          />
          <aside className="profile-mobile-menu" role="dialog" aria-modal="true" aria-label="Account navigation">
            <div className="profile-mobile-menu-head">
              <span>Menu</span>
              <button
                ref={closeButtonRef}
                type="button"
                className="profile-mobile-menu-close"
                onClick={() => setOpen(false)}
                aria-label="Close account navigation"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            <div className="profile-mobile-menu-profile">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="" />
              ) : (
                <span className="profile-mobile-menu-avatar" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
                  </svg>
                </span>
              )}
              <div>
                <strong>{profile?.fullName || 'My account'}</strong>
                {email ? <span>{email}</span> : null}
              </div>
            </div>

            <nav className="profile-mobile-nav" aria-label="Mobile account navigation">
              <div className="profile-mobile-nav-group">
                {accountLinks.map(link => (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setOpen(false)}
                    className={location.pathname === link.to ? 'active' : undefined}
                  >
                    {link.label}
                  </Link>
                ))}
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
              onClick={() => setOpen(true)}
              aria-label="Open account navigation"
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <BrandLogo compact className="profile-brand-logo" />
          </div>
          <Link to={homeTo} className="profile-mobile-home-link">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            <span><span className="profile-mobile-home-prefix">Back to </span>home</span>
          </Link>
        </div>
      </header>
    </div>
  )
}
