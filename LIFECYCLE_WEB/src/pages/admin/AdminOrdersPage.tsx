import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildCsv, csvDate, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'

type ServiceRequest = {
  id: string
  requesterId: string
  shopId: string
  shopName?: string | null
  shopContactNumber?: string | null
  shopAddress?: string | null
  productId?: string
  productName?: string | null
  productPrice?: string | null
  productImageUrl?: string | null
  variationName?: string | null
  requestType?: string
  customDesignNotes?: string | null
  memorialPhotoUrl?: string | null
  referencePhotoUrl?: string | null
  deceasedFullName?: string | null
  deceasedDateOfBirth?: string | null
  deceasedDateOfPassing?: string | null
  deceasedAge?: number | null
  tributeMessage?: string | null
  familyCoordinatorName?: string | null
  wakeAddress?: string | null
  wakeStartDate?: string | null
  wakeEndDate?: string | null
  burialTime?: string | null
  pickupAddress?: string | null
  contactNumber?: string | null
  status: string
  paymentQrUrl?: string | null
  paymentAmount?: number | string | null
  paymentPayerName?: string | null
  paymentGcashNumber?: string | null
  paymentReferenceNumber?: string | null
  paymentProofImageUrl?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
  paymentRejectionReason?: string | null
  completedAt?: string | null
  createdAt?: string | null
  acceptedAt?: string | null
  declinedAt?: string | null
  cancelledAt?: string | null
  shopRespondedAt?: string | null
  requesterName?: string
  requesterEmail?: string
}

function normalize(value: string | undefined | null) {
  return String(value || '').trim().toLowerCase()
}

function formatPeso(value: string | number | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(num)}`
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString(undefined, { hour12: true })
}

function formatScheduleDate(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatScheduleTime(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return value
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function statusPill(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'pending_shop_acceptance') return 'pending'
  if (s === 'accepted_by_shop' || s === 'awaiting_payment' || s === 'payment_submitted' || s === 'payment_verified') return 'accepted'
  if (s === 'completed') return 'completed'
  if (s === 'declined_by_shop') return 'rejected'
  return 'none'
}

function statusLabel(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'pending_shop_acceptance') return 'Waiting'
  if (s === 'accepted_by_shop') return 'Accepted'
  if (s === 'awaiting_payment') return 'Awaiting Payment'
  if (s === 'payment_submitted') return 'Payment Submitted'
  if (s === 'payment_verified') return 'Payment Confirmed'
  if (s === 'completed') return 'Completed'
  if (s === 'declined_by_shop') return 'Declined'
  if (s === 'cancelled_by_requester') return 'Cancelled'
  return s.replace(/_/g, ' ')
}

function AdminOrdersPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState<ServiceRequest[]>([])
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<ServiceRequest | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchError } = await supabase
        .from('funeral_service_requests')
        .select('*')
        .order('createdAt', { ascending: false })

      if (fetchError) throw fetchError

      const rows = (data || []) as ServiceRequest[]
      const requesterIds = Array.from(new Set(rows.map((row) => row.requesterId).filter(Boolean)))
      const nameMap: Record<string, { name: string; email: string }> = {}

      if (requesterIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, email, fullName')
          .in('id', requesterIds)
        ;(usersData || []).forEach((user: any) => {
          nameMap[user.id] = { name: user.fullName || '', email: user.email || '' }
        })
      }

      setItems(
        rows.map((row) => ({
          ...row,
          requesterName: nameMap[row.requesterId]?.name || '',
          requesterEmail: nameMap[row.requesterId]?.email || '',
        })),
      )
    } catch {
      setError('Unable to load service requests right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(queryText)
    let list = items

    if (statusFilter !== 'all') {
      list = list.filter((item) => statusPill(item.status) === statusFilter)
    }

    if (!q) return list

    return list.filter((item) =>
      [
        item.deceasedFullName,
        item.productName,
        item.shopName,
        item.familyCoordinatorName,
        item.contactNumber,
        item.requesterName,
        item.requesterEmail,
      ].some((value) => normalize(value).includes(q)),
    )
  }, [items, statusFilter, queryText])

  const exportOrders = () => {
    const csv = buildCsv(filtered, [
      { header: 'Request ID', value: (row) => row.id },
      { header: 'Status', value: (row) => statusLabel(row.status) },
      { header: 'Request Type', value: (row) => row.requestType || '' },
      { header: 'Deceased Full Name', value: (row) => row.deceasedFullName || '' },
      { header: 'Deceased Date of Birth', value: (row) => csvDate(row.deceasedDateOfBirth || null) },
      { header: 'Date of Passing', value: (row) => csvDate(row.deceasedDateOfPassing || null) },
      { header: 'Wake Start Date', value: (row) => csvDate(row.wakeStartDate || null) },
      { header: 'Wake End Date', value: (row) => csvDate(row.wakeEndDate || null) },
      { header: 'Burial Time', value: (row) => row.burialTime || '' },
      { header: 'Deceased Age', value: (row) => (row.deceasedAge == null ? '' : row.deceasedAge) },
      { header: 'Item', value: (row) => row.productName || 'Custom casket design' },
      { header: 'Variation', value: (row) => row.variationName || '' },
      { header: 'Item Price', value: (row) => (row.productPrice == null ? '' : row.productPrice) },
      { header: 'Payment Amount', value: (row) => (row.paymentAmount == null ? '' : row.paymentAmount) },
      { header: 'Payer Name', value: (row) => row.paymentPayerName || '' },
      { header: 'GCash Number', value: (row) => row.paymentGcashNumber || '' },
      { header: 'Payment Reference', value: (row) => row.paymentReferenceNumber || '' },
      { header: 'Shop', value: (row) => row.shopName || row.shopId || '' },
      { header: 'Shop Contact Number', value: (row) => row.shopContactNumber || '' },
      { header: 'Requester Name', value: (row) => row.requesterName || '' },
      { header: 'Requester Email', value: (row) => row.requesterEmail || '' },
      { header: 'Family Coordinator', value: (row) => row.familyCoordinatorName || '' },
      { header: 'Contact Number', value: (row) => row.contactNumber || '' },
      { header: 'Wake Address', value: (row) => row.wakeAddress || '' },
      { header: 'Pickup Address', value: (row) => row.pickupAddress || '' },
      { header: 'Created At', value: (row) => csvTimestamp(row.createdAt || null) },
      { header: 'Accepted At', value: (row) => csvTimestamp(row.acceptedAt || null) },
      { header: 'Declined At', value: (row) => csvTimestamp(row.declinedAt || null) },
      { header: 'Cancelled At', value: (row) => csvTimestamp(row.cancelledAt || null) },
      { header: 'Shop Responded At', value: (row) => csvTimestamp(row.shopRespondedAt || null) },
      { header: 'Payment Submitted At', value: (row) => csvTimestamp(row.paymentSubmittedAt || null) },
      { header: 'Payment Verified At', value: (row) => csvTimestamp(row.paymentVerifiedAt || null) },
      { header: 'Completed At', value: (row) => csvTimestamp(row.completedAt || null) },
    ])
    downloadCsv(`service-requests-${dateStamp()}.csv`, csv)
  }

  return (
    <>
      <section className="panel">
        <h2>All Service Requests</h2>
        <p className="panel-sub">
          Review every funeral service request submitted to shops across the platform.
        </p>

        <div className="admin-filters admin-filters-advanced">
          <div>
            <label htmlFor="admin-order-search">Search</label>
            <input
              id="admin-order-search"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Deceased, item, shop, requester, coordinator"
            />
          </div>
          <div>
            <label htmlFor="admin-order-status">Request Status</label>
            <select id="admin-order-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="pending">Waiting</option>
              <option value="accepted">Accepted</option>
              <option value="completed">Completed</option>
              <option value="rejected">Declined</option>
              <option value="none">Cancelled</option>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <button type="button" className="ghost-btn admin-export-btn" onClick={exportOrders}>
              Export CSV
            </button>
          </div>
        </div>

        {loading ? <p className="panel-sub">Loading service requests...</p> : null}
        {error ? <p className="auth-message auth-message-error">{error}</p> : null}
        {!loading && filtered.length === 0 ? <p className="panel-sub">No service requests found.</p> : null}

        <div className="table-wrap">
          <table className="request-table">
            <thead>
              <tr>
                <th>Deceased</th>
                <th>Item</th>
                <th>Shop</th>
                <th>Requester</th>
                <th>Price</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.deceasedFullName || '—'}</td>
                  <td>{item.productName || 'Custom casket design'}</td>
                  <td>{item.shopName || item.shopId || '—'}</td>
                  <td>
                    {item.requesterName ? <strong>{item.requesterName}</strong> : null}
                    {item.requesterEmail ? <div>{item.requesterEmail}</div> : null}
                    {!item.requesterName && !item.requesterEmail ? <span>{item.requesterId || '—'}</span> : null}
                  </td>
                  <td>{item.productPrice != null ? formatPeso(item.productPrice) : 'Custom pricing'}</td>
                  <td>
                    <span className={`status-pill ${statusPill(item.status)}`}>{statusLabel(item.status)}</span>
                  </td>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <div className="request-actions">
                      <button type="button" className="ghost-btn table-action" onClick={() => setSelectedOrder(item)}>
                        View Details
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedOrder ? (
        <section className="panel">
          <div className="quick-actions">
            <button type="button" className="ghost-btn table-action" onClick={() => setSelectedOrder(null)}>
              Close Details
            </button>
          </div>

          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Request Details</h3>

          <div className="request-detail-grid">
            <div>
              <span>Status</span>
              <strong>
                <span className={`status-pill ${statusPill(selectedOrder.status)}`}>{statusLabel(selectedOrder.status)}</span>
              </strong>
            </div>
            <div>
              <span>Request ID</span>
              <strong>{selectedOrder.id}</strong>
            </div>
            <div>
              <span>Request Type</span>
              <strong>{selectedOrder.requestType ? selectedOrder.requestType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : '—'}</strong>
            </div>
            <div>
              <span>Requested Item</span>
              <strong>
                {selectedOrder.productName || 'Custom casket design'}
                {selectedOrder.variationName ? ` (${selectedOrder.variationName})` : ''}
              </strong>
            </div>
            <div>
              <span>Price</span>
              <strong>{selectedOrder.productPrice != null ? formatPeso(selectedOrder.productPrice) : 'Custom pricing'}</strong>
            </div>
            <div>
              <span>Payment Amount</span>
              <strong>{selectedOrder.paymentAmount != null ? formatPeso(selectedOrder.paymentAmount) : '—'}</strong>
            </div>
            <div>
              <span>Payer Name</span>
              <strong>{selectedOrder.paymentPayerName || '—'}</strong>
            </div>
            <div>
              <span>GCash Number</span>
              <strong>{selectedOrder.paymentGcashNumber || '—'}</strong>
            </div>
            <div>
              <span>Payment Reference</span>
              <strong>{selectedOrder.paymentReferenceNumber || '—'}</strong>
            </div>
            <div>
              <span>Shop</span>
              <strong>{selectedOrder.shopName || selectedOrder.shopId || '—'}</strong>
            </div>
            <div>
              <span>Requester</span>
              <strong>
                {selectedOrder.requesterName || '—'}
                {selectedOrder.requesterEmail ? <div style={{ fontWeight: 400, fontSize: '0.85rem', color: '#6b7280' }}>{selectedOrder.requesterEmail}</div> : null}
              </strong>
            </div>
            <div>
              <span>Family Coordinator</span>
              <strong>{selectedOrder.familyCoordinatorName || '—'}</strong>
            </div>
            <div>
              <span>Contact Number</span>
              <strong>{selectedOrder.contactNumber || '—'}</strong>
            </div>
            <div>
              <span>Deceased Full Name</span>
              <strong>{selectedOrder.deceasedFullName || '—'}</strong>
            </div>
            <div>
              <span>Deceased Date of Birth</span>
              <strong>{selectedOrder.deceasedDateOfBirth || '—'}</strong>
            </div>
            <div>
              <span>Date of Passing</span>
              <strong>{selectedOrder.deceasedDateOfPassing ? new Date(selectedOrder.deceasedDateOfPassing).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</strong>
            </div>
            <div>
              <span>Deceased Age</span>
              <strong>{selectedOrder.deceasedAge != null ? selectedOrder.deceasedAge : '—'}</strong>
            </div>
            <div>
              <span>Wake Venue</span>
              <strong>{selectedOrder.wakeAddress || '—'}</strong>
            </div>
            <div>
              <span>Wake Start (From)</span>
              <strong>{formatScheduleDate(selectedOrder.wakeStartDate)}</strong>
            </div>
            <div>
              <span>Wake End (To)</span>
              <strong>{formatScheduleDate(selectedOrder.wakeEndDate)}</strong>
            </div>
            <div>
              <span>Burial Time</span>
              <strong>{formatScheduleTime(selectedOrder.burialTime)}</strong>
            </div>
            <div>
              <span>Pickup Address</span>
              <strong>{selectedOrder.pickupAddress || '—'}</strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{formatTimestamp(selectedOrder.createdAt)}</strong>
            </div>
            <div>
              <span>Accepted At</span>
              <strong>{formatTimestamp(selectedOrder.acceptedAt)}</strong>
            </div>
            <div>
              <span>Declined At</span>
              <strong>{formatTimestamp(selectedOrder.declinedAt)}</strong>
            </div>
            <div>
              <span>Cancelled At</span>
              <strong>{formatTimestamp(selectedOrder.cancelledAt)}</strong>
            </div>
            <div>
              <span>Shop Responded At</span>
              <strong>{formatTimestamp(selectedOrder.shopRespondedAt)}</strong>
            </div>
            <div>
              <span>Payment Submitted At</span>
              <strong>{formatTimestamp(selectedOrder.paymentSubmittedAt)}</strong>
            </div>
            <div>
              <span>Payment Verified At</span>
              <strong>{formatTimestamp(selectedOrder.paymentVerifiedAt)}</strong>
            </div>
            <div>
              <span>Completed At</span>
              <strong>{formatTimestamp(selectedOrder.completedAt)}</strong>
            </div>
          </div>

          {selectedOrder.customDesignNotes ? (
            <div style={{ marginTop: '14px' }}>
              <span style={{ display: 'block', color: '#6b7280', fontSize: '0.78rem', marginBottom: '4px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Custom Design Notes</span>
              <p className="panel-sub" style={{ margin: '4px 0 0' }}>{selectedOrder.customDesignNotes}</p>
            </div>
          ) : null}

          {selectedOrder.tributeMessage ? (
            <div style={{ marginTop: '14px' }}>
              <span style={{ display: 'block', color: '#6b7280', fontSize: '0.78rem', marginBottom: '4px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Tribute Message</span>
              <p className="panel-sub" style={{ margin: '4px 0 0' }}>{selectedOrder.tributeMessage}</p>
            </div>
          ) : null}

          {selectedOrder.paymentRejectionReason ? (
            <div style={{ marginTop: '14px' }}>
              <span style={{ display: 'block', color: '#991b1b', fontSize: '0.78rem', marginBottom: '4px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Payment Rejection Reason</span>
              <p className="panel-sub" style={{ margin: '4px 0 0', color: '#991b1b' }}>{selectedOrder.paymentRejectionReason}</p>
            </div>
          ) : null}

          {selectedOrder.productImageUrl || selectedOrder.memorialPhotoUrl || selectedOrder.referencePhotoUrl || selectedOrder.paymentQrUrl || selectedOrder.paymentProofImageUrl ? (
            <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {selectedOrder.productImageUrl ? (
                <a href={selectedOrder.productImageUrl} target="_blank" rel="noreferrer">
                  <img src={selectedOrder.productImageUrl} alt="Product" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px' }} />
                </a>
              ) : null}
              {selectedOrder.memorialPhotoUrl ? (
                <a href={selectedOrder.memorialPhotoUrl} target="_blank" rel="noreferrer">
                  <img src={selectedOrder.memorialPhotoUrl} alt="Memorial" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px' }} />
                </a>
              ) : null}
              {selectedOrder.referencePhotoUrl ? (
                <a href={selectedOrder.referencePhotoUrl} target="_blank" rel="noreferrer">
                  <img src={selectedOrder.referencePhotoUrl} alt="Reference" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px' }} />
                </a>
              ) : null}
              {selectedOrder.paymentQrUrl ? (
                <a href={selectedOrder.paymentQrUrl} target="_blank" rel="noreferrer" title="Shop payment QR">
                  <img src={selectedOrder.paymentQrUrl} alt="Shop payment QR" style={{ width: '140px', height: '140px', objectFit: 'contain', borderRadius: '10px', background: '#ffffff' }} />
                </a>
              ) : null}
              {selectedOrder.paymentProofImageUrl ? (
                <a href={selectedOrder.paymentProofImageUrl} target="_blank" rel="noreferrer" title="Buyer payment proof">
                  <img src={selectedOrder.paymentProofImageUrl} alt="Buyer payment proof" style={{ width: '140px', height: '140px', objectFit: 'contain', borderRadius: '10px', background: '#ffffff' }} />
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

export default AdminOrdersPage
