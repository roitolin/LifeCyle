import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchNotificationsForUser, markNotificationRead, markNotificationsRead } from '@/utils/supabaseNotifications'
import './NotificationDropdown.css'

export type WebNotification = {
  id: string
  userId?: string
  type?: string
  title?: string
  body?: string
  message?: string
  read?: boolean
  data?: Record<string, unknown> | null
  createdAt?: string | null
}

/* ── Time label ─────────────────────────────────────── */
function getTimeLabel(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - parsed.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr  = Math.floor(diffMs / 3_600_000)
  const diffDay = Math.floor(diffMs / 86_400_000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`

  const isThisYear = parsed.getFullYear() === now.getFullYear()
  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
  })
}

function getAbsoluteTime(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
}

function getSellerCentreTimeLabel(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

/* ── Mobile-matching icon/color per category ────────── */
type IconKind = 'refund' | 'payment' | 'success' | 'request' | 'message' | 'product' | 'shopApproved' | 'shopRejected' | 'announcement' | 'schedule' | 'default'

function getVisual(type: string | undefined): { kind: IconKind; color: string; bg: string } {
  const t = String(type || '').toLowerCase()
  if (t.includes('payout_failed') || t.includes('payment_rejected') || t.includes('refund'))
    return { kind: 'refund',       color: '#9a5148', bg: '#fbefed' }
  if (t.includes('payment') || t.includes('payout') || t.includes('commission'))
    return { kind: 'payment',      color: '#85632e', bg: '#f8f1e5' }
  if (t.includes('completed') || t.includes('verified'))
    return { kind: 'success',      color: '#2f6b55', bg: '#eaf4ef' }
  if (t.includes('request') || t.includes('booking') || t.includes('order') || t.includes('casket'))
    return { kind: 'request',      color: '#5d5b82', bg: '#f0eff7' }
  if (t.includes('chat') || t.includes('message') || t.includes('support'))
    return { kind: 'message',      color: '#3f6d84', bg: '#eaf2f6' }
  if (t.includes('product'))
    return { kind: 'product',      color: '#765b3d', bg: '#f6efe6' }
  if (t.includes('shop_approved'))
    return { kind: 'shopApproved', color: '#2f6b55', bg: '#eaf4ef' }
  if (t.includes('shop_rejected'))
    return { kind: 'shopRejected', color: '#9a5148', bg: '#fbefed' }
  if (t.includes('announcement'))
    return { kind: 'announcement', color: '#7b5c31', bg: '#f8f0df' }
  if (t.includes('schedule') || t.includes('reminder'))
    return { kind: 'schedule',     color: '#2f6b55', bg: '#eaf4ef' }
  return   { kind: 'default',      color: '#52635d', bg: '#eef1ef' }
}

function NotifSVG({ kind, color }: { kind: IconKind; color: string }) {
  const c = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'refund')       return <svg {...c}><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/></svg>
  if (kind === 'payment')      return <svg {...c}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/></svg>
  if (kind === 'success')      return <svg {...c}><path d="M20 6 9 17l-5-5"/></svg>
  if (kind === 'request')      return <svg {...c}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
  if (kind === 'message')      return <svg {...c}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
  if (kind === 'product')      return <svg {...c}><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5M3 8v8l9 5 9-5V8M12 13v8"/></svg>
  if (kind === 'shopApproved') return <svg {...c}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
  if (kind === 'shopRejected') return <svg {...c}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>
  if (kind === 'announcement') return <svg {...c}><path d="m3 11 18-5v12L3 14v-3Z"/><path d="m6 14 1 6h4l-1-5"/></svg>
  if (kind === 'schedule')     return <svg {...c}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
  return <svg {...c}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
}

/* ── Route resolver ─────────────────────────────────── */
function resolveNotificationRoute(item: WebNotification): string {
  const type = String(item.type || '').toLowerCase()
  const data = item.data
  const requestId = data?.requestId || data?.serviceRequestId || (typeof data?.id === 'string' && type.includes('request') ? data.id : null)
  if (requestId) return `/user/requests/${encodeURIComponent(String(requestId))}`
  if (type.includes('request') || type.includes('order') || type.includes('casket') || type.includes('booking')) return '/user/requests'
  if (type.includes('payment') || type.includes('refund') || type.includes('payout')) return '/user/requests'
  if (type === 'funeral_new_product') {
    const productId = data?.productId
    const shopId = data?.shopId
    if (productId) return `/funeral/product/${encodeURIComponent(String(productId))}`
    if (shopId) return `/shop/${encodeURIComponent(String(shopId))}`
  }
  if (type === 'funeral_shop_approved' || type === 'funeral_shop_rejected') return '/user/profile'
  if (type === 'account_deletion_updated') return '/user/privacy-data'
  return '/user/notifications'
}

type NotificationDropdownProps = {
  iconOnly?: boolean
  className?: string
  variant?: 'default' | 'seller-centre'
}

export default function NotificationDropdown({ iconOnly = true, className = '', variant = 'default' }: NotificationDropdownProps) {
  const [isOpen, setIsOpen]             = useState(false)
  const [userId, setUserId]             = useState<string | null>(null)
  const [notifications, setNotifications] = useState<WebNotification[]>([])
  const [loading, setLoading]           = useState(false)
  const [markingAll, setMarkingAll]     = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate    = useNavigate()

  /* Auth */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user?.id ?? null))
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setUserId(s?.user?.id ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  /* Load & realtime */
  useEffect(() => {
    if (!userId) { setNotifications([]); return }
    let active = true
    const load = async () => {
      try {
        setLoading(true)
        const list = await fetchNotificationsForUser(userId)
        if (active) setNotifications((list as WebNotification[]) || [])
      } catch { /* non-blocking */ }
      finally { if (active) setLoading(false) }
    }
    void load()
    const ch = supabase
      .channel(`web-notif-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `userId=eq.${userId}` }, () => void load())
      .subscribe()
    return () => { active = false; void supabase.removeChannel(ch) }
  }, [userId])

  /* Click-outside / Escape */
  useEffect(() => {
    if (!isOpen) return
    const onClickOut = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('mousedown', onClickOut)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClickOut); document.removeEventListener('keydown', onKey) }
  }, [isOpen])

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])
  const hasUnread   = unreadCount > 0
  const sellerCentreVariant = variant === 'seller-centre'

  const handleClick = async (item: WebNotification) => {
    if (!item.read) {
      setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n))
      try { await markNotificationRead(item.id) } catch { /* non-blocking */ }
    }
    setIsOpen(false)
    navigate(resolveNotificationRoute(item))
  }

  const handleMarkAll = async () => {
    const ids = notifications.filter(n => !n.read).map(n => n.id)
    if (!ids.length || markingAll) return
    setMarkingAll(true)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    try { await markNotificationsRead(ids) } catch { /* non-blocking */ }
    finally { setMarkingAll(false) }
  }

  const handleTrigger = () => {
    if (!userId) { navigate('/login?next=/user/notifications'); return }
    setIsOpen(prev => !prev)
  }

  return (
    <div className={`sc-web-notif-wrap${sellerCentreVariant ? ' is-seller-centre' : ''} ${className}`} ref={dropdownRef}>
      {/* ── Trigger ── */}
      <button
        type="button"
        className={`sc-web-notif-btn ${iconOnly || sellerCentreVariant ? 'is-icon-only' : ''} ${isOpen ? 'is-active' : ''}`}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={handleTrigger}
      >
        <span className="sc-web-notif-icon-wrap">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="sc-web-notif-badge" aria-label={`${unreadCount} unread notifications`}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </span>
        {!iconOnly && !sellerCentreVariant && <span className="sc-web-notif-label">Notifications</span>}
      </button>

      {/* ── Dropdown ── */}
      {isOpen && sellerCentreVariant && (
        <div className="sc-web-notif-dropdown sc-web-notif-dropdown--seller-centre" role="dialog" aria-label="Notifications" aria-modal="false">
          <div className="sc-web-notif-compact-header">
            <span>Notifications</span>
            <button
              type="button"
              className="sc-web-notif-compact-viewall"
              onClick={() => { setIsOpen(false); navigate('/user/notifications') }}
            >
              View All
            </button>
          </div>
          <div className="sc-web-notif-compact-list">
            {loading && notifications.length === 0 ? (
              <p className="sc-web-notif-compact-empty">Loading notifications...</p>
            ) : notifications.length === 0 ? (
              <p className="sc-web-notif-compact-empty">No notifications yet.</p>
            ) : (
              notifications.slice(0, 8).map(item => (
                <button
                  type="button"
                  key={item.id}
                  className={`sc-web-notif-compact-row${item.read ? '' : ' unread'}`}
                  onClick={() => void handleClick(item)}
                  title={getAbsoluteTime(item.createdAt)}
                >
                  <strong>{item.title || item.type || 'Notification'}</strong>
                  <span>{item.message || item.body || ''}</span>
                  <time>{getSellerCentreTimeLabel(item.createdAt)}</time>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {isOpen && !sellerCentreVariant && (
        <div className="sc-web-notif-dropdown" role="dialog" aria-label="Notifications" aria-modal="false">

          {/* Header — matches mobile inboxSummary */}
          <div className="sc-web-notif-header">
            <div className="sc-web-notif-header-icon">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#2f6b55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div className="sc-web-notif-header-copy">
              <span className="sc-web-notif-title">
                {hasUnread
                  ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}`
                  : "You're all caught up"}
              </span>
              <span className="sc-web-notif-subtitle">Service requests, payments &amp; shop activity</span>
            </div>
            <div className="sc-web-notif-header-actions">
              {hasUnread && (
                <button
                  type="button"
                  className="sc-web-notif-mark-all"
                  onClick={handleMarkAll}
                  disabled={markingAll}
                  title="Mark all as read"
                >
                  {markingAll ? '…' : 'Mark all read'}
                </button>
              )}
              <button
                type="button"
                className="sc-web-notif-viewall"
                onClick={() => { setIsOpen(false); navigate('/user/notifications') }}
              >
                View All
              </button>
            </div>
          </div>

          {/* List */}
          <div className="sc-web-notif-list">
            {loading && notifications.length === 0 ? (
              <div className="sc-web-notif-skeleton-wrap">
                {[1, 2, 3].map(i => (
                  <div key={i} className="sc-web-notif-skeleton">
                    <div className="sc-web-notif-skeleton-icon" />
                    <div className="sc-web-notif-skeleton-body">
                      <div className="sc-web-notif-skeleton-line wide" />
                      <div className="sc-web-notif-skeleton-line" />
                      <div className="sc-web-notif-skeleton-line narrow" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="sc-web-notif-empty">
                <div className="sc-web-notif-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#52635d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
                  </svg>
                </div>
                <p className="sc-web-notif-empty-title">No notifications yet</p>
                <span className="sc-web-notif-empty-text">Requests, payments, and shop updates will appear here.</span>
              </div>
            ) : (
              notifications.slice(0, 10).map(item => {
                const { kind, color, bg } = getVisual(item.type)
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`sc-web-notif-row${item.read ? '' : ' unread'}`}
                    onClick={() => void handleClick(item)}
                    title={getAbsoluteTime(item.createdAt)}
                  >
                    {/* Category icon — circular, matches mobile */}
                    <span className="sc-web-notif-icon-avatar" style={{ background: bg }}>
                      <NotifSVG kind={kind} color={color} />
                    </span>

                    <div className="sc-web-notif-row-body">
                      <div className="sc-web-notif-title-row">
                        {!item.read && <span className="sc-web-notif-dot" aria-hidden="true" />}
                        <strong className="sc-web-notif-row-title">{item.title || item.type || 'Notification'}</strong>
                        <time className="sc-web-notif-row-time">{getTimeLabel(item.createdAt)}</time>
                      </div>
                      <span className="sc-web-notif-row-body-text">{item.body || item.message || ''}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="sc-web-notif-footer">
              <button
                type="button"
                className="sc-web-notif-footer-btn"
                onClick={() => { setIsOpen(false); navigate('/user/notifications') }}
              >
                See all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
