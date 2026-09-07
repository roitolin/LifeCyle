import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import './AdminOperations.css'

type DeletionStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'completed'

type DeletionRequest = {
  id: string
  user_id: string | null
  email_snapshot: string
  status: DeletionStatus
  reason: string
  admin_note: string | null
  requested_at: string
  updated_at: string
  resolved_at: string | null
  resolved_by: string | null
}

type QueueFilter = 'open' | 'resolved' | 'all'

const OPEN_STATUSES: DeletionStatus[] = ['pending', 'in_review', 'approved']

function statusLabel(status: DeletionStatus) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { hour12: true })
}

export default function AdminAccountDeletionsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [requests, setRequests] = useState<DeletionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<QueueFilter>('open')
  const [query, setQuery] = useState('')
  const [rejecting, setRejecting] = useState<DeletionRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await supabase
        .from('account_deletion_requests')
        .select('*')
        .order('requested_at', { ascending: false })
      if (loadError) throw loadError
      setRequests((data || []) as DeletionRequest[])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load account deletion requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCount = requests.filter((request) => OPEN_STATUSES.includes(request.status)).length
  const approvedCount = requests.filter((request) => request.status === 'approved').length
  const completedCount = requests.filter((request) => request.status === 'completed').length

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return requests.filter((request) => {
      const isOpen = OPEN_STATUSES.includes(request.status)
      if (filter === 'open' && !isOpen) return false
      if (filter === 'resolved' && isOpen) return false
      if (!normalizedQuery) return true
      return `${request.email_snapshot} ${request.reason} ${request.admin_note || ''}`.toLowerCase().includes(normalizedQuery)
    })
  }, [filter, query, requests])

  const updateStatus = async (
    request: DeletionRequest,
    status: 'in_review' | 'approved' | 'rejected',
    adminNote?: string,
  ) => {
    if (updatingId) return
    setUpdatingId(request.id)
    setError('')
    try {
      const { data, error: updateError } = await supabase
        .from('account_deletion_requests')
        .update({ status, admin_note: adminNote?.trim() || null })
        .eq('id', request.id)
        .eq('status', request.status)
        .select('*')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('Another administrator already changed this request.')
      setRequests((current) => current.map((item) => item.id === request.id ? data as DeletionRequest : item))
      setRejecting(null)
      setRejectReason('')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update this request.')
    } finally {
      setUpdatingId('')
    }
  }

  const approve = (request: DeletionRequest) => {
    openConfirm({
      title: 'Approve this deletion request?',
      message: `Approve the verified request from ${request.email_snapshot}? This does not delete the account yet.`,
      details: ['The account remains active until permanent deletion is run.', 'Active services, refunds, and pending shop payments will block permanent deletion.'],
      tone: 'warning',
      confirmLabel: 'Approve request',
      onConfirm: () => updateStatus(request, 'approved'),
    })
  }

  const permanentlyDelete = (request: DeletionRequest) => {
    openConfirm({
      title: 'Permanently delete this account?',
      message: `Delete ${request.email_snapshot}? This action cannot be undone.`,
      details: ['The server checks for active services, unresolved refunds, and pending payments first.', 'The authentication account and eligible profile data will be removed.'],
      tone: 'danger',
      confirmLabel: 'Delete permanently',
      onConfirm: async () => {
        setUpdatingId(request.id)
        try {
          const { data, error: deleteError } = await supabase.functions.invoke('account-deletion', {
            body: { deletionRequestId: request.id },
          })
          if (deleteError) throw deleteError
          if (data?.error) throw new Error(data.error)
          await load()
          openAlert({ title: 'Account Deleted', message: `${request.email_snapshot} was permanently removed.`, tone: 'info', okLabel: 'Done' })
        } catch (deleteError) {
          openAlert({
            title: 'Deletion Blocked',
            message: deleteError instanceof Error ? deleteError.message : 'The account could not be deleted.',
            details: ['Resolve active services, refunds, and pending shop payments before trying again.'],
            tone: 'danger',
          })
        } finally {
          setUpdatingId('')
        }
      },
    })
  }

  const submitRejection = async () => {
    if (!rejecting || rejectReason.trim().length < 3) return
    await updateStatus(rejecting, 'rejected', rejectReason)
  }

  return (
    <section className="panel operations-page deletions-page">
      <header className="operations-page-header">
        <div>
          <h2>Account deletion requests</h2>
          <p className="panel-sub">Review verified requests and delete eligible accounts.</p>
        </div>
        <button className="operations-secondary-btn" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <div className="operations-metrics three-up" aria-label="Deletion request summary">
        <article><span>Open requests</span><strong>{openCount}</strong><small>Pending, reviewing, or approved</small></article>
        <article className={approvedCount ? 'is-urgent' : ''}><span>Ready for deletion</span><strong>{approvedCount}</strong><small>Approved and awaiting execution</small></article>
        <article><span>Completed</span><strong>{completedCount}</strong><small>Permanently processed</small></article>
      </div>

      <div className="operations-toolbar">
        <div className="operations-filter-tabs" role="tablist" aria-label="Deletion queue status">
          <button type="button" className={filter === 'open' ? 'is-active' : ''} onClick={() => setFilter('open')}>Open <span>{openCount}</span></button>
          <button type="button" className={filter === 'resolved' ? 'is-active' : ''} onClick={() => setFilter('resolved')}>Resolved</button>
          <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All <span>{requests.length}</span></button>
        </div>
        <label className="operations-search"><span className="sr-only">Search deletion requests</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email or reason" /></label>
      </div>

      {error ? <p className="auth-message auth-message-error">{error}</p> : null}
      {loading ? <div className="operations-state">Loading deletion requests...</div> : null}
      {!loading && visible.length === 0 ? <div className="operations-empty"><h3>No requests in this view</h3><p>New account deletion requests will appear here.</p></div> : null}

      <div className="deletion-list">
        {visible.map((request) => {
          const busy = updatingId === request.id
          return (
            <article className="deletion-card" key={request.id}>
              <header>
                <div>
                  <h3>{request.email_snapshot}</h3>
                  <p>Requested {formatDate(request.requested_at)}</p>
                </div>
                <span className={`operations-status is-${request.status}`}>{statusLabel(request.status)}</span>
              </header>
              <div className="deletion-reason"><span>User reason</span><p>{request.reason}</p></div>
              {request.admin_note ? <div className="deletion-admin-note"><span>Administrator note</span><p>{request.admin_note}</p></div> : null}
              <footer>
                <span>Last updated {formatDate(request.updated_at)}</span>
                <div className="operations-card-actions">
                  {request.status === 'pending' ? <button type="button" className="is-secondary" disabled={busy} onClick={() => void updateStatus(request, 'in_review')}>Start review</button> : null}
                  {request.status === 'pending' || request.status === 'in_review' ? <button type="button" className="is-success" disabled={busy} onClick={() => approve(request)}>Approve</button> : null}
                  {request.status === 'pending' || request.status === 'in_review' ? <button type="button" className="is-danger" disabled={busy} onClick={() => { setRejecting(request); setRejectReason('') }}>Reject</button> : null}
                  {request.status === 'approved' ? <button type="button" className="is-danger-solid" disabled={busy} onClick={() => permanentlyDelete(request)}>{busy ? 'Checking...' : 'Delete permanently'}</button> : null}
                </div>
              </footer>
            </article>
          )
        })}
      </div>

      {rejecting ? (
        <div className="operations-modal-overlay" role="presentation" onClick={() => setRejecting(null)}>
          <form className="operations-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submitRejection() }}>
            <h3>Reject deletion request</h3>
            <p>Give {rejecting.email_snapshot} a clear explanation for this decision.</p>
            <label className="operations-field"><span>Rejection explanation</span><textarea rows={5} maxLength={500} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} autoFocus /></label>
            <div className="operations-modal-actions">
              <button type="button" className="operations-secondary-btn" onClick={() => setRejecting(null)} disabled={Boolean(updatingId)}>Cancel</button>
              <button type="submit" className="operations-danger-btn" disabled={rejectReason.trim().length < 3 || Boolean(updatingId)}>{updatingId ? 'Saving...' : 'Reject request'}</button>
            </div>
          </form>
        </div>
      ) : null}
      {alertDialog}
      {confirmDialog}
    </section>
  )
}
