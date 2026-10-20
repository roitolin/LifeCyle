import type { ReactNode, RefObject } from 'react'
import { Link } from 'react-router-dom'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import LogoutLink from '@/components/LogoutLink'
import { getProfileAvatar } from '@/utils/profileAvatar'
import './MarketplaceMobileDrawer.css'

type DrawerIconName = 'home' | 'account' | 'shop' | 'messages' | 'payments' | 'help'

const DRAWER_ICON_PATHS: Record<DrawerIconName, ReactNode> = {
  home: <><path d='m3 11 9-8 9 8' /><path d='M5 10v10h14V10' /><path d='M9 20v-6h6v6' /></>,
  account: <><circle cx='12' cy='8' r='4' /><path d='M4.5 21a7.5 7.5 0 0 1 15 0' /></>,
  shop: <><path d='M4 10v10h16V10' /><path d='M3 10 5 4h14l2 6' /><path d='M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0' /><path d='M9 20v-6h6v6' /></>,
  messages: <><path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z' /><path d='M8 9h8M8 13h5' /></>,
  payments: <><rect x='3' y='5' width='18' height='14' rx='2' /><path d='M3 10h18M7 15h3' /></>,
  help: <><circle cx='12' cy='12' r='9' /><path d='M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1.1-1.4 2.3' /><path d='M12 17h.01' /></>,
}

function DrawerIcon({ name }: { name: DrawerIconName }) {
  return (
    <svg className='marketplace-mobile-nav-icon' viewBox='0 0 24 24' aria-hidden='true'>
      {DRAWER_ICON_PATHS[name]}
    </svg>
  )
}

type MarketplaceMobileDrawerProps = {
  isOpen: boolean
  onClose: () => void
  closeButtonRef: RefObject<HTMLButtonElement | null>
  isLoggedIn: boolean
  userName?: string | null
  userEmail?: string | null
  photoUrl?: string | null
  gender?: string | null
  accountPath: string
  purchasesPath: string
  helpPath: string
  onOpenMessages: () => void
}

export default function MarketplaceMobileDrawer({
  isOpen,
  onClose,
  closeButtonRef,
  isLoggedIn,
  userName,
  userEmail,
  photoUrl,
  gender,
  accountPath,
  purchasesPath,
  helpPath,
  onOpenMessages,
}: MarketplaceMobileDrawerProps) {
  if (!isOpen) return null

  return (
    <div className='sp-mobile-menu-layer marketplace-mobile-drawer-layer'>
      <button type='button' className='sp-mobile-menu-backdrop' onClick={onClose} aria-label='Close navigation menu' />
      <aside className='sp-mobile-menu marketplace-mobile-drawer' role='dialog' aria-modal='true' aria-label='Navigation menu'>
        <div className='sp-mobile-menu-head'>
          <span>Menu</span>
          <button ref={closeButtonRef} type='button' className='sp-mobile-menu-close' onClick={onClose} aria-label='Close navigation menu'>
            <svg viewBox='0 0 24 24' aria-hidden='true'><path d='m6 6 12 12M18 6 6 18' /></svg>
          </button>
        </div>

        {isLoggedIn ? (
          <div className='sp-mobile-menu-profile'>
            <img src={getProfileAvatar(photoUrl, gender)} alt='' className='sp-mobile-menu-avatar' />
            <div className='sp-mobile-menu-profile-copy'>
              <strong>{userName || 'My account'}</strong>
              <span>{userEmail}</span>
            </div>
            <div className='sp-mobile-menu-profile-actions'>
              <LogoutLink className='sp-mobile-menu-profile-action sp-mobile-menu-logout' onClick={onClose}>Log out</LogoutLink>
            </div>
          </div>
        ) : (
          <div className='sp-mobile-menu-guest-actions'>
            <Link className='sp-mobile-menu-profile-action' to='/login' onClick={onClose}>Sign in</Link>
            <Link className='sp-mobile-menu-profile-action sp-mobile-menu-primary' to='/register' onClick={onClose}>Sign up</Link>
          </div>
        )}

        <nav className='sp-mobile-menu-nav' aria-label='Mobile navigation'>
          <Link to='/funeral' onClick={onClose}><DrawerIcon name='home' />Home</Link>
          <Link to={accountPath} onClick={onClose}><DrawerIcon name='account' />My Account</Link>
          <Link to='/seller' onClick={onClose}><DrawerIcon name='shop' />Shop Center</Link>
          <button type='button' onClick={onOpenMessages}><DrawerIcon name='messages' />Messages</button>
          <div className='sp-mobile-menu-announcement'><AnnouncementDropdown menuItem /></div>
          <Link to={purchasesPath} onClick={onClose}><DrawerIcon name='payments' />My Payments</Link>
          <Link to={helpPath} onClick={onClose}><DrawerIcon name='help' />Help Centre</Link>
        </nav>
      </aside>
    </div>
  )
}
