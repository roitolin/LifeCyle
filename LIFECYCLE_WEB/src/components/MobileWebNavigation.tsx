import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
  const isVisibleRoute = tabs.some(tab => tab.active(pathname))


  useEffect(() => {
    document.body.classList.toggle('mobile-app-nav-visible', isVisibleRoute)
    return () => document.body.classList.remove('mobile-app-nav-visible')
  }, [isVisibleRoute])

  if (!isVisibleRoute) return null

  return (
    <nav className="mobile-web-nav" aria-label="Primary mobile navigation">
      <div className="mobile-web-nav__inner">
        {tabs.map(tab => {
          const selected = tab.active(pathname)

          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`mobile-web-nav__item${selected ? ' is-active' : ''}`}
              aria-current={selected ? 'page' : undefined}
            >
              <span className="mobile-web-nav__icon">
                {selected ? tab.activeIcon : tab.icon}
              </span>
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
