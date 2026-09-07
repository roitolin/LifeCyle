import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, doc, getDocs, serverTimestamp, updateDoc } from '@/lib/supabaseDbCompat'
import { db } from '@/lib/supabaseAuth'
import { hasToDate, type TimestampLike } from '@/types/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { normalize, toDateText } from '@/pages/admin/adminHelpers'

type AbuseReport = {
  id: string
  reporterId?: string
  targetUserId?: string
  reporterName?: string | null
  targetName?: string | null
  requestId?: string | null
  conversationId?: string | null
  reason?: string
  details?: string
  evidenceURL?: string | null
  source?: string
  status?: string
  createdAt?: TimestampLike
}

type UserBlock = {
  id: string
  blockerId?: string
  blockedId?: string
  reason?: string
  active?: boolean
  createdAt?: TimestampLike
}

type UserRecord = {
  id: string
  fullName?: string
  email?: string
  role?: string
  contactNumber?: string
  photoURL?: string
  disabled?: boolean
}

type ServiceRecord = {
  id: string
  requesterId?: string
  status?: string
  createdAt?: TimestampLike
}

type RiskProfile = {
  userId: string
  score: number
  level: 'low' | 'medium' | 'high'
  reasons: string[]
  openReports: number
  activeBlocksAsBlocker: number
  activeBlocksAsTarget: number
  suspiciousRequests: number
}

function buildRiskProfiles(input: { reports: AbuseReport[]; blocks: UserBlock[]; services: ServiceRecord[]; users: UserRecord[] }) {
  const byUser = new Map<string, RiskProfile>()
  const usersById = new Map(input.users.map((item) => [item.id, item]))

  const ensure = (userId: string) => {
    const existing = byUser.get(userId)
    if (existing) return existing
    const created: RiskProfile = {
      userId,
      score: 0,
      level: 'low',
      reasons: [],
      openReports: 0,
      activeBlocksAsBlocker: 0,
      activeBlocksAsTarget: 0,
      suspiciousRequests: 0,
    }
    byUser.set(userId, created)
    return created
  }

  const pushReason = (profile: RiskProfile, reason: string) => {
    if (!profile.reasons.includes(reason)) profile.reasons.push(reason)
  }

  input.reports.forEach((report) => {
    const userId = String(report.targetUserId || '').trim()
    if (!userId) return
    const profile = ensure(userId)
    const status = normalize(report.status || 'open')
    const reason = normalize(report.reason)

    if (status === 'open') {
      profile.score += 20
      profile.openReports += 1
      pushReason(profile, 'Open abuse reports')
    } else if (status === 'reviewing') {
      profile.score += 12
      pushReason(profile, 'Reports under review')
    } else if (status === 'resolved') {
      profile.score += 4
      pushReason(profile, 'Previously resolved reports')
    }

    if (reason.includes('fake')) {
      profile.score += 8
      pushReason(profile, 'Fake information reports')
    }
    if (reason.includes('spam')) {
      profile.score += 6
      pushReason(profile, 'Spam behavior reports')
    }
  })

  input.blocks.forEach((item) => {
    if (item.active === false) return
    const blockerId = String(item.blockerId || '').trim()
    const blockedId = String(item.blockedId || '').trim()

    if (blockerId) {
      const profile = ensure(blockerId)
      profile.activeBlocksAsBlocker += 1
      if (profile.activeBlocksAsBlocker >= 3) {
        profile.score += 10
        pushReason(profile, 'Repeatedly blocks many users')
      } else {
        profile.score += 3
      }
    }

    if (blockedId) {
      const profile = ensure(blockedId)
      profile.activeBlocksAsTarget += 1
      profile.score += 7
      pushReason(profile, 'Frequently blocked by others')
    }
  })

  const now = Date.now()
  input.services.forEach((item) => {
    const requesterId = String(item.requesterId || '').trim()
    if (!requesterId) return

    const createdAtMillis =
      hasToDate(item.createdAt)
        ? item.createdAt.toDate().getTime()
        : item.createdAt instanceof Date || typeof item.createdAt === 'string' || typeof item.createdAt === 'number'
          ? new Date(item.createdAt).getTime()
          : 0

    const isRecent = createdAtMillis > 0 && now - createdAtMillis <= 48 * 60 * 60 * 1000
    if (!isRecent) return

    const profile = ensure(requesterId)
    if (normalize(item.status).includes('pending')) {
      profile.suspiciousRequests += 1
    }
  })

  byUser.forEach((profile, userId) => {
    if (profile.suspiciousRequests >= 3) {
      profile.score += 18
      pushReason(profile, 'Multiple pending service records in short time')
    } else if (profile.suspiciousRequests >= 2) {
      profile.score += 10
      pushReason(profile, 'Frequent pending service records')
    }

    const user = usersById.get(userId)
    if (user) {
      const missingIdentityFields = [user.fullName, user.contactNumber].filter((value) => !String(value || '').trim()).length
      if (missingIdentityFields >= 2) {
        profile.score += 8
        pushReason(profile, 'Profile missing core identity fields')
      }
      if (user.disabled) {
        profile.score += 12
        pushReason(profile, 'Account has been disabled by admin')
      }
    }

    profile.score = Math.max(0, Math.min(100, Math.round(profile.score)))
    profile.level = profile.score >= 70 ? 'high' : profile.score >= 40 ? 'medium' : 'low'
  })

  return Array.from(byUser.values()).sort((a, b) => b.score - a.score)
}

function AdminModerationPage() {
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [mode, setMode] = useState<'reports' | 'blocks' | 'risk'>('reports')
  const [reports, setReports] = useState<AbuseReport[]>([])
  const [blocks, setBlocks] = useState<UserBlock[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [services, setServices] = useState<ServiceRecord[]>([])
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    try {
      const [reportsSnap, blocksSnap, usersSnap, servicesSnap] = await Promise.all([
        getDocs(collection(db, 'abuse_reports')),
        getDocs(collection(db, 'user_blocks')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'funeral_service_requests')),
      ])

      const reportItems = reportsSnap.docs.map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<AbuseReport, 'id'>) }))
      const blockItems = blocksSnap.docs.map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<UserBlock, 'id'>) }))
      const userItems = usersSnap.docs.map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<UserRecord, 'id'>) }))
      const serviceItems = servicesSnap.docs.map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<ServiceRecord, 'id'>) }))

      reportItems.sort((a: any, b: any) => new Date(toDateText(b.createdAt)).getTime() - new Date(toDateText(a.createdAt)).getTime())
      blockItems.sort((a: any, b: any) => new Date(toDateText(b.createdAt)).getTime() - new Date(toDateText(a.createdAt)).getTime())

      setReports(reportItems)
      setBlocks(blockItems)
      setUsers(userItems)
      setServices(serviceItems)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const setReportStatus = async (reportId: string, status: 'reviewing' | 'resolved' | 'dismissed') => {
    setSavingId(reportId)
    try {
      await updateDoc(doc(db, 'abuse_reports', reportId), {
        status,
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
      })
      await load()
    } finally {
      setSavingId('')
    }
  }

  const deactivateBlock = async (blockId: string) => {
    setSavingId(blockId)
    try {
      await updateDoc(doc(db, 'user_blocks', blockId), {
        active: false,
        updatedAt: serverTimestamp(),
        deactivatedAt: serverTimestamp(),
      })
      await load()
    } finally {
      setSavingId('')
    }
  }

  const confirmSetReportStatus = (reportId: string, status: 'reviewing' | 'resolved' | 'dismissed') => {
    const actionText =
      status === 'reviewing'
        ? 'mark this report as under review'
        : status === 'resolved'
          ? 'resolve this report'
          : 'dismiss this report'
    openConfirm({
      title: status === 'reviewing' ? 'Start Review' : status === 'resolved' ? 'Resolve Report' : 'Dismiss Report',
      message: `Are you sure you want to ${actionText}?`,
      details:
        status === 'reviewing'
          ? ['The report will be set to Reviewing while you investigate it.']
          : status === 'resolved'
            ? ['The report will be marked as Resolved and closed.']
            : ['The report will be marked as Dismissed and closed.'],
      tone: status === 'reviewing' ? 'primary' : 'warning',
      confirmLabel: status === 'reviewing' ? 'Start Review' : status === 'resolved' ? 'Resolve' : 'Dismiss',
      onConfirm: () => void setReportStatus(reportId, status),
    })
  }

  const confirmDeactivateBlock = (blockId: string) => {
    openConfirm({
      title: 'Deactivate Block',
      message: 'Deactivate this block record? The user will no longer be counted as blocked.',
      confirmLabel: 'Deactivate',
      cancelLabel: 'Cancel',
      tone: 'warning',
      onConfirm: () => void deactivateBlock(blockId),
    })
  }

  const riskProfiles = useMemo(() => buildRiskProfiles({ reports, blocks, users, services }), [reports, blocks, users, services])
  const openReports = useMemo(
    () => reports.filter((item) => !['resolved', 'dismissed'].includes(normalize(item.status))).length,
    [reports],
  )

  const activeBlocks = useMemo(() => blocks.filter((item) => item.active !== false).length, [blocks])
  const highRiskCount = useMemo(() => riskProfiles.filter((item) => item.level === 'high').length, [riskProfiles])

  return (
    <section className="panel">
      <h2>Moderation Queue</h2>
      <p className="panel-sub">Reports, block records, and risk scoring for suspicious users.</p>

      <div className="stats-grid">
        <article className="stat-card"><strong>{openReports}</strong><span>Open Reports</span></article>
        <article className="stat-card"><strong>{activeBlocks}</strong><span>Active Blocks</span></article>
        <article className="stat-card"><strong>{highRiskCount}</strong><span>High Risk Users</span></article>
        <article className="stat-card"><strong>{reports.length}</strong><span>Total Reports</span></article>
      </div>

      <div className="quick-actions">
        <button type="button" className={`ghost-btn${mode === 'reports' ? ' active' : ''}`} onClick={() => setMode('reports')}>Reports</button>
        <button type="button" className={`ghost-btn${mode === 'blocks' ? ' active' : ''}`} onClick={() => setMode('blocks')}>Blocks</button>
        <button type="button" className={`ghost-btn${mode === 'risk' ? ' active' : ''}`} onClick={() => setMode('risk')}>Risk Scoring</button>
      </div>

      {loading ? <p className="panel-sub">Loading moderation data...</p> : null}

      {mode === 'reports' ? (
        <>
          <h3 className="moderation-section-heading">Abuse Reports</h3>
          {reports.length === 0 ? <p className="panel-sub">No abuse reports found.</p> : null}
          <div className="notification-list">
            {reports.map((item) => (
              <article key={item.id} className="notification-item">
                <h3>{item.reason || 'Report'} | {(item.status || 'open').toUpperCase()}</h3>
                <p>
                  Reporter: {item.reporterName || item.reporterId || '-'} | Target: {item.targetName || item.targetUserId || '-'}
                </p>
                {item.details ? <p>{item.details}</p> : null}
                <span>
                  Source: {item.source || 'app'} | Request: {item.requestId || '-'} | Conversation: {item.conversationId || '-'} | {toDateText(item.createdAt)}
                </span>
                <div className="request-actions section-actions">
                  {item.reporterId ? <Link to={`/admin/users/${item.reporterId}`} className="ghost-btn btn-link table-action">Reporter</Link> : null}
                  {item.targetUserId ? <Link to={`/admin/users/${item.targetUserId}`} className="ghost-btn btn-link table-action">Target</Link> : null}
                  {item.evidenceURL ? (
                    <a className="ghost-btn btn-link table-action" href={item.evidenceURL} target="_blank" rel="noreferrer">
                      Open Full Evidence
                    </a>
                  ) : (
                    <button type="button" className="ghost-btn table-action" disabled>
                      Open Full Evidence
                    </button>
                  )}
                  <button type="button" className="ghost-btn table-action" disabled={savingId === item.id} onClick={() => confirmSetReportStatus(item.id, 'reviewing')}>
                    Reviewing
                  </button>
                  <button type="button" className="ghost-btn table-action" disabled={savingId === item.id} onClick={() => confirmSetReportStatus(item.id, 'resolved')}>
                    Resolve
                  </button>
                  <button type="button" className="ghost-btn table-action" disabled={savingId === item.id} onClick={() => confirmSetReportStatus(item.id, 'dismissed')}>
                    Dismiss
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {mode === 'blocks' ? (
        <>
          <h3 className="moderation-section-heading">User Block Records</h3>
          {blocks.length === 0 ? <p className="panel-sub">No block records found.</p> : null}
          <div className="table-wrap">
            <table className="request-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Blocker</th>
                  <th>Blocked User</th>
                  <th>Reason</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((item) => {
                  const active = item.active !== false
                  return (
                    <tr key={item.id}>
                      <td>{active ? 'active' : 'inactive'}</td>
                      <td>{item.blockerId || '-'}</td>
                      <td>{item.blockedId || '-'}</td>
                      <td>{item.reason || '-'}</td>
                      <td>{toDateText(item.createdAt)}</td>
                      <td>
                        <div className="request-actions">
                          {item.blockerId ? <Link to={`/admin/users/${item.blockerId}`} className="ghost-btn btn-link table-action">Blocker</Link> : null}
                          {item.blockedId ? <Link to={`/admin/users/${item.blockedId}`} className="ghost-btn btn-link table-action">Blocked</Link> : null}
                          {active ? (
                            <button type="button" className="ghost-btn table-action" disabled={savingId === item.id} onClick={() => confirmDeactivateBlock(item.id)}>
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {mode === 'risk' ? (
        <>
          <h3 className="moderation-section-heading">Risk Scoring</h3>
          {riskProfiles.length === 0 ? <p className="panel-sub">No risk signals found.</p> : null}
          <div className="notification-list">
            {riskProfiles.map((item) => (
              <article key={item.userId} className="notification-item">
                <h3>
                  User {item.userId} | {item.level.toUpperCase()} ({item.score})
                </h3>
                <p>
                  Open Reports: {item.openReports} | Active Blocks As Target: {item.activeBlocksAsTarget} | Active Blocks As Blocker: {item.activeBlocksAsBlocker}
                </p>
                <p>Suspicious Service Records: {item.suspiciousRequests}</p>
                <p>Signals: {item.reasons.length > 0 ? item.reasons.join(' | ') : 'none'}</p>
                <div className="request-actions section-actions">
                  <Link to={`/admin/users/${item.userId}`} className="ghost-btn btn-link table-action">User Details</Link>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {confirmDialog}
    </section>
  )
}

export default AdminModerationPage

