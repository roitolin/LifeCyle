import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { buildCsv, csvDate, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'

export type ServiceRequest = {
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
  paymentGcashName?: string | null
  paymentGcashNumber?: string | null
  paymentReferenceNumber?: string | null
  paymentProofImageUrl?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
  paymentRejectionReason?: string | null
  completedAt?: string | null
  completionProofImageUrl?: string | null
  shopMarkedCompletedAt?: string | null
  completionProofSeenAt?: string | null
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
          Review service requests submitted to funeral shops.
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
                      <Link to={`/admin/orders/${item.id}`} className="ghost-btn btn-link table-action">
                        View Details
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </>
  )
}

export default AdminOrdersPage
