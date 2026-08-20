import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
} from '@/utils/notificationPreferences'
import ProfileLayout from './ProfileLayout'

type PreferenceKey = keyof NotificationPreferences

const categories: Array<{ key: PreferenceKey, title: string, description: string }> = [
  { key: 'serviceRequests', title: 'Service requests', description: 'Status changes and updates for your service requests.' },
  { key: 'payments', title: 'Payments', description: 'Payment instructions, submissions, and verification updates.' },
  { key: 'messages', title: 'Messages', description: 'Alerts for new support and conversation messages.' },
  { key: 'announcements', title: 'Announcements', description: 'Important news and newly available products.' },
]

export default function NotificationPreferencesPage() {
  const [userId, setUserId] = useState('')
  const [preferences, setPreferences] = useState<NotificationPreferences>({ ...DEFAULT_NOTIFICATION_PREFERENCES })
  const [status, setStatus] = useState('Loading preferences...')

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id || ''
      setUserId(id)
      setPreferences(id ? getNotificationPreferences(id) : { ...DEFAULT_NOTIFICATION_PREFERENCES })
      setStatus('Changes are saved automatically on this browser.')
    })
  }, [])

  const setPreference = (key: PreferenceKey, value: boolean) => {
    if (!userId) return
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    try {
      saveNotificationPreferences(userId, next)
      setStatus('Changes saved.')
    } catch {
      setStatus('Changes could not be saved. Please try again.')
    }
  }

  const row = ({ key, title, description }: { key: PreferenceKey, title: string, description: string }) => (
    <label className="settings-toggle-row" key={key}>
      <span className="settings-row-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      </span>
      <span className="settings-row-copy"><strong>{title}</strong><small>{description}</small></span>
      <span className="settings-switch">
        <input type="checkbox" checked={preferences[key]} onChange={event => setPreference(key, event.target.checked)} disabled={!userId} />
        <span aria-hidden="true" />
      </span>
    </label>
  )

  return (
    <ProfileLayout title="Notification Preferences" subtitle="Choose the updates and sounds you receive.">
      <div className="settings-page-content">
        <section className="settings-panel" aria-labelledby="notification-categories-title">
          <h2 id="notification-categories-title">Notification categories</h2>
          <div className="settings-row-list">{categories.map(row)}</div>
        </section>
        <section className="settings-panel" aria-labelledby="notification-sound-title">
          <h2 id="notification-sound-title">Alert sound</h2>
          <div className="settings-row-list">
            {row({ key: 'sound', title: 'Notification sound', description: 'Allow sounds for enabled app and message notifications.' })}
          </div>
        </section>
        <p className={`settings-status${status.includes('could not') ? ' error' : ''}`} role="status">{status}</p>
      </div>
    </ProfileLayout>
  )
}

