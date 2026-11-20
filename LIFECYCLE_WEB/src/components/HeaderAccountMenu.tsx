import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import LogoutLink from '@/components/LogoutLink'
import { getProfileAvatar } from '@/utils/profileAvatar'
import './HeaderAccountMenu.css'

export type HeaderAccountProfile = {
  fullName?: string | null
  photoURL?: string | null
  gender?: string | null
}

export default function HeaderAccountMenu({ profile, fallbackName, task = false, showShopCenter = false, showNotifications = true }: {
  profile?: HeaderAccountProfile | null
  fallbackName?: string | null
  task?: boolean
  showShopCenter?: boolean
  showNotifications?: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const { pathname } = useLocation()
  const name = profile?.fullName || fallbackName || 'Account'
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return (
    <div
      ref={menuRef}
      className={task ? 'header-account-menu account-task-menu' : 'header-account-menu sp-user-menu'}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close()
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={task ? 'account-task-menu-trigger' : 'sp-user-menu-trigger'}
        aria-label="Open account menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(previous => !previous)}
      >
        <img src={getProfileAvatar(profile?.photoURL, profile?.gender)} alt="" className="sp-user-avatar" width={26} height={26} />
        <span className="sp-user-name">{name}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </button>
      <div
        id={id}
        hidden={!open}
        className={task ? 'account-task-menu-links' : 'sp-user-dropdown'}
      >
        <Link to="/user/profile" onClick={close}>My account</Link>
        <Link to="/user/requests" onClick={close}>Service requests</Link>
        {showNotifications && pathname !== '/user/notifications' && (
          <Link to="/user/notifications" onClick={close}>Notifications</Link>
        )}
        {showShopCenter && <Link to="/seller" onClick={close}>Shop Center</Link>}
        <Link to="/auth/switch-account" className="sp-dropdown-switch" onClick={close}>Switch account</Link>
        <LogoutLink onClick={close}>Log out</LogoutLink>
      </div>
    </div>
  )
}
