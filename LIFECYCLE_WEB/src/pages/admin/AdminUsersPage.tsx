import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, deleteDoc, doc, getDoc, getDocs, Timestamp, updateDoc, setDoc, serverTimestamp } from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getConversationId, normalize } from './adminHelpers'
import './AdminUsersPage.css'

type UserItem = {
  id: string
  fullName?: string
  email?: string
  role?: string
  contactNumber?: string
  disabled?: boolean
  banReason?: string | null
  bannedUntil?: { toDate?: () => Date } | string | null
}

type UserStatusFilter = 'all' | 'active' | 'banned' | 'disabled'

type UserAccountStatus = {
  group: Exclude<UserStatusFilter, 'all'>
  label: string
  tone: 'active' | 'warning' | 'danger' | 'muted'
  detail: string | null
}

const resolveDate = (value: UserItem['bannedUntil']) => {
  if (!value) return null
  if (typeof value === 'object' && value !== null && 'toDate' in value) return value.toDate?.() || null
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getAccountStatus = (item: UserItem): UserAccountStatus => {
  const bannedUntil = resolveDate(item.bannedUntil)

  if (!item.disabled) {
    return { group: 'active', label: 'Active', tone: 'active', detail: 'Account access enabled' }
  }

  if (bannedUntil && bannedUntil.getTime() > Date.now()) {
    return {
      group: 'banned',
      label: 'Temporarily banned',
      tone: 'danger',
      detail: `Until ${bannedUntil.toLocaleString(undefined, { hour12: true })}`,
    }
  }

  if (bannedUntil) {
    return {
      group: 'disabled',
      label: 'Ban expired',
      tone: 'warning',
      detail: `Expired ${bannedUntil.toLocaleString(undefined, { hour12: true })}`,
    }
  }

  if (item.banReason) {
    return { group: 'banned', label: 'Permanently banned', tone: 'danger', detail: 'No end date' }
  }

  return { group: 'disabled', label: 'Disabled', tone: 'muted', detail: 'Account access disabled' }
}

function AdminUsersPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [items, setItems] = useState<UserItem[]>([])
  const [viewerRole, setViewerRole] = useState('user')
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all')
  const [banTarget, setBanTarget] = useState<UserItem | null>(null)
  const [banReasonInput, setBanReasonInput] = useState('')
  const [banDaysInput, setBanDaysInput] = useState('7')
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    try {
      const currentUser = auth.currentUser
      let nextViewerRole = 'user'
      if (currentUser) {
        const viewerSnap = await getDoc(doc(db, 'users', currentUser.uid))
        nextViewerRole = normalize(viewerSnap.data()?.role || 'user')
      }

      const snapshot = await getDocs(collection(db, 'users'))
      const list = snapshot.docs
        .map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<UserItem, 'id'>) }))
        .filter((item: any) => nextViewerRole === 'super_admin' || !normalize(item.role).includes('admin'))
      setViewerRole(nextViewerRole)
      setItems(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const statusCounts = useMemo(() => items.reduce(
    (counts, item) => {
      counts[getAccountStatus(item).group] += 1
      return counts
    },
    { active: 0, banned: 0, disabled: 0 },
  ), [items])

  const filtered = useMemo(() => {
    const q = normalize(queryText)
    return items.filter((item) => {
      const matchesSearch = !q
        || [item.fullName, item.email, item.contactNumber].some((value) => normalize(value).includes(q))
      const matchesStatus = statusFilter === 'all' || getAccountStatus(item).group === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [items, queryText, statusFilter])

  const isBanned = (item: UserItem) => getAccountStatus(item).group === 'banned'

  const openBanModal = (item: UserItem) => {
    setBanTarget(item)
    setBanReasonInput(item.banReason || '')
    setBanDaysInput('7')
  }

  const closeBanModal = () => {
    setBanTarget(null)
    setBanReasonInput('')
    setBanDaysInput('7')
  }

  const applyBan = async () => {
    if (!banTarget) return
    const days = Number(banDaysInput)
    const reason = banReasonInput.trim()
    if (!reason || !Number.isFinite(days) || days <= 0) return

    const target = banTarget
    const bannedUntilDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    closeBanModal()
    openConfirm({
      title: 'Ban this account?',
      message: `You are about to ban ${target.email || target.fullName || 'this user'}.`,
      details: [
        `Duration: ${days} day(s)`,
        `Ban ends: ${bannedUntilDate.toLocaleString(undefined, { hour12: true })}`,
        `Reason: ${reason}`,
      ],
      tone: 'danger',
      confirmLabel: 'Apply Ban',
      onConfirm: async () => {
        setSavingId(target.id)
        try {
          await updateDoc(doc(db, 'users', target.id), {
            disabled: true,
            banReason: reason,
            bannedAt: new Date(),
            bannedBy: auth.currentUser?.uid || null,
            bannedUntil: Timestamp.fromDate(bannedUntilDate),
          })
          await load()
        } finally {
          setSavingId('')
        }
      },
    })
  }

  const unbanUser = async (item: UserItem) => {
    openConfirm({
      title: 'Remove this ban?',
      message: `This will restore access for ${item.email || item.fullName || 'this user'}.`,
      tone: 'warning',
      confirmLabel: 'Unban User',
      onConfirm: async () => {
        setSavingId(item.id)
        try {
          await updateDoc(doc(db, 'users', item.id), {
            disabled: false,
            banReason: null,
            bannedBy: null,
            bannedAt: null,
            bannedUntil: null,
          })
          await load()
        } finally {
          setSavingId('')
        }
      },
    })
  }

  const deleteUser = async (item: UserItem) => {
    openConfirm({
      title: 'Delete this account record?',
      message: `This will remove the Supabase profile for ${item.email || item.fullName || 'this user'}.`,
      details: ['Authentication credentials are not removed by this action.'],
      tone: 'danger',
      confirmLabel: 'Delete User',
      onConfirm: async () => {
        setSavingId(item.id)
        try {
          await deleteDoc(doc(db, 'users', item.id))
          await load()
        } finally {
          setSavingId('')
        }
      },
    })
  }

  const openChat = async (item: UserItem) => {
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
      <h2>User Management</h2>
      <p className="panel-sub">
        {viewerRole === 'super_admin'
          ? 'Manage funeral users, funeral shops, and admin accounts directly.'
          : 'Manage user status and contact users directly.'}
      </p>

      {viewerRole === 'super_admin' ? (
        <div className="user-status-summary" aria-label="User account status summary">
          {([
            ['all', 'All users', items.length],
            ['active', 'Active', statusCounts.active],
            ['banned', 'Banned', statusCounts.banned],
            ['disabled', 'Disabled', statusCounts.disabled],
          ] as const).map(([value, label, count]) => (
            <button
              type="button"
              key={value}
              className={statusFilter === value ? 'user-status-card is-selected' : 'user-status-card'}
              onClick={() => setStatusFilter(value)}
              aria-pressed={statusFilter === value}
            >
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          ))}
        </div>
      ) : null}

      <div className="admin-filters admin-filters-advanced">
        <div>
          <label htmlFor="admin-user-search">Search User</label>
          <input
            id="admin-user-search"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="Name, email, or phone"
          />
        </div>
        <div>
          <label htmlFor="admin-user-status">Account Status</label>
          <select
            id="admin-user-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as UserStatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="disabled">Disabled or expired</option>
          </select>
        </div>
        <button
          type="button"
          className="ghost-btn user-filter-reset"
          onClick={() => {
            setQueryText('')
            setStatusFilter('all')
          }}
          disabled={!queryText && statusFilter === 'all'}
        >
          Clear filters
        </button>
      </div>

      {loading ? <p className="panel-sub">Loading users...</p> : null}
      {!loading && filtered.length === 0 ? <p className="panel-sub">No users found.</p> : null}

      <div className="table-wrap">
        <table className="request-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const busy = savingId === item.id
              const banned = isBanned(item)
              const accountStatus = getAccountStatus(item)
              return (
                <tr key={item.id}>
                  <td>{item.fullName || '-'}</td>
                  <td>{item.email || '-'}</td>
                  <td>{item.role || 'user'}</td>
                  <td>
                    <div className="user-account-status-cell">
                      <span className={`user-account-status is-${accountStatus.tone}`}>
                        <span className="user-account-status-dot" aria-hidden="true" />
                        {accountStatus.label}
                      </span>
                      {accountStatus.detail ? <small>{accountStatus.detail}</small> : null}
                      {item.banReason ? (
                        <small className="user-ban-reason" title={item.banReason}>Reason: {item.banReason}</small>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <div className="request-actions">
                      <Link to={`/admin/users/${item.id}`} className="ghost-btn btn-link table-action">View</Link>
                      <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void openChat(item)}>
                        Chat
                      </button>
                      {banned ? (
                        <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void unbanUser(item)}>
                          Unban
                        </button>
                      ) : (
                        <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => openBanModal(item)}>
                          Ban
                        </button>
                      )}
                      <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void deleteUser(item)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {banTarget ? (
        <div className="ban-overlay" role="dialog" aria-modal="true" aria-label="Ban user">
          <div className="ban-card">
            <h2>Ban User</h2>
            <p>{banTarget.email || banTarget.fullName || 'Selected user'}</p>
            <label htmlFor="ban-reason">Reason</label>
            <textarea
              id="ban-reason"
              className="app-textarea"
              value={banReasonInput}
              onChange={(event) => setBanReasonInput(event.target.value)}
              placeholder="Explain why this user is being banned."
            />
            <label htmlFor="ban-days">Duration (days)</label>
            <input id="ban-days" value={banDaysInput} onChange={(event) => setBanDaysInput(event.target.value)} />
            <div className="ban-actions">
              <button type="button" className="ghost-btn" onClick={closeBanModal}>Cancel</button>
              <button type="button" className="solid-btn" onClick={() => void applyBan()} disabled={savingId === banTarget.id}>Apply Ban</button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  )
}

export default AdminUsersPage

