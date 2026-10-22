import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'
import './AdminPaymentsPage.css'
import './AdminOperations.css'

export type CommissionRecord = {
  id: string
  shopId: string
  shopName: string
  requesterId: string
  requesterName: string
  requesterEmail: string
  deceasedFullName: string
  paymentAmount: number
  commissionRate: number
  commissionAmount: number
  shopNetAmount: number
  status: string
  paymentProvider: string
  providerPaymentMethod: string
  providerPaymentId: string
  paymentVerifiedAt: string | null
  shopMarkedCompletedAt: string | null
  completedAt: string | null
  payoutStatus: string | null
  payoutAmount: number | null
}

type FilterStatus = 'all' | 'completed' | 'delivered' | 'in_service'
type TimeRange = 'all' | '30d' | '7d'

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num)) return '₱0.00'
  return `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function statusPillClass(status: string): string {
  if (status === 'completed') return 'completed'
  if (status === 'awaiting_customer_confirmation') return 'verified'
  return 'pending'
}

function statusPillLabel(status: string): string {
  if (status === 'completed') return 'Completed'
  if (status === 'awaiting_customer_confirmation') return 'Delivered'
  return 'In Service'
}

export default function AdminCommissionsPanel() {
  const [records, setRecords] = useState<CommissionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [selectedCommission, setSelectedCommission] = useState<CommissionRecord | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchError } = await supabase
        .from('funeral_service_requests')
        .select(`
          id,
          shopId,
          shopName,
          requesterId,
          deceasedFullName,
          paymentAmount,
          commissionRate,
          commissionAmount,
          shopNetAmount,
          status,
          paymentProvider,
          providerPaymentMethod,
          providerPaymentId,
          paymentVerifiedAt,
          shopMarkedCompletedAt,
          completedAt,
          payoutStatus,
          payoutAmount
        `)
        .or('paymentVerifiedAt.not.is.null,commissionAmount.not.is.null,status.in.(payment_verified,awaiting_customer_confirmation,completed)')
        .order('paymentVerifiedAt', { ascending: false, nullsFirst: false })

      if (fetchError) throw fetchError

      const raw = data || []
      const requesterIds = [...new Set(raw.map((r: any) => r.requesterId).filter(Boolean))]

      const { data: usersData } = requesterIds.length
        ? await supabase.from('users').select('id, fullName, email').in('id', requesterIds)
        : { data: [] }

      const userMap = new Map((usersData || []).map((u: any) => [u.id, u]))

      const mapped: CommissionRecord[] = raw.map((row: any) => {
        const user: any = userMap.get(row.requesterId)
        const gross = Number(row.paymentAmount || 0)
        const rate = Number(row.commissionRate || 0.30)
        const commission = row.commissionAmount != null ? Number(row.commissionAmount) : Math.round(gross * rate * 100) / 100
        const shopNet = row.shopNetAmount != null ? Number(row.shopNetAmount) : Math.max(0, gross - commission)

        return {
          id: row.id,
          shopId: row.shopId || '',
          shopName: row.shopName || 'Funeral Shop',
          requesterId: row.requesterId || '',
          requesterName: user?.fullName || 'Customer',
          requesterEmail: user?.email || '',
          deceasedFullName: row.deceasedFullName || 'Funeral Arrangement',
          paymentAmount: gross,
          commissionRate: rate,
          commissionAmount: commission,
          shopNetAmount: shopNet,
          status: row.status || 'payment_verified',
          paymentProvider: row.paymentProvider || 'xendit',
          providerPaymentMethod: row.providerPaymentMethod || 'online',
          providerPaymentId: row.providerPaymentId || '',
          paymentVerifiedAt: row.paymentVerifiedAt,
          shopMarkedCompletedAt: row.shopMarkedCompletedAt,
          completedAt: row.completedAt,
          payoutStatus: row.payoutStatus,
          payoutAmount: row.payoutAmount != null ? Number(row.payoutAmount) : null,
        }
      })

      setRecords(mapped)
    } catch (err: any) {
      setError(err?.message || 'Unable to load commission records.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = Date.now()
    const limitMs = timeRange === '7d' ? 7 * 86400000 : timeRange === '30d' ? 30 * 86400000 : 0

    return records.filter((rec) => {
      if (limitMs > 0 && rec.paymentVerifiedAt) {
        const paidTime = new Date(rec.paymentVerifiedAt).getTime()
        if (now - paidTime > limitMs) return false
      }

      if (filterStatus === 'completed' && rec.status !== 'completed') return false
      if (filterStatus === 'delivered' && rec.status !== 'awaiting_customer_confirmation' && rec.status !== 'completed') return false
      if (filterStatus === 'in_service' && (rec.status === 'completed' || rec.status === 'awaiting_customer_confirmation')) return false

      if (!q) return true
      return (
        rec.id.toLowerCase().includes(q) ||
        rec.shopName.toLowerCase().includes(q) ||
        rec.requesterName.toLowerCase().includes(q) ||
        rec.requesterEmail.toLowerCase().includes(q) ||
        rec.deceasedFullName.toLowerCase().includes(q) ||
        rec.providerPaymentMethod.toLowerCase().includes(q) ||
        rec.providerPaymentId.toLowerCase().includes(q)
      )
    })
  }, [records, query, filterStatus, timeRange])

  const totalCommission = useMemo(() => {
    return records.reduce((sum, r) => sum + r.commissionAmount, 0)
  }, [records])

  const totalGross = useMemo(() => {
    return records.reduce((sum, r) => sum + r.paymentAmount, 0)
  }, [records])

  const totalShopPayouts = useMemo(() => {
    return records.reduce((sum, r) => sum + r.shopNetAmount, 0)
  }, [records])

  const exportCsv = () => {
    const csv = buildCsv(filtered, [
      { header: 'Order ID', value: (row) => row.id },
      { header: 'Arrangement / Deceased', value: (row) => row.deceasedFullName },
      { header: 'Funeral Shop', value: (row) => row.shopName },
      { header: 'Family Requester', value: (row) => row.requesterName },
      { header: 'Requester Email', value: (row) => row.requesterEmail },
      { header: 'Gross Paid (PHP)', value: (row) => row.paymentAmount },
      { header: 'Commission Rate', value: (row) => `${(row.commissionRate * 100).toFixed(0)}%` },
      { header: 'Admin Commission (PHP)', value: (row) => row.commissionAmount },
      { header: 'Shop Net Payout (PHP)', value: (row) => row.shopNetAmount },
      { header: 'Payment Provider', value: (row) => row.paymentProvider },
      { header: 'Payment Method', value: (row) => row.providerPaymentMethod },
      { header: 'Payment ID', value: (row) => row.providerPaymentId },
      { header: 'Order Status', value: (row) => row.status },
      { header: 'Paid At', value: (row) => csvTimestamp(row.paymentVerifiedAt) },
      { header: 'Delivered At', value: (row) => csvTimestamp(row.shopMarkedCompletedAt) },
      { header: 'Completed At', value: (row) => csvTimestamp(row.completedAt) },
    ])
    downloadCsv(`platform-commissions-${dateStamp()}.csv`, csv)
  }

  return (
    <section className="payments-submissions admin-commissions-panel">
      <header className="payments-submissions-head">
        <div>
          <h3>Platform Commissions</h3>
          <p className="panel-sub">
            Track order commission earnings, service transactions, and shop payout balances.
          </p>
        </div>
        <button
          type="button"
          className="ghost-btn admin-export-btn"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          Export CSV
        </button>
      </header>

      {/* Summary KPI Cards */}
      <div className="payments-submission-summary four-up" aria-label="Commissions financial summary">
        <article>
          <span>Total Commission</span>
          <strong>{formatPeso(totalCommission)}</strong>
        </article>
        <article>
          <span>Gross Volume</span>
          <strong>{formatPeso(totalGross)}</strong>
        </article>
        <article>
          <span>Shop Share</span>
          <strong>{formatPeso(totalShopPayouts)}</strong>
        </article>
        <article>
          <span>Total Orders</span>
          <strong>{records.length}</strong>
        </article>
      </div>

      {/* Filter and Search Bar */}
      <div className="operations-toolbar" style={{ marginTop: 18, marginBottom: 18 }}>
        <div className="operations-filter-tabs" role="tablist" aria-label="Commission filter">
          <button
            type="button"
            className={filterStatus === 'all' ? 'is-active' : ''}
            onClick={() => setFilterStatus('all')}
          >
            All <span>{records.length}</span>
          </button>
          <button
            type="button"
            className={filterStatus === 'completed' ? 'is-active' : ''}
            onClick={() => setFilterStatus('completed')}
          >
            Completed
          </button>
          <button
            type="button"
            className={filterStatus === 'delivered' ? 'is-active' : ''}
            onClick={() => setFilterStatus('delivered')}
          >
            Delivered
          </button>
          <button
            type="button"
            className={filterStatus === 'in_service' ? 'is-active' : ''}
            onClick={() => setFilterStatus('in_service')}
          >
            In Service
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="commission-toolbar-select"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            aria-label="Filter time range"
          >
            <option value="all">All Time</option>
            <option value="30d">Last 30 Days</option>
            <option value="7d">Last 7 Days</option>
          </select>

          <label className="operations-search" style={{ minWidth: 260 }}>
            <span className="sr-only">Search commissions</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shop, family, or order ID"
            />
          </label>
        </div>
      </div>

      {error ? <p className="auth-message auth-message-error payments-error">{error}</p> : null}
      {loading ? <p className="panel-sub payments-loading">Loading platform commissions...</p> : null}

      {!loading && filtered.length === 0 ? (
        <p className="panel-sub">No commission records found.</p>
      ) : null}

      {/* Clean Financial Ledger Table */}
      {!loading && filtered.length > 0 ? (
        <div className="table-wrap">
          <table className="request-table">
            <thead>
              <tr>
                <th>Arrangement / Order</th>
                <th>Funeral Shop</th>
                <th>Customer</th>
                <th>Gross Paid</th>
                <th>Commission (30%)</th>
                <th>Shop Net (70%)</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => (
                <tr key={rec.id}>
                  <td>
                    <strong>{rec.deceasedFullName || 'Funeral Service'}</strong>
                    <div className="row-muted">Order #{rec.id.slice(0, 8).toUpperCase()}</div>
                  </td>
                  <td>{rec.shopName}</td>
                  <td>
                    {rec.requesterName}
                    {rec.requesterEmail ? <div className="row-muted">{rec.requesterEmail}</div> : null}
                  </td>
                  <td>
                    <strong>{formatPeso(rec.paymentAmount)}</strong>
                    <div className="row-muted">{rec.providerPaymentMethod.toUpperCase()}</div>
                  </td>
                  <td>
                    <span className="commission-amount-cell">{formatPeso(rec.commissionAmount)}</span>
                  </td>
                  <td>{formatPeso(rec.shopNetAmount)}</td>
                  <td>
                    <span className={`status-pill ${statusPillClass(rec.status)}`}>
                      {statusPillLabel(rec.status)}
                    </span>
                  </td>
                  <td>{formatDate(rec.paymentVerifiedAt)}</td>
                  <td>
                    <div className="request-actions">
                      <button
                        type="button"
                        className="ghost-btn table-action"
                        onClick={() => setSelectedCommission(rec)}
                      >
                        Breakdown
                      </button>
                      <Link
                        to={`/admin/orders/${rec.id}`}
                        className="ghost-btn table-action"
                        style={{ textDecoration: 'none' }}
                      >
                        Order
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Transaction Breakdown Modal */}
      {selectedCommission ? (
        <div className="payments-modal-overlay" role="presentation" onClick={() => setSelectedCommission(null)}>
          <div
            className="payments-modal commission-breakdown-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commission-breakdown-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="payments-modal-header">
              <div className="payments-modal-heading">
                <h3 id="commission-breakdown-title">Commission Breakdown</h3>
                <p>Order #{selectedCommission.id.slice(0, 8).toUpperCase()} • {selectedCommission.deceasedFullName || 'Funeral Arrangement'}</p>
              </div>
              <button
                type="button"
                className="payments-modal-close"
                aria-label="Close"
                onClick={() => setSelectedCommission(null)}
              >
                ×
              </button>
            </div>

            <div className="payments-modal-body" style={{ padding: '20px 22px' }}>
              <div className="commission-modal-split">
                <div className="commission-split-card highlight">
                  <span>Platform Commission (30%)</span>
                  <strong>{formatPeso(selectedCommission.commissionAmount)}</strong>
                  <small>LifeCycle retained revenue</small>
                </div>
                <div className="commission-split-card">
                  <span>Shop Share (70%)</span>
                  <strong>{formatPeso(selectedCommission.shopNetAmount)}</strong>
                  <small>Disbursed / payable to shop</small>
                </div>
                <div className="commission-split-card">
                  <span>Gross Order Payment</span>
                  <strong>{formatPeso(selectedCommission.paymentAmount)}</strong>
                  <small>Customer charged total</small>
                </div>
              </div>

              <div className="commission-modal-details">
                <div className="commission-detail-item">
                  <span>Funeral Shop</span>
                  <strong>{selectedCommission.shopName}</strong>
                </div>
                <div className="commission-detail-item">
                  <span>Customer / Family</span>
                  <strong>{selectedCommission.requesterName}</strong>
                  {selectedCommission.requesterEmail ? (
                    <div className="row-muted" style={{ fontSize: 11 }}>{selectedCommission.requesterEmail}</div>
                  ) : null}
                </div>
                <div className="commission-detail-item">
                  <span>Payment Method</span>
                  <strong>{selectedCommission.providerPaymentMethod.toUpperCase()} ({selectedCommission.paymentProvider.toUpperCase()})</strong>
                </div>
                <div className="commission-detail-item">
                  <span>Payment Reference</span>
                  <strong className="code-font">{selectedCommission.providerPaymentId || '—'}</strong>
                </div>
                <div className="commission-detail-item">
                  <span>Payment Date</span>
                  <strong>{formatDate(selectedCommission.paymentVerifiedAt)}</strong>
                </div>
                <div className="commission-detail-item">
                  <span>Service Status</span>
                  <strong>
                    {selectedCommission.completedAt
                      ? `Completed on ${formatDate(selectedCommission.completedAt)}`
                      : selectedCommission.shopMarkedCompletedAt
                        ? `Delivered on ${formatDate(selectedCommission.shopMarkedCompletedAt)}`
                        : 'In Service'}
                  </strong>
                </div>
              </div>
            </div>

            <div className="payments-modal-footer">
              <button type="button" className="ghost-btn" onClick={() => setSelectedCommission(null)}>
                Close
              </button>
              <Link to={`/admin/orders/${selectedCommission.id}`} className="solid-btn" style={{ textDecoration: 'none' }}>
                Open Order Record
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
