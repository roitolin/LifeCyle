import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc, setDoc, serverTimestamp } from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'
import type { TimestampLike } from '@/types/supabase'
import { getConversationId, toDateText } from '@/pages/admin/adminHelpers'

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
  createdAt?: TimestampLike
}

function AdminUserDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [item, setItem] = useState<UserDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
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
    if (!item?.id) return
    const adminId = auth.currentUser?.uid
    if (!adminId) return
    const conversationId = getConversationId(adminId, item.id)
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
  }

  return (
    <section className="panel">
      <div className="quick-actions">
        <button type="button" className="ghost-btn" onClick={() => navigate('/admin/users')}>
          Back to Users
        </button>
      </div>

      <h2>User Details</h2>
      <p className="panel-sub">View full user profile and support contact options.</p>

      {loading ? <p className="panel-sub">Loading user details...</p> : null}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}

      {item ? (
        <>
          <div className="request-detail-grid">
            <div>
              <span>Name</span>
              <strong>{item.fullName || '-'}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong>{item.email || '-'}</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>{item.role || 'user'}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{item.disabled ? 'Disabled' : 'Active'}</strong>
            </div>
            <div>
              <span>Contact</span>
              <strong>{item.contactNumber || '-'}</strong>
            </div>
            <div>
              <span>Gender</span>
              <strong>{item.gender || '-'}</strong>
            </div>
            <div>
              <span>Date Of Birth</span>
              <strong>{item.dateOfBirth || '-'}</strong>
            </div>
            <div>
              <span>Created At</span>
              <strong>{toDateText(item.createdAt)}</strong>
            </div>
            <div>
              <span>Location</span>
              <strong>{item.street || '-'}</strong>
            </div>
          </div>

          {item.validIdURL ? (
            <div className="quick-actions">
              {item.validIdURL ? (
                <a className="ghost-btn btn-link" href={item.validIdURL} target="_blank" rel="noreferrer">
                  Open Valid ID
                </a>
              ) : null}
            </div>
          ) : null}

          <div className="quick-actions">
            <button type="button" className="solid-btn" onClick={() => void startConversation()}>Chat</button>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default AdminUserDetailPage

