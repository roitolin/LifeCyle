import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { supabase } from '@/lib/supabase'
import {
  deleteNotificationsByIds,
  fetchNotificationsForUser,
  isChatNotificationType,
  markNotificationRead,
  markNotificationsRead,
  markNotificationsUnread,
} from '@/utils/supabaseNotifications'
import { getNotificationPreferences, isNotificationTypeEnabled } from '@/utils/notificationPreferences'
import './NotificationPage.css'

type Notification = {
  id: string
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown> | null
  read: boolean
  createdAt: string
}

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
  role?: string | null
}

type NotificationFilter = 'all' | 'requests' | 'payments' | 'updates'
type NotificationVisual = 'refund' | 'payment' | 'success' | 'request' | 'message' | 'product' | 'shop' | 'announcement' | 'schedule' | 'default'

const REQUEST_NOTIFICATION_TYPES = new Set([
  'funeral_request_pending',
  'funeral_payment_submitted',
  'funeral_payment_ready',
  'funeral_request_updated',
  'funeral_payment_verified',
  'funeral_payment_rejected',
  'funeral_request_completed',
  'funeral_refund_requested',
  'funeral_refund_updated',
  'death_certificate_requested',
  'death_certificate_ready',
])

function notificationDate(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? null : date
}

function isDateToday(date: Date | null) {
  if (!date) return false
  const today = new Date()
  return date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate()
}

function formatNotificationTime(timestamp: string) {
  const date = notificationDate(timestamp)
  if (!date) return ''
  if (isDateToday(date)) return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

function getNotificationCategory(type: string): Exclude<NotificationFilter, 'all'> {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('payment') || normalized.includes('refund')) return 'payments'
  if (normalized.includes('request') || normalized.includes('booking') || normalized.includes('order')) return 'requests'
  return 'updates'
}

function getNotificationVisual(type: string): NotificationVisual {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('payment_rejected') || normalized.includes('refund')) return 'refund'
  if (normalized.includes('payment')) return 'payment'
  if (normalized.includes('completed') || normalized.includes('verified')) return 'success'
  if (normalized.includes('request') || normalized.includes('booking') || normalized.includes('order')) return 'request'
  if (normalized.includes('chat') || normalized.includes('message') || normalized.includes('support')) return 'message'
  if (normalized.includes('product')) return 'product'
  if (normalized.includes('shop_approved') || normalized.includes('shop_rejected')) return 'shop'
  if (normalized.includes('announcement')) return 'announcement'
  if (normalized.includes('schedule') || normalized.includes('reminder')) return 'schedule'
  return 'default'
}

function NotificationTypeIcon({ kind }: { kind: NotificationVisual }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'refund') return <svg {...common}><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v1"/></svg>
  if (kind === 'payment') return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/></svg>
  if (kind === 'success') return <svg {...common}><path d="M20 6 9 17l-5-5"/></svg>
  if (kind === 'request') return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
  if (kind === 'message') return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>
  if (kind === 'product') return <svg {...common}><path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5M3 8v8l9 5 9-5V8M12 13v8"/></svg>
  if (kind === 'shop') return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
  if (kind === 'announcement') return <svg {...common}><path d="m3 11 18-5v12L3 14v-3Z"/><path d="m6 14 1 6h4l-1-5"/></svg>
  if (kind === 'schedule') return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
  return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
}

function dataString(data: Record<string, unknown> | null | undefined, key: string) {
  const value = data?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function notificationDestination(notification: Notification, role?: string | null) {
  const type = String(notification.type || '').toLowerCase()
  const data = notification.data
  const isAdmin = ['admin', 'super_admin', 'funeral_admin'].includes(String(role || '').toLowerCase())
  if (isAdmin) {
    if (type.includes('request') || type.includes('order') || type.includes('payment')) return '/admin/orders'
    if (type === 'abuse_report') return '/admin/moderation'
    if (type === 'feedback_new' || type === 'rating_update') return '/admin/feedback'
    if (type === 'signup' || type === 'account_deletion_requested') return '/admin/users'
    if (type.includes('support') || type.includes('chat') || type.includes('message')) return '/admin/support'
    return '/admin/dashboard'
  }
  if (REQUEST_NOTIFICATION_TYPES.has(type) || getNotificationCategory(type) === 'requests') return '/user/requests'
  if (type === 'funeral_new_product') {
    const productId = dataString(data, 'productId')
    const shopId = dataString(data, 'shopId')
    if (productId) return `/funeral/product/${encodeURIComponent(productId)}`
    if (shopId) return `/shop/${encodeURIComponent(shopId)}`
  }
  if (type === 'funeral_shop_approved' || type === 'funeral_shop_rejected') return '/user/profile'
  if (type === 'account_deletion_updated') return '/user/privacy-data'
  return '/funeral'
}

export default function NotificationPage() {
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [selectedFilter, setSelectedFilter] = useState<NotificationFilter>('all')
  const [manageOpen, setManageOpen] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionBusy, setSelectionBusy] = useState(false)

  const loadNotifications = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setLoadError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setNotifications([])
        return
      }
      const preferences = getNotificationPreferences(session.user.id)
      const data = await fetchNotificationsForUser(session.user.id)
      setNotifications((data as Notification[]).filter(item => (
        !isChatNotificationType(item.type) && isNotificationTypeEnabled(item.type, preferences)
      )))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Notifications could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotifications()
    const channel = supabase
      .channel(`notifications-page-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void loadNotifications(false)
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [loadNotifications])

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const { data } = await supabase.from('users').select('fullName, photoURL, role').eq('id', session.user.id).maybeSingle()
      setProfile(data ?? { fullName: session.user.email, photoURL: null, role: 'user' })
    }
    void loadProfile()
  }, [])

  const unreadCount = useMemo(() => notifications.filter(item => !item.read).length, [notifications])
  const readCount = notifications.length - unreadCount
  const filteredNotifications = useMemo(() => selectedFilter === 'all'
    ? notifications
    : notifications.filter(item => getNotificationCategory(item.type) === selectedFilter), [notifications, selectedFilter])
  const sections = useMemo(() => {
    const today: Notification[] = []
    const earlier: Notification[] = []
    filteredNotifications.forEach(item => {
      if (isDateToday(notificationDate(item.createdAt))) today.push(item)
      else earlier.push(item)
    })
    return [
      { title: 'Today', items: today },
      { title: 'Earlier', items: earlier },
    ].filter(section => section.items.length > 0)
  }, [filteredNotifications])
  const allVisibleSelected = filteredNotifications.length > 0 && filteredNotifications.every(item => selectedIds.has(item.id))

  const refreshNotifications = async () => {
    setRefreshing(true)
    await loadNotifications(false)
    setRefreshing(false)
  }

  const showActionError = (title: string, error: unknown) => {
    openAlert({ title, message: error instanceof Error ? error.message : 'Please try again.', tone: 'danger' })
  }

  const markAsRead = async (id: string) => {
    try {
      await markNotificationRead(id)
      setNotifications(current => current.map(item => item.id === id ? { ...item, read: true } : item))
    } catch (error) {
      showActionError('Notification not updated', error)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openNotification = async (notification: Notification) => {
    if (selectionMode) {
      toggleSelected(notification.id)
      return
    }
    if (!notification.read) await markAsRead(notification.id)
    navigate(notificationDestination(notification, profile?.role))
  }

  const markAllAsRead = async () => {
    const ids = notifications.filter(item => !item.read).map(item => item.id)
    if (!ids.length) return
    try {
      await markNotificationsRead(ids)
      const idSet = new Set(ids)
      setNotifications(current => current.map(item => idSet.has(item.id) ? { ...item, read: true } : item))
      setManageOpen(false)
    } catch (error) {
      showActionError('Notifications not updated', error)
    }
  }

  const leaveSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const startSelectionMode = (id?: string) => {
    setManageOpen(false)
    setSelectionMode(true)
    setSelectedIds(id ? new Set([id]) : new Set())
  }

  const selectAllVisible = () => {
    setSelectedIds(current => {
      const next = new Set(current)
      filteredNotifications.forEach(item => {
        if (allVisibleSelected) next.delete(item.id)
        else next.add(item.id)
      })
      return next
    })
  }

  const updateSelectedReadState = async (read: boolean) => {
    const ids = Array.from(selectedIds)
    if (!ids.length || selectionBusy) return
    setSelectionBusy(true)
    try {
      if (read) await markNotificationsRead(ids)
      else await markNotificationsUnread(ids)
      const idSet = new Set(ids)
      setNotifications(current => current.map(item => idSet.has(item.id) ? { ...item, read } : item))
      leaveSelectionMode()
    } catch (error) {
      showActionError('Notifications not updated', error)
    } finally {
      setSelectionBusy(false)
    }
  }

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds)
    if (!ids.length || selectionBusy) return
    setSelectionBusy(true)
    try {
      await deleteNotificationsByIds(ids)
      const idSet = new Set(ids)
      setNotifications(current => current.filter(item => !idSet.has(item.id)))
      leaveSelectionMode()
    } catch (error) {
      showActionError('Notifications not deleted', error)
    } finally {
      setSelectionBusy(false)
    }
  }

  const confirmDeleteSelected = () => {
    if (!selectedIds.size) return
    openConfirm({
      title: 'Delete selected notifications?',
      message: `${selectedIds.size} notification${selectedIds.size === 1 ? '' : 's'} will be permanently removed.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: deleteSelected,
    })
  }

  const confirmDeleteRead = () => {
    if (!readCount) return
    setManageOpen(false)
    openConfirm({
      title: 'Delete all read notifications?',
      message: `${readCount} read notification${readCount === 1 ? '' : 's'} will be permanently removed.`,
      confirmLabel: 'Delete Read',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const ids = notifications.filter(item => item.read).map(item => item.id)
          await deleteNotificationsByIds(ids)
          const idSet = new Set(ids)
          setNotifications(current => current.filter(item => !idSet.has(item.id)))
        } catch (error) {
          showActionError('Notifications not deleted', error)
        }
      },
    })
  }

  return (
    <div className="notification-page">
      <div className="notification-topbar">
        <div className="notification-topbar-inner">
          <div className="notification-topbar-left">
            <Link to="/seller">Seller Centre</Link>
          </div>
          <div className="notification-topbar-right">
            <Link to="/user/notifications" aria-current="page">Notifications</Link>
            <Link to="/user/help">Help Centre</Link>
            <span className="notification-topbar-divider">|</span>
            <div className="notification-user-menu">
              <div className="notification-user-menu-trigger">
                {profile?.photoURL ? <img src={profile.photoURL} alt="Avatar" className="notification-user-avatar" /> : (
                  <div className="notification-user-avatar-placeholder"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" /></svg></div>
                )}
                <span className="notification-user-name">{profile?.fullName || 'User'}</span>
                <svg className="notification-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <div className="notification-user-dropdown">
                <Link to="/user/profile">My Account</Link>
                <Link to="/user/purchase">Purchases</Link>
                <Link to="/auth/switch-account">Switch Account</Link>
                <Link to="/auth/logout">Log out</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <header className="notification-header">
        <div className="notification-header-inner">
          <BrandLogo to="/" />
          <div className="notification-header-divider" />
          <h1>Notifications</h1>
        </div>
      </header>

      <main className="notification-main">
        <div className="notification-page-nav">
          <button type="button" className="notification-back-btn" onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
            Back
          </button>
        </div>

        <section className={`notification-inbox-toolbar${selectionMode ? ' selecting' : ''}`}>
          {selectionMode ? (
            <>
              <button type="button" className="notification-selection-close" onClick={leaveSelectionMode} aria-label="Cancel selection">×</button>
              <div className="notification-summary-copy">
                <strong>{selectedIds.size} selected</strong>
                <span>Choose notifications, then use an action below.</span>
              </div>
              <button type="button" className="notification-select-all" onClick={selectAllVisible}>{allVisibleSelected ? 'Clear' : 'Select all'}</button>
            </>
          ) : (
            <>
              <div className="notification-summary-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 10h18M5 10v10h14V10M4 4h16l1 6H3l1-6ZM9 14h6" /></svg></div>
              <div className="notification-summary-copy">
                <strong>{unreadCount > 0 ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}` : "You're all caught up"}</strong>
                <span>Service requests, payments, and shop activity</span>
              </div>
              <div className="notification-toolbar-actions">
                <button type="button" className="notification-refresh-btn" onClick={() => void refreshNotifications()} disabled={refreshing}>
                  <svg className={refreshing ? 'spinning' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6v5h-5M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></svg>
                  Refresh
                </button>
                <button type="button" className="notification-manage-btn" onClick={() => setManageOpen(true)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
                  Manage
                </button>
              </div>
            </>
          )}
        </section>

        <nav className="notification-filters" aria-label="Notification categories">
          {([
            ['all', 'All'],
            ['requests', 'Requests'],
            ['payments', 'Payments'],
            ['updates', 'Shop updates'],
          ] as [NotificationFilter, string][]).map(([key, label]) => (
            <button key={key} type="button" className={selectedFilter === key ? 'active' : ''} onClick={() => setSelectedFilter(key)} aria-pressed={selectedFilter === key}>{label}</button>
          ))}
        </nav>

        {loading ? (
          <section className="notification-empty-state"><span className="notification-spinner" /><p>Loading notifications...</p></section>
        ) : loadError ? (
          <section className="notification-empty-state notification-error-state">
            <div className="notification-empty-icon">!</div>
            <h2>Notifications unavailable</h2>
            <p>{loadError}</p>
            <button type="button" className="notification-checkout-btn" onClick={() => void loadNotifications()}>Try Again</button>
          </section>
        ) : sections.length === 0 ? (
          <section className="notification-empty-state">
            <div className="notification-empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M4 4l16 16"/></svg></div>
            <h2>No notifications here</h2>
            <p>{selectedFilter === 'all' ? 'New service and shop updates will appear here.' : 'There are no notifications in this category.'}</p>
            {selectedFilter === 'all' ? <Link to="/funeral" className="notification-checkout-btn">Browse Products</Link> : null}
          </section>
        ) : (
          <div className="notification-feed">
            {sections.map(section => (
              <section key={section.title} className="notification-date-group">
                <div className="notification-date-heading"><span>{section.title}</span><span className="notification-date-count">{section.items.length}</span></div>
                {section.items.map(item => {
                  const visual = getNotificationVisual(item.type)
                  const selected = selectedIds.has(item.id)
                  return (
                    <article
                      key={item.id}
                      className={`notification-item${item.read ? ' read' : ' unread'}${selected ? ' selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selectionMode ? selected : undefined}
                      onClick={() => void openNotification(item)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void openNotification(item)
                        }
                      }}
                    >
                      <div className={`notification-item-icon visual-${visual}`}><NotificationTypeIcon kind={visual} /></div>
                      <div className="notification-item-content">
                        <div className="notification-item-title-row">
                          {!item.read ? <span className="notification-unread-dot" aria-label="Unread" /> : null}
                          <strong>{item.title}</strong>
                          <time>{formatNotificationTime(item.createdAt)}</time>
                        </div>
                        <p>{item.body}</p>
                      </div>
                      {selectionMode ? (
                        <button type="button" className={`notification-selection-check${selected ? ' selected' : ''}`} onClick={(event) => { event.stopPropagation(); toggleSelected(item.id) }} aria-label={`${selected ? 'Deselect' : 'Select'} ${item.title}`}>
                          {selected ? '✓' : ''}
                        </button>
                      ) : <span className="notification-row-arrow" aria-hidden="true">›</span>}
                    </article>
                  )
                })}
              </section>
            ))}
            {!selectionMode ? <p className="notification-hold-hint">Use Manage to select and organize multiple notifications.</p> : null}
          </div>
        )}
      </main>

      {selectionMode ? (
        <div className="notification-selection-bar" aria-label="Selected notification actions">
          <div className="notification-selection-bar-inner">
            <strong>{selectedIds.size} selected</strong>
            <button type="button" onClick={() => void updateSelectedReadState(true)} disabled={!selectedIds.size || selectionBusy}>Mark Read</button>
            <button type="button" onClick={() => void updateSelectedReadState(false)} disabled={!selectedIds.size || selectionBusy}>Mark Unread</button>
            <button type="button" className="danger" onClick={confirmDeleteSelected} disabled={!selectedIds.size || selectionBusy}>Delete</button>
          </div>
        </div>
      ) : null}

      {manageOpen ? (
        <div className="notification-manage-overlay" role="presentation" onMouseDown={() => setManageOpen(false)}>
          <section className="notification-manage-panel" role="dialog" aria-modal="true" aria-labelledby="notification-manage-title" onMouseDown={event => event.stopPropagation()}>
            <div className="notification-manage-header">
              <div className="notification-manage-header-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg></div>
              <div><h2 id="notification-manage-title">Manage notifications</h2><p>Organize service and shop updates.</p></div>
              <button type="button" className="notification-manage-close" onClick={() => setManageOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="notification-manage-stats">
              <div><strong>{unreadCount}</strong><span>Unread</span></div><span className="notification-manage-stat-divider"/><div><strong>{readCount}</strong><span>Read</span></div>
            </div>
            <div className="notification-manage-options">
              <button type="button" onClick={() => startSelectionMode()} disabled={!notifications.length}><span className="manage-option-icon select">✓</span><span><strong>Select notifications</strong><small>Choose items to mark read, unread, or delete.</small></span><b>›</b></button>
              <button type="button" onClick={() => void markAllAsRead()} disabled={!unreadCount}><span className="manage-option-icon read">✓</span><span><strong>Mark all as read</strong><small>{unreadCount ? 'Clear every unread indicator.' : 'Everything is already read.'}</small></span><b>›</b></button>
              <button type="button" className="danger" onClick={confirmDeleteRead} disabled={!readCount}><span className="manage-option-icon delete">×</span><span><strong>Delete all read</strong><small>Keep unread updates and remove opened ones.</small></span><b>›</b></button>
            </div>
          </section>
        </div>
      ) : null}

      {alertDialog}
      {confirmDialog}
    </div>
  )
}
