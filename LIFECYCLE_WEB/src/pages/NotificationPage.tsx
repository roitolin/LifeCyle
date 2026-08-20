import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchNotificationsForUser } from '@/utils/supabaseNotifications'
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
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NotificationPage() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadNotifications = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      setLoading(false)
      return
    }
    const preferences = getNotificationPreferences(session.user.id)
    const data = await fetchNotificationsForUser(session.user.id)
    setNotifications((data as Notification[]).filter(item => isNotificationTypeEnabled(item.type, preferences)))
    setLoading(false)
  }

  const markAsRead = async (id: string) => {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
    if (!error) {
      setNotifications(current => current.map(n => n.id === id ? { ...n, read: true } : n))
    }
  }

  const markAllAsRead = async () => {
    const unread = notifications.filter(n => !n.read)
    const ids = unread.map(n => n.id)
    const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids)
    if (!error) {
      setNotifications(current => current.map(n => ({ ...n, read: true })))
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications()
    const channel = supabase
      .channel(`notifications-page-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        loadNotifications()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const { data } = await supabase.from('users').select('fullName, photoURL').eq('id', session.user.id).maybeSingle()
      setProfile(data ?? { fullName: session.user.email, photoURL: null })
    }
    void loadProfile()
  }, [])

  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications])
  const groupedNotifications = useMemo(() => {
    const groups = new Map<string, Notification[]>()
    notifications.forEach(n => {
      const date = formatDate(n.createdAt).split(',')[0]
      groups.set(date, [...(groups.get(date) ?? []), n])
    })
    return Array.from(groups.entries()).reverse()
  }, [notifications])

  return (
    <div className="notification-page">
      <div className="notification-topbar">
        <div className="notification-topbar-left">
          <button type="button" className="notification-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Back
          </button>
          <span className="notification-topbar-divider">|</span>
          <Link to="/seller">Seller Centre</Link>
          <span className="notification-topbar-divider">|</span>
          <span>Follow us on</span>
          <a href="#facebook" aria-label="Facebook">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"></path></svg>
          </a>
          <a href="#instagram" aria-label="Instagram">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg>
          </a>
        </div>
        <div className="notification-topbar-right">
          <a href="#help">Help</a>
          <a href="#language">English</a>
          <span className="notification-topbar-divider">|</span>
          <div className="notification-user-menu">
            <div className="notification-user-menu-trigger">
              <svg className="notification-user-avatar" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              <span className="notification-user-name">{profile?.fullName || 'User'}</span>
              <svg className="notification-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div className="notification-user-dropdown">
              <Link to="/user/profile">My Account</Link>
              <Link to="/user/purchase">Purchases</Link>
              <Link to="/auth/logout">Log out</Link>
            </div>
          </div>
        </div>
      </div>

      <header className="notification-header">
        <Link to="/funeral" className="notification-brand" aria-label="LifeCycle home">
          <span className="notification-logo-bag">LC</span>
          <span className="notification-brand-name">LifeCycle</span>
        </Link>
        <div className="notification-header-divider" />
        <h1>Notifications</h1>
        {unreadCount > 0 && (
          <span className="notification-unread-pill">{unreadCount} unread</span>
        )}
        {unreadCount > 0 && (
          <button type="button" className="notification-mark-all" onClick={markAllAsRead}>
            Mark all as read
          </button>
        )}
      </header>

      <main className="notification-main">
        {loading ? (
          <section className="notification-empty-state">
            <span className="notification-spinner" />
            <p>Loading notifications...</p>
          </section>
        ) : notifications.length === 0 ? (
          <section className="notification-empty-state">
            <div className="notification-empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <h2>No Notifications</h2>
            <p>You have no notifications at this time.</p>
            <Link to="/funeral" className="notification-checkout-btn">Browse Products</Link>
          </section>
        ) : groupedNotifications.map(([date, items]) => (
          <section key={date} className="notification-date-group">
            <div className="notification-date-heading">
              <span className="notification-date-label">{date}</span>
              <span className="notification-date-count">{items.length}</span>
            </div>
            {items.map(item => (
              <article
                key={item.id}
                className={`notification-item${item.read ? ' read' : ' unread'}`}
                onClick={() => markAsRead(item.id)}
              >
                <div className="notification-item-icon">
                  {item.read ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                  )}
                </div>
                <div className="notification-item-content">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
                <span className="notification-item-time">
                  {formatDate(item.createdAt).split(', ')[1]}
                  {item.read ? null : <span className="notification-unread-dot" />}
                </span>
              </article>
            ))}
          </section>
        ))}
      </main>

      <footer className="notification-sticky-footer">
        <span className="notification-footer-spacer" />
        <strong>{notifications.length} notification{notifications.length === 1 ? '' : 's'}</strong>
      </footer>
    </div>
  )
}
