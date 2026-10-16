import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './MobileWebNavigation.css'

type MobileTab = {
  label: string
  to: string
  active: (pathname: string) => boolean
  icon: ReactNode
  activeIcon: ReactNode
}

const tabs: MobileTab[] = [
  {
    label: 'Home',
    to: '/funeral',
    active: pathname => pathname === '/funeral',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-6H9v6H3.5a.5.5 0 0 1-.5-.5z" />
      </svg>
    ),
    activeIcon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="mobile-web-nav__fill" d="M2.6 10.2 12 2.4l9.4 7.8a1.2 1.2 0 0 1 .4.9v9.5a1.4 1.4 0 0 1-1.4 1.4h-5.2v-6.4H8.8V22H3.6a1.4 1.4 0 0 1-1.4-1.4v-9.5c0-.4.1-.7.4-.9Z" />
      </svg>
    ),
  },
  {
    label: 'Shops',
    to: '/funeral/shops',
    active: pathname => pathname === '/funeral/shops' || pathname.startsWith('/shop/'),
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9v11h16V9M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6" />
      </svg>
    ),
    activeIcon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="mobile-web-nav__fill" d="M4.1 10.7V21h15.8V10.7a4.2 4.2 0 0 1-4.9-.8 4 4 0 0 1-6 0 4.2 4.2 0 0 1-4.9.8Zm4.6 2.8h6.6V21H8.7v-7.5ZM5.1 2.5 2.5 8.8a3.1 3.1 0 0 0 6.1.6 3.5 3.5 0 0 0 6.8 0 3.1 3.1 0 0 0 6.1-.6l-2.6-6.3H5.1Z" />
      </svg>
    ),
  },
  {
    label: 'Carts',
    to: '/user/cart',
    active: pathname => pathname === '/user/cart',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 8H6M10 20h.01M18 20h.01" />
      </svg>
    ),
    activeIcon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="mobile-web-nav__fill" d="M2.5 3h3.3c.6 0 1.1.4 1.2 1l.6 2.7h13c.8 0 1.4.8 1.1 1.6l-2 6.5c-.3 1.2-1.4 2-2.7 2H9.4a3 3 0 0 1-3-2.4L4.5 5.5h-2V3Zm7.2 15.1a2 2 0 1 0 0 3.9 2 2 0 0 0 0-3.9Zm8.1 0a2 2 0 1 0 0 3.9 2 2 0 0 0 0-3.9Z" />
      </svg>
    ),
  },
  {
    label: 'Profile',
    to: '/user/profile',
    active: pathname => pathname === '/user/profile',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
    ),
    activeIcon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="mobile-web-nav__fill" cx="12" cy="7.5" r="4.5" />
        <path className="mobile-web-nav__fill" d="M3.5 21.5a8.5 8.5 0 0 1 17 0H3.5Z" />
      </svg>
    ),
  },
]

export default function MobileWebNavigation() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const isVisibleRoute = tabs.some(tab => tab.active(pathname))

  useEffect(() => {
    const openDrawer = () => setIsOpen(true)
    window.addEventListener('open-mobile-navigation', openDrawer)
    return () => window.removeEventListener('open-mobile-navigation', openDrawer)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('mobile-app-nav-visible', isVisibleRoute)
    return () => document.body.classList.remove('mobile-app-nav-visible')
  }, [isVisibleRoute])

  useEffect(() => {
    document.body.classList.toggle('mobile-nav-drawer-open', isVisibleRoute && isOpen)

    if (!isOpen) {
      return () => document.body.classList.remove('mobile-nav-drawer-open')
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.classList.remove('mobile-nav-drawer-open')
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen, isVisibleRoute])

  const openMessages = () => {
    setIsOpen(false)

    if (pathname === '/funeral' || pathname.startsWith('/shop/')) {
      window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('open-chat')))
      return
    }

    navigate('/funeral')
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('open-chat')), 350)
  }

  if (!isVisibleRoute) return null

  return (
    <>
      {pathname !== '/funeral' ? (
        <button
          type="button"
          className="mobile-web-menu-button"
          aria-label="Open navigation menu"
          aria-controls="mobile-web-navigation-drawer"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      ) : null}

      <button
        type="button"
        className={`mobile-web-nav__backdrop${isOpen ? ' is-open' : ''}`}
        aria-label="Close navigation menu"
        tabIndex={isOpen ? 0 : -1}
        onClick={() => setIsOpen(false)}
      />

      <aside
        id="mobile-web-navigation-drawer"
        className={`mobile-web-nav${isOpen ? ' is-open' : ''}`}
        aria-label="Mobile navigation"
        aria-hidden={!isOpen}
      >
        <div className="mobile-web-nav__header">
          <div className="mobile-web-nav__header-title">
            <svg className="mobile-web-nav__header-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            <strong>Menu</strong>
          </div>
          <button type="button" aria-label="Close navigation menu" tabIndex={isOpen ? 0 : -1} onClick={() => setIsOpen(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="mobile-web-nav__content">
          <nav className="mobile-web-nav__inner" aria-label="Primary mobile navigation">
            {tabs.map(tab => {
              const selected = tab.active(pathname)

              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  className={`mobile-web-nav__item${tab.label === 'Profile' ? ' mobile-web-nav__item--section-start' : ''}${selected ? ' is-active' : ''}`}
                  aria-current={selected ? 'page' : undefined}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setIsOpen(false)}
                >
                  <span className="mobile-web-nav__icon">
                    {selected ? tab.activeIcon : tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  <span className="mobile-web-nav__chevron" aria-hidden="true">&rsaquo;</span>
                </Link>
              )
            })}
            <button
              type="button"
              className="mobile-web-nav__item mobile-web-nav__item--button"
              tabIndex={isOpen ? 0 : -1}
              onClick={openMessages}
            >
              <span className="mobile-web-nav__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></svg>
              </span>
              <span>Messages</span>
              <span className="mobile-web-nav__chevron" aria-hidden="true">&rsaquo;</span>
            </button>
          </nav>

          <div className="mobile-web-nav__footer">
            <Link to="/seller" className="mobile-web-nav__action mobile-web-nav__shop-center" tabIndex={isOpen ? 0 : -1} onClick={() => setIsOpen(false)}>
              <span className="mobile-web-nav__action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 9v11h16V9M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6" /></svg>
              </span>
              <span className="mobile-web-nav__action-copy">
                <strong>Shop Center</strong>
                <small>Manage your shop and products</small>
              </span>
              <span className="mobile-web-nav__chevron" aria-hidden="true">&rsaquo;</span>
            </Link>
          </div>
        </div>
      </aside>
    </>
  )
}
