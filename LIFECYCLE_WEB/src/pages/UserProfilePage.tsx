import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import ProfileLayout from './ProfileLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import LogoutLink from '@/components/LogoutLink'

type MobileProfileIconName =
  | 'shop'
  | 'requests'
  | 'payments'
  | 'favorites'
  | 'account'
  | 'privacy'
  | 'notifications'
  | 'preferences'
  | 'about'
  | 'feedback'
  | 'help'
  | 'contact'
  | 'policy'
  | 'terms'
  | 'switch'
  | 'logout'

type MobileProfileItem = {
  to: string
  icon: MobileProfileIconName
  label: string
  description?: string
}

const mobileProfileGroups: Array<{ label: string, items: MobileProfileItem[] }> = [
  {
    label: 'Services & Payments',
    items: [
      { to: '/seller', icon: 'shop', label: 'Shop Center', description: 'Manage or register your funeral shop' },
      { to: '/user/requests', icon: 'requests', label: 'My Service Requests', description: 'Track requests sent to funeral shops' },
      { to: '/user/purchase', icon: 'payments', label: 'My Payments', description: 'View payment status and history' },
      { to: '/user/favorites', icon: 'favorites', label: 'Favorites', description: 'Review your saved products and services' },
    ],
  },
  {
    label: 'Security & Privacy',
    items: [
      { to: '/user/account-settings', icon: 'account', label: 'Account Settings', description: 'Password, blocking, and account activity' },
      { to: '/user/privacy-data', icon: 'privacy', label: 'Privacy & Data', description: 'Export your data or request account deletion' },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { to: '/user/notifications', icon: 'notifications', label: 'Notifications', description: 'Read your latest LifeCycle updates' },
      { to: '/user/notification-preferences', icon: 'preferences', label: 'Notification Preferences', description: 'Choose the updates and sounds you receive' },
    ],
  },
  {
    label: 'Help & Information',
    items: [
      { to: '/user/about', icon: 'about', label: 'About LifeCycle' },
      { to: '/user/feedback', icon: 'feedback', label: 'Rate & Feedback' },
      { to: '/user/help', icon: 'help', label: 'Help Centre', description: 'Guides and frequently asked questions' },
      { to: '/user/contact', icon: 'contact', label: 'Contact Support' },
      { to: '/privacy-policy', icon: 'policy', label: 'Privacy Policy' },
      { to: '/policies', icon: 'terms', label: 'Platform Policies' },
    ],
  },
]

function MobileProfileIcon({ name }: { name: MobileProfileIconName }) {
  let content
  switch (name) {
    case 'shop':
      content = <><path d="M4 10v10h16V10" /><path d="M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>
      break
    case 'requests':
      content = <><path d="M7 3h10l3 3v15H4V3h3" /><path d="M8 3v4h8V3M8 12h8M8 16h6" /></>
      break
    case 'payments':
      content = <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>
      break
    case 'favorites':
      content = <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" />
      break
    case 'account':
      content = <><path d="M12 3 4 6v5c0 5 3.4 8.2 8 10 4.6-1.8 8-5 8-10V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>
      break
    case 'privacy':
      content = <><path d="M12 2a6 6 0 0 0-6 6v3M18 11V8a6 6 0 0 0-6-6" /><path d="M8 11v2a4 4 0 0 0 8 0v-2M12 13v8" /></>
      break
    case 'notifications':
      content = <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M14 21h-4" /></>
      break
    case 'preferences':
      content = <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>
      break
    case 'about':
      content = <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>
      break
    case 'feedback':
      content = <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
      break
    case 'help':
      content = <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.5 2.1c-.8.4-1.3 1-1.3 1.9M12 17h.01" /></>
      break
    case 'contact':
      content = <><path d="M4 5h16v12H8l-4 4V5Z" /><path d="M8 9h8M8 13h5" /></>
      break
    case 'policy':
      content = <><path d="M12 3 4 6v5c0 5 3.4 8.2 8 10 4.6-1.8 8-5 8-10V6l-8-3Z" /><path d="M9 12h6" /></>
      break
    case 'terms':
      content = <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>
      break
    case 'switch':
      content = <><path d="M7 7h11l-3-3M17 17H6l3 3" /><path d="M18 7l-3 3M6 17l3-3" /></>
      break
    case 'logout':
      content = <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" /></>
      break
  }

  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{content}</svg>
}

function MobileProfileAction({ item }: { item: MobileProfileItem }) {
  return (
    <Link to={item.to} className="mobile-profile-action-row">
      <span className="mobile-profile-action-icon" aria-hidden="true"><MobileProfileIcon name={item.icon} /></span>
      <span className="mobile-profile-action-copy">
        <strong>{item.label}</strong>
        {item.description ? <small>{item.description}</small> : null}
      </span>
      <span className="mobile-profile-chevron" aria-hidden="true">&rsaquo;</span>
    </Link>
  )
}
export default function UserProfilePage() {
  const [viewer, setViewer] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false)
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()

  /* form mirrors DB exactly */
  const [fullName, setFullName] = useState('')
  const [gender, setGender] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [photoURL, setPhotoURL] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      setViewer(session.user)

      const { data } = await supabase.from('users').select('*').eq('id', session.user.id).maybeSingle()
      if (data) {
        setFullName(data.fullName || '')
        setGender(data.gender || '')
        // Ensure date is formatted as YYYY-MM-DD for the date input
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.substring(0, 10) : '')
        setPhotoURL(data.photoURL || null)
      }
      setLoading(false)
    }
    load()
  }, [navigate])

  useEffect(() => {
    if (!mobileEditorOpen || !window.matchMedia('(max-width: 600px)').matches) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileEditorOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileEditorOpen])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!viewer) return
    setSaving(true)
    const { error } = await supabase.from('users').update({
      fullName,
      gender,
      dateOfBirth,
      updatedAt: new Date().toISOString(),
    }).eq('id', viewer.id)

    setSaving(false)
    if (!error) {
      openAlert({
        title: 'Profile Updated',
        message: 'Profile updated successfully.',
        tone: 'info',
        okLabel: 'Done',
      })
    } else {
      openAlert({
        title: 'Update Failed',
        message: 'Error updating profile.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !viewer) return

    if (file.size > 10 * 1024 * 1024) {
      openAlert({
        title: 'File Too Large',
        message: 'File too large. Maximum 10 MB.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      openAlert({
        title: 'Unsupported File Type',
        message: 'Only JPEG and PNG files are allowed.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    /* Upload to Supabase Storage (avatars bucket) */
    const ext = file.name.split('.').pop()
    const path = `avatars/${viewer.id}.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) {
      openAlert({
        title: 'Upload Failed',
        message: 'Upload failed: ' + uploadError.message,
        tone: 'danger',
        okLabel: 'Dismiss',
      })
      return
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const newURL = urlData.publicUrl + '?t=' + Date.now()

    const { error: updateError } = await supabase.from('users').update({
      photoURL: newURL,
      updatedAt: new Date().toISOString(),
    }).eq('id', viewer.id)

    if (!updateError) {
      setPhotoURL(newURL)
      openAlert({
        title: 'Photo Updated',
        message: 'Profile picture updated.',
        tone: 'info',
        okLabel: 'Done',
      })
    } else {
      openAlert({
        title: 'Update Failed',
        message: 'Failed to update profile picture.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    }
  }

  if (loading) return <div className="profile-loading">Loading…</div>

  return (
    <ProfileLayout title="My Profile" subtitle="Manage your personal details for funeral service coordination.">
      {/* Hero Identity Card */}
      <div className="profile-identity-card">
        <div className="profile-identity-avatar-wrapper">
          {photoURL ? (
            <img src={photoURL} alt="Avatar" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
          )}
        </div>
        <div className="profile-identity-info">
          <h2 className="profile-identity-name">{fullName || viewer?.email || 'LifeCycle User'}</h2>
          <p className="profile-identity-email">{viewer?.email}</p>
        </div>
        <div className="profile-identity-actions">
          <button
            type="button"
            className="profile-identity-edit-button"
            aria-expanded={mobileEditorOpen}
            aria-controls="profile-personal-information"
            onClick={() => setMobileEditorOpen(true)}
          >
            Edit
          </button>
          <label className="btn-outline profile-photo-button">
            Change photo
            <input type="file" accept="image/jpeg,image/png" onChange={handleImageUpload} className="profile-file-input" />
          </label>
        </div>
      </div>
      <p className="profile-photo-hint">Maximum 10 MB. JPEG or PNG.</p>
      <section className="mobile-profile-hub" aria-label="Account settings">
        {mobileProfileGroups.map((group) => (
          <section className="mobile-profile-section" key={group.label}>
            <h2 className="mobile-profile-section-label">{group.label}</h2>
            <nav className="mobile-profile-actions" aria-label={group.label}>
              {group.items.map((item) => <MobileProfileAction key={item.to} item={item} />)}
            </nav>
          </section>
        ))}

        <section className="mobile-profile-section">
          <h2 className="mobile-profile-section-label">Session</h2>
          <nav className="mobile-profile-actions" aria-label="Session">
            <Link to="/auth/switch-account" className="mobile-profile-action-row">
              <span className="mobile-profile-action-icon" aria-hidden="true"><MobileProfileIcon name="switch" /></span>
              <span className="mobile-profile-action-copy">
                <strong>Switch Account</strong>
                <small>Use another saved LifeCycle account</small>
              </span>
              <span className="mobile-profile-chevron" aria-hidden="true">&rsaquo;</span>
            </Link>
            <LogoutLink className="mobile-profile-action-row is-danger">
              <span className="mobile-profile-action-icon" aria-hidden="true"><MobileProfileIcon name="logout" /></span>
              <span className="mobile-profile-action-copy"><strong>Log Out</strong></span>
            </LogoutLink>
          </nav>
        </section>
      </section>

      {/* Form Settings Card */}
      <div
        id="profile-personal-information"
        className={`profile-mobile-editor${mobileEditorOpen ? ' is-open' : ''}`}
        role={mobileEditorOpen ? 'dialog' : undefined}
        aria-modal={mobileEditorOpen ? true : undefined}
        aria-labelledby={mobileEditorOpen ? 'profile-mobile-editor-title' : undefined}
      >
        <div className="profile-mobile-editor-header">
          <button type="button" onClick={() => setMobileEditorOpen(false)} aria-label="Back to profile">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <strong id="profile-mobile-editor-title">Personal information</strong>
          <span aria-hidden="true" />
        </div>
        <div className="profile-settings-card">
          <div className="profile-settings-header">
          <h2>Personal information</h2>
        </div>
        
        <form onSubmit={handleSave}>
          <div className="profile-settings-body">
            <div className="profile-input-stack">
              <label>Full Name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>

            <div className="profile-input-stack">
              <label>Gender</label>
              <div className="profile-radio-group">
                <label>
                  <input type="radio" name="gender" value="male" checked={gender?.toLowerCase() === 'male'} onChange={e => setGender(e.target.value)} /> Male
                </label>
                <label>
                  <input type="radio" name="gender" value="female" checked={gender?.toLowerCase() === 'female'} onChange={e => setGender(e.target.value)} /> Female
                </label>
                <label>
                  <input type="radio" name="gender" value="other" checked={gender?.toLowerCase() === 'other'} onChange={e => setGender(e.target.value)} /> Other
                </label>
              </div>
            </div>

            <div className="profile-input-stack">
              <label>Date of Birth</label>
              <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} max={new Date().toISOString().split('T')[0]} />
            </div>

            <div className="profile-input-stack">
              <label>Email Address</label>
              <div className="profile-readonly-text">{viewer?.email}</div>
            </div>

            <div className="profile-input-stack">
              <label>Account UID</label>
              <div className="uid-pill">{viewer?.id}</div>
            </div>
          </div>

          <div className="profile-settings-footer">
            <button type="submit" disabled={saving} className="btn-save">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
      </div>
      
      {alertDialog}
    </ProfileLayout>
  )
}



