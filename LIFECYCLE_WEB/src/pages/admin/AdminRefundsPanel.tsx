import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'
import './AdminOperations.css'

type RefundStatus = 'pending' | 'approved' | 'rejected' | 'refunded' | 'cancelled'

type RefundRequest = {
  id: string
  serviceRequestId: string
  status: RefundStatus
  reason: string
  responseNote: string | null
  refundReference: string | null
  requestedAt: string
  requesterName: string
  requesterEmail: string
  shopName: string
  deceasedFullName: string
  paymentAmount: number
  serviceStatus: string
  shopMarkedCompletedAt: string | null
  completedAt: string | null
  completionProofImageUrl: string | null
  isDelivered: boolean
}

type RefundFilter = 'open' | 'history' | 'all'
type RefundDialog = { mode: 'reject' | 'sent'; refund: RefundRequest }

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value || 0))
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { hour12: true })
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function AdminRefundsPanel() {
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [refunds, setRefunds] = useState<RefundRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<RefundFilter>('open')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<RefundDialog | null>(null)
  const [dialogText, setDialogText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: refundError } = await supabase
        .from('service_refund_requests')
        .select('*')
        .order('requested_at', { ascending: false })
      if (refundError) throw refundError

      const rawRefunds = data || []
      const requesterIds = [...new Set(rawRefunds.map((row: any) => String(row.requester_id || '')).filter(Boolean))]
      const serviceIds = [...new Set(rawRefunds.map((row: any) => String(row.service_request_id || '')).filter(Boolean))]
      const [usersResult, servicesResult] = await Promise.all([
        requesterIds.length
          ? supabase.from('users').select('id, fullName, email').in('id', requesterIds)
          : Promise.resolve({ data: [], error: null }),
        serviceIds.length
          ? supabase.from('funeral_service_requests').select('id, shopName, deceasedFullName, paymentAmount, status, shopMarkedCompletedAt, completedAt, completionProofImageUrl').in('id', serviceIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (usersResult.error) throw usersResult.error
      if (servicesResult.error) throw servicesResult.error

      const users = new Map((usersResult.data || []).map((row: any) => [row.id, row]))
      const services = new Map((servicesResult.data || []).map((row: any) => [row.id, row]))
      setRefunds(rawRefunds.map((row: any) => {
        const requester: any = users.get(row.requester_id)
        const service: any = services.get(row.service_request_id)
        const serviceStatus = String(service?.status || '').toLowerCase()
        const isDelivered = serviceStatus === 'completed' || Boolean(service?.shopMarkedCompletedAt)
        return {
          id: row.id,
          serviceRequestId: row.service_request_id,
          status: row.status,
          reason: row.reason || '',
          responseNote: row.response_note || null,
          refundReference: row.refund_reference_number || null,
          requestedAt: row.requested_at || '',
          requesterName: requester?.fullName || '',
          requesterEmail: requester?.email || '',
          shopName: service?.shopName || '',
          deceasedFullName: service?.deceasedFullName || '',
          paymentAmount: Number(service?.paymentAmount || 0),
          serviceStatus,
          shopMarkedCompletedAt: service?.shopMarkedCompletedAt || null,
          completedAt: service?.completedAt || null,
          completionProofImageUrl: service?.completionProofImageUrl || null,
          isDelivered,
        }
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load refund requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openRefunds = refunds.filter((refund) => refund.status === 'pending' || refund.status === 'approved')
  const approvedCount = refunds.filter((refund) => refund.status === 'approved').length
  const refundedCount = refunds.filter((refund) => refund.status === 'refunded').length

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return refunds.filter((refund) => {
      const isOpen = refund.status === 'pending' || refund.status === 'approved'
      if (filter === 'open' && !isOpen) return false
      if (filter === 'history' && isOpen) return false
      if (!normalizedQuery) return true
      return `${refund.requesterName} ${refund.requesterEmail} ${refund.shopName} ${refund.deceasedFullName} ${refund.reason}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [filter, query, refunds])

  const updateRefund = async (refund: RefundRequest, status: 'approved' | 'rejected' | 'refunded', text?: string) => {
    if (updatingId) return
    if ((status === 'approved' || status === 'refunded') && !refund.isDelivered) {
      setError('Policy restriction: Refunds can only be approved and issued after complete delivery of the service.')
      return
    }
    setUpdatingId(refund.id)
    setError('')
    try {
      const changes = status === 'rejected'
        ? { status, response_note: text?.trim() || null }
        : status === 'refunded'
          ? { status, refund_reference_number: text?.trim() || null }
          : { status }
      const { data, error: updateError } = await supabase
        .from('service_refund_requests')
        .update(changes)
        .eq('id', refund.id)
        .eq('status', refund.status)
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('Another administrator already changed this refund request.')
      setDialog(null)
      setDialogText('')
      await load()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update this refund request.')
    } finally {
      setUpdatingId('')
    }
  }

  const approveRefund = (refund: RefundRequest) => {
    if (!refund.isDelivered) {
      openConfirm({
        title: 'Complete Delivery Required',
        message: `Refund cannot be approved yet for ${refund.requesterName || 'this family'}. Refunds can only be made after complete delivery.`,
        details: [
          'The assigned shop has not marked this arrangement as delivered with completion proof.',
          'Platform policy requires the service to be delivered or completed before refund processing.'
        ],
        tone: 'danger',
        confirmLabel: 'Understood',
        cancelLabel: '',
        onConfirm: () => {},
      })
      return
    }
    openConfirm({
      title: 'Approve this refund request?',
      message: `Approve the refund requested by ${refund.requesterName || refund.requesterEmail || 'this family'}?`,
      details: ['The original payment record remains unchanged.', 'A transaction reference is required after the refund is sent.'],
      tone: 'warning',
      confirmLabel: 'Approve refund',
      onConfirm: () => updateRefund(refund, 'approved'),
    })
  }

  const submitDialog = async () => {
    if (!dialog) return
    await updateRefund(dialog.refund, dialog.mode === 'sent' ? 'refunded' : 'rejected', dialogText)
  }

  const exportRefunds = () => {
    const csv = buildCsv(visible, [
      { header: 'Refund ID', value: (row) => row.id },
      { header: 'Service Request ID', value: (row) => row.serviceRequestId },
      { header: 'Requester', value: (row) => row.requesterName || row.requesterEmail },
      { header: 'Shop', value: (row) => row.shopName },
      { header: 'Payment Amount', value: (row) => row.paymentAmount },
      { header: 'Status', value: (row) => row.status },
      { header: 'Reason', value: (row) => row.reason },
      { header: 'Decision Note', value: (row) => row.responseNote || '' },
      { header: 'Refund Reference', value: (row) => row.refundReference || '' },
      { header: 'Requested At', value: (row) => csvTimestamp(row.requestedAt) },
    ])
    downloadCsv(`refund-requests-${dateStamp()}.csv`, csv)
  }

  const dialogValid = dialog?.mode === 'sent'
    ? dialogText.replace(/[^A-Za-z0-9]/g, '').length >= 6
    : dialogText.trim().length >= 3

  return (
    <section className="payments-submissions admin-refunds-panel">
      <header className="payments-submissions-head">
        <div>
          <h3>Service Refunds</h3>
          <p className="panel-sub">Review refund requests without altering the original service payment record.</p>
        </div>
        <button type="button" className="ghost-btn admin-export-btn" onClick={exportRefunds} disabled={visible.length === 0}>Export CSV</button>
      </header>

      <div className="payments-submission-summary" aria-label="Refund request summary">
        <article><span>Open requests</span><strong>{openRefunds.length}</strong></article>
        <article><span>Approved to send</span><strong>{approvedCount}</strong></article>
        <article><span>Refunded</span><strong>{refundedCount}</strong></article>
      </div>

      <div className="operations-toolbar">
        <div className="operations-filter-tabs" role="tablist" aria-label="Refund status">
          <button type="button" className={filter === 'open' ? 'is-active' : ''} onClick={() => setFilter('open')}>Open <span>{openRefunds.length}</span></button>
          <button type="button" className={filter === 'history' ? 'is-active' : ''} onClick={() => setFilter('history')}>History</button>
          <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All <span>{refunds.length}</span></button>
        </div>
        <label className="operations-search"><span className="sr-only">Search refunds</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search family, shop, or reason" /></label>
      </div>

      {error ? <p className="auth-message auth-message-error payments-error">{error}</p> : null}
      {loading ? <p className="panel-sub payments-loading">Loading refund requests...</p> : null}
      {!loading && visible.length === 0 ? <div className="operations-empty small"><h3>No refunds in this view</h3><p>Tracked service refund requests will appear here.</p></div> : null}

      <div className="finance-list">
        {visible.map((refund) => (
          <article className="finance-card" key={refund.id}>
            <header>
              <div className="finance-type-icon is-refund">R</div>
              <div><span>Service refund</span><h3>{refund.requesterName || refund.requesterEmail || 'Family refund request'}</h3><p>{refund.shopName || `Request ${refund.serviceRequestId.slice(0, 8)}`}</p></div>
              <strong>{formatPeso(refund.paymentAmount)}</strong>
              <span className={`operations-status is-${refund.status}`}>{statusLabel(refund.status)}</span>
            </header>
            <div className="finance-refund-reason"><span>Refund reason</span><p>{refund.reason}</p></div>
            <div className="finance-details-grid">
              <div><span>Requested</span><strong>{formatDate(refund.requestedAt)}</strong></div>
              <div><span>Arrangement</span><strong>{refund.deceasedFullName || refund.serviceRequestId.slice(0, 8).toUpperCase()}</strong></div>
              <div>
                <span>Delivery Status</span>
                {refund.isDelivered ? (
                  <strong style={{ color: '#047857' }}>
                    ✓ {refund.completedAt ? 'Completed Delivery' : 'Delivered (Proof Attached)'}
                  </strong>
                ) : (
                  <strong style={{ color: '#b45309' }}>
                    ⏳ Incomplete (In Preparation)
                  </strong>
                )}
              </div>
              {refund.responseNote ? <div className="is-wide"><span>Decision note</span><strong>{refund.responseNote}</strong></div> : null}
              {refund.refundReference ? <div className="is-wide"><span>Refund reference</span><strong>{refund.refundReference}</strong></div> : null}
            </div>

            {!refund.isDelivered && (refund.status === 'pending' || refund.status === 'approved') ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#92400e', margin: '10px 0 4px' }}>
                🔒 <strong>Refund Locked:</strong> Platform policy requires complete delivery before refunds can be issued. The shop has not delivered this arrangement yet.
              </div>
            ) : null}

            <footer>
              <Link to={`/admin/orders/${refund.serviceRequestId}`}>Open arrangement record</Link>
              <div className="operations-card-actions">
                {refund.status === 'pending' ? <button type="button" className="is-danger" disabled={updatingId === refund.id} onClick={() => { setDialog({ mode: 'reject', refund }); setDialogText('') }}>Reject</button> : null}
                {refund.status === 'pending' ? (
                  <button
                    type="button"
                    className="is-success"
                    disabled={updatingId === refund.id || !refund.isDelivered}
                    title={!refund.isDelivered ? 'Complete delivery required before approving refund' : undefined}
                    onClick={() => approveRefund(refund)}
                  >
                    Approve refund
                  </button>
                ) : null}
                {refund.status === 'approved' ? (
                  <button
                    type="button"
                    className="is-success"
                    disabled={updatingId === refund.id || !refund.isDelivered}
                    title={!refund.isDelivered ? 'Complete delivery required before issuing refund' : undefined}
                    onClick={() => { setDialog({ mode: 'sent', refund }); setDialogText('') }}
                  >
                    Record refund sent
                  </button>
                ) : null}
              </div>
            </footer>
          </article>
        ))}
      </div>

      {dialog ? (
        <div className="operations-modal-overlay" role="presentation" onClick={() => setDialog(null)}>
          <form className="operations-modal" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submitDialog() }}>
            <h3>{dialog.mode === 'sent' ? 'Record refund transaction' : 'Reject refund request'}</h3>
            <p>{dialog.mode === 'sent' ? 'Enter the transaction reference shown on the refund receipt.' : 'Give the family a clear explanation for the decision.'}</p>
            <label className="operations-field"><span>{dialog.mode === 'sent' ? 'Transaction reference' : 'Decision explanation'}</span>{dialog.mode === 'sent' ? <input value={dialogText} onChange={(event) => setDialogText(event.target.value)} maxLength={40} autoFocus /> : <textarea value={dialogText} onChange={(event) => setDialogText(event.target.value)} maxLength={500} rows={5} autoFocus />}</label>
            <div className="operations-modal-actions"><button type="button" className="operations-secondary-btn" onClick={() => setDialog(null)} disabled={Boolean(updatingId)}>Cancel</button><button type="submit" className={dialog.mode === 'sent' ? 'operations-primary-btn' : 'operations-danger-btn'} disabled={!dialogValid || Boolean(updatingId)}>{updatingId ? 'Saving...' : dialog.mode === 'sent' ? 'Record refund' : 'Reject request'}</button></div>
          </form>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  )
}
