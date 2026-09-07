import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'
import type { TimestampLike } from '@/types/supabase'
import { getConversationId, toDateText } from '@/pages/admin/adminHelpers'
import './AdminUserDetailPage.css'

type UserDetail = {
  id: string
  email?: string
  fullName?: string
  role?: string
  disabled?: boolean
  gender?: string
  dateOfBirth?: string
  contactNumber?: string
  street?: string
  validIdURL?: string
  photoURL?: string
  banReason?: string | null
  bannedUntil?: TimestampLike
  createdAt?: TimestampLike
  updatedAt?: TimestampLike
}

function resolveDate(value: TimestampLike) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatBirthDate(value: string | undefined) {
  if (!value) return 'Not provided'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function roleLabel(value: string | undefined) {
  return String(value || 'user')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function AdminUserDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<UserDetail | null>(null)
  const [error, setError] = useState('')
  const [startingChat, setStartingChat] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setItem(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      setItem(null)
      try {
        const userSnap = await getDoc(doc(db, 'users', id))
        if (!userSnap.exists()) {
          setError('User not found.')
          return
        }

        setItem({ id: userSnap.id, ...(userSnap.data() as Omit<UserDetail, 'id'>) })
      } catch (caughtError) {
        const messageText =
          typeof caughtError === 'object' && caughtError !== null && 'message' in caughtError
            ? String(caughtError.message)
            : 'Failed to load user details.'
        setError(messageText)
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [id])

  const startConversation = async () => {
    if (!item?.id || startingChat) return
    const adminId = auth.currentUser?.uid
    if (!adminId) return
    setStartingChat(true)
    const conversationId = getConversationId(adminId, item.id)
    try {
      await setDoc(
        doc(db, 'conversations', conversationId),
        {
          participants: [adminId, item.id],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )
      navigate(`/admin/support?conversation=${encodeURIComponent(conversationId)}`)
    } finally {
      setStartingChat(false)
    }
  }

  const bannedUntilDate = item ? resolveDate(item.bannedUntil) : null
  const isTemporarilyBanned = Boolean(item?.disabled && bannedUntilDate && bannedUntilDate.getTime() > Date.now())
  const isExpiredBan = Boolean(item?.disabled && bannedUntilDate && bannedUntilDate.getTime() <= Date.now())
  const accountStatus = !item?.disabled
    ? { label: 'Active', tone: 'active', detail: 'Account access is enabled.' }
    : isTemporarilyBanned
      ? {
        label: 'Temporarily banned',
        tone: 'danger',
        detail: `Until ${bannedUntilDate?.toLocaleString(undefined, { hour12: true })}`,
      }
      : isExpiredBan
        ? {
          label: 'Ban expired',
          tone: 'warning',
          detail: `Expired ${bannedUntilDate?.toLocaleString(undefined, { hour12: true })}`,
        }
        : item?.banReason
          ? { label: 'Permanently banned', tone: 'danger', detail: 'No end date' }
          : { label: 'Disabled', tone: 'muted', detail: 'Account access disabled.' }
  const initials = (item?.fullName || item?.email || 'U')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()

  return (
    <section className="panel admin-user-detail-panel">
      <div className="admin-user-detail-topbar">
        <button type="button" className="ghost-btn admin-user-back" onClick={() => navigate('/admin/users')}>
          Back to Users
        </button>
      </div>

      {loading ? <p className="panel-sub">Loading user details...</p> : null}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}

      {item ? (
        <>
          <header className="admin-user-profile-hero">
            <div className="admin-user-avatar-large" aria-hidden={!item.photoURL}>
              {item.photoURL ? <img src={item.photoURL} alt={item.fullName || 'User profile'} /> : <span>{initials}</span>}
            </div>
            <div className="admin-user-profile-copy">
              <h2>{item.fullName || 'Unnamed user'}</h2>
              <p>{item.email || 'No email on file'}</p>
              <div className="admin-user-profile-meta">
                <span>{roleLabel(item.role)}</span>
                <span className={`admin-user-status is-${accountStatus.tone}`}>
                  <span className="admin-user-status-dot" aria-hidden="true" />
                  {accountStatus.label}
                </span>
              </div>
            </div>
            <div className="admin-user-profile-actions">
              <button type="button" className="solid-btn" onClick={() => void startConversation()} disabled={startingChat}>
                {startingChat ? 'Opening chat...' : 'Message user'}
              </button>
              {item.validIdURL ? (
                <a className="ghost-btn btn-link" href={item.validIdURL} target="_blank" rel="noreferrer">
                  Open ID
                </a>
              ) : null}
            </div>
          </header>

          {item.banReason ? (
            <div className="admin-user-alert">
              <span>Ban reason</span>
              <strong>{item.banReason}</strong>
            </div>
          ) : null}

          <div className="admin-user-detail-layout">
            <section className="admin-user-section admin-user-section-main">
              <div className="admin-user-section-head">
                <h3>Profile information</h3>
                <p>Basic information submitted by the user.</p>
              </div>
              <div className="admin-user-info-grid">
                <div className="admin-user-info-item">
                  <span>Full name</span>
                  <strong>{item.fullName || 'Not provided'}</strong>
                </div>
                <div className="admin-user-info-item">
                  <span>Email</span>
                  <strong>{item.email || 'Not provided'}</strong>
                </div>
                <div className="admin-user-info-item">
                  <span>Role</span>
                  <strong>{roleLabel(item.role)}</strong>
                </div>
                <div className="admin-user-info-item">
                  <span>Gender</span>
                  <strong>{item.gender || 'Not provided'}</strong>
                </div>
                <div className="admin-user-info-item">
                  <span>Date of birth</span>
                  <strong>{formatBirthDate(item.dateOfBirth)}</strong>
                </div>
                <div className="admin-user-info-item">
                  <span>Contact number</span>
                  <strong>{item.contactNumber || 'Not provided'}</strong>
                </div>
                <div className="admin-user-info-item is-wide">
                  <span>Address</span>
                  <strong>{item.street || 'Not provided'}</strong>
                </div>
                <div className="admin-user-info-item is-wide">
                  <span>User ID</span>
                  <strong>{item.id}</strong>
                </div>
              </div>
            </section>

            <aside className="admin-user-side">
              <section className="admin-user-section">
                <div className="admin-user-section-head">
                  <h3>Account status</h3>
                  <p>{accountStatus.detail}</p>
                </div>
                <div className="admin-user-side-body">
                  <span className={`admin-user-status is-${accountStatus.tone}`}>
                    <span className="admin-user-status-dot" aria-hidden="true" />
                    {accountStatus.label}
                  </span>
                  {bannedUntilDate ? (
                    <div className="admin-user-compact-row">
                      <span>Ban end</span>
                      <strong>{bannedUntilDate.toLocaleString(undefined, { hour12: true })}</strong>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="admin-user-section">
                <div className="admin-user-section-head">
                  <h3>Identity document</h3>
                  <p>Uploaded verification document for review.</p>
                </div>
                <div className="admin-user-side-body">
                  {item.validIdURL ? (
                    <a className="admin-user-doc-card" href={item.validIdURL} target="_blank" rel="noreferrer">
                      <span>Valid ID</span>
                      <strong>View identity document</strong>
                    </a>
                  ) : (
                    <p className="admin-user-doc-empty">No identity document uploaded.</p>
                  )}
                </div>
              </section>

              <section className="admin-user-section">
                <div className="admin-user-section-head">
                  <h3>Record dates</h3>
                  <p>System timestamps for this profile.</p>
                </div>
                <div className="admin-user-side-body">
                  <div className="admin-user-compact-row">
                    <span>Created</span>
                    <strong>{toDateText(item.createdAt)}</strong>
                  </div>
                  <div className="admin-user-compact-row">
                    <span>Updated</span>
                    <strong>{toDateText(item.updatedAt)}</strong>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : !loading && !error ? (
        <p className="panel-sub">No user record selected.</p>
      ) : null}
    </section>
  )
}

export default AdminUserDetailPage

