import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { buildCsv, dateStamp, downloadCsv } from '@/utils/exportCsv'
import './AdminAnalyticsPage.css'

type DateRange = '7d' | '30d' | '90d'

type UserRow = {
  id: string
  role: string | null
  createdAt: string | null
}

type ShopRow = {
  id: string
  shopName: string | null
  status: string | null
  createdAt: string | null
}

type ServiceRow = {
  id: string
  shopId: string | null
  shopName: string | null
  status: string | null
  paymentAmount: number | string | null
  createdAt: string | null
  completedAt: string | null
  paymentVerifiedAt: string | null
}

type PaymentRow = {
  id: string
  amount: number | string | null
  status: string | null
  createdAt: string | null
  verifiedAt: string | null
}

type RefundRow = {
  id: string
  service_request_id: string | null
  status: string | null
  requested_at: string | null
}

type TrendPoint = {
  label: string
  users: number
  requests: number
  completed: number
  serviceValue: number
}

type AnalyticsData = {
  users: UserRow[]
  shops: ShopRow[]
  services: ServiceRow[]
  payments: PaymentRow[]
  refunds: RefundRow[]
}

const RANGE_DAYS: Record<DateRange, number> = { '7d': 7, '30d': 30, '90d': 90 }
const RANGE_LABELS: Record<DateRange, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' }
const DAY_MS = 24 * 60 * 60 * 1000
const PAID_STATUSES = new Set(['payment_verified', 'completed'])
const REQUEST_STATUS_COLORS: Record<string, string> = {
  completed: '#15803d',
  payment_verified: '#2563eb',
  payment_submitted: '#60a5fa',
  awaiting_payment: '#7c3aed',
  accepted_by_shop: '#a855f7',
  pending_shop_acceptance: '#d97706',
  declined_by_shop: '#dc2626',
  cancelled_by_requester: '#64748b',
  unknown: '#94a3b8',
}
const SHOP_STATUS_COLORS: Record<string, string> = {
  pending: '#d97706',
  verified: '#2563eb',
  live: '#15803d',
  rejected: '#dc2626',
}

const EMPTY_DATA: AnalyticsData = { users: [], shops: [], services: [], payments: [], refunds: [] }

function normalize(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

function timeOf(value: string | null | undefined) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function moneyOf(value: number | string | null | undefined) {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function comparisonLabel(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 'No change from prior period' : 'New activity this period'
  const change = Math.round(((current - previous) / previous) * 100)
  if (change === 0) return 'No change from prior period'
  return `${change > 0 ? '+' : ''}${change}% from prior period`
}

function comparisonTone(current: number, previous: number) {
  if (current === previous) return 'neutral'
  return current > previous ? 'up' : 'down'
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    pending_shop_acceptance: 'Pending acceptance',
    accepted_by_shop: 'Accepted by shop',
    awaiting_payment: 'Awaiting payment',
    payment_submitted: 'Payment submitted',
    payment_verified: 'Payment verified',
    completed: 'Completed',
    declined_by_shop: 'Declined',
    cancelled_by_requester: 'Cancelled',
  }
  return labels[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function makeTrend(services: ServiceRow[], users: UserRow[], range: DateRange, endTime: number): TrendPoint[] {
  const days = RANGE_DAYS[range]
  const bucketDays = range === '7d' ? 1 : range === '30d' ? 3 : 7
  const bucketCount = Math.ceil(days / bucketDays)
  const startTime = endTime - days * DAY_MS

  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = startTime + index * bucketDays * DAY_MS
    const bucketEnd = Math.min(endTime, bucketStart + bucketDays * DAY_MS)
    const date = new Date(bucketStart)
    const label = date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
    const bucketServices = services.filter((row) => {
      const created = timeOf(row.createdAt)
      return created >= bucketStart && created < bucketEnd
    })

    return {
      label,
      users: users.filter((row) => {
        const created = timeOf(row.createdAt)
        return created >= bucketStart && created < bucketEnd
      }).length,
      requests: bucketServices.length,
      completed: bucketServices.filter((row) => normalize(row.status) === 'completed').length,
      serviceValue: bucketServices
        .filter((row) => PAID_STATUSES.has(normalize(row.status)))
        .reduce((sum, row) => sum + moneyOf(row.paymentAmount), 0),
    }
  })
}

function lineCoordinates(values: number[], maxValue: number) {
  const width = 720
  const height = 190
  const left = 22
  const top = 16
  const usableWidth = width - left * 2
  const usableHeight = height - top * 2
  return values.map((value, index) => {
    const x = left + (values.length <= 1 ? usableWidth / 2 : (index / (values.length - 1)) * usableWidth)
    const y = top + usableHeight - (value / Math.max(maxValue, 1)) * usableHeight
    return { x, y, value }
  })
}

type DonutSegment = {
  label: string
  value: number
  color: string
}

function DonutChart({ segments, total, centreLabel, ariaLabel }: {
  segments: DonutSegment[]
  total: number
  centreLabel: string
  ariaLabel: string
}) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  const visibleSegments = segments.filter((segment) => segment.value > 0)

  return (
    <div className="analytics-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={ariaLabel}>
        <circle className="analytics-donut-track" cx="60" cy="60" r={radius} />
        {visibleSegments.map((segment, index) => {
          const fraction = total > 0 ? segment.value / total : 0
          const length = fraction * circumference
          const elapsed = visibleSegments
            .slice(0, index)
            .reduce((sum, previous) => sum + (total > 0 ? previous.value / total : 0), 0)
          const offset = -elapsed * circumference
          return (
            <circle
              key={segment.label}
              className="analytics-donut-segment"
              cx="60"
              cy="60"
              r={radius}
              stroke={segment.color}
              strokeDasharray={length + ' ' + (circumference - length)}
              strokeDashoffset={offset}
              transform="rotate(-90 60 60)"
            >
              <title>{segment.label}: {segment.value}</title>
            </circle>
          )
        })}
        <text x="60" y="58" textAnchor="middle" className="analytics-donut-number">{formatCompact(total)}</text>
        <text x="60" y="73" textAnchor="middle" className="analytics-donut-label">{centreLabel}</text>
      </svg>
    </div>
  )
}

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<DateRange>('30d')
  const [data, setData] = useState<AnalyticsData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState<number>(Date.now())

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const cutoff = new Date(Date.now() - 181 * DAY_MS).toISOString()
      const [usersResult, shopsResult, servicesResult, paymentsResult, refundsResult] = await Promise.all([
        supabase.from('users').select('id, role, createdAt').gte('createdAt', cutoff).order('createdAt', { ascending: false }).limit(5000),
        supabase.from('funeral_shops').select('id, shopName, status, createdAt').order('createdAt', { ascending: false }).limit(5000),
        supabase.from('funeral_service_requests').select('id, shopId, shopName, status, paymentAmount, createdAt, completedAt, paymentVerifiedAt').gte('createdAt', cutoff).order('createdAt', { ascending: false }).limit(5000),
        supabase.from('shop_payments').select('id, amount, status, createdAt, verifiedAt').gte('createdAt', cutoff).order('createdAt', { ascending: false }).limit(5000),
        supabase.from('service_refund_requests').select('id, service_request_id, status, requested_at').gte('requested_at', cutoff).order('requested_at', { ascending: false }).limit(5000),
      ])

      const firstError = usersResult.error || shopsResult.error || servicesResult.error || paymentsResult.error || refundsResult.error
      if (firstError) throw firstError

      setData({
        users: (usersResult.data || []) as UserRow[],
        shops: (shopsResult.data || []) as ShopRow[],
        services: (servicesResult.data || []) as ServiceRow[],
        payments: (paymentsResult.data || []) as PaymentRow[],
        refunds: (refundsResult.data || []) as RefundRow[],
      })
      setLoadedAt(Date.now())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load analytics right now.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const analytics = useMemo(() => {
    const days = RANGE_DAYS[range]
    const endTime = loadedAt
    const startTime = endTime - days * DAY_MS
    const previousStart = startTime - days * DAY_MS
    const inCurrent = (value: string | null | undefined) => {
      const time = timeOf(value)
      return time >= startTime && time <= endTime
    }
    const inPrevious = (value: string | null | undefined) => {
      const time = timeOf(value)
      return time >= previousStart && time < startTime
    }

    const currentUsers = data.users.filter((row) => inCurrent(row.createdAt))
    const previousUsers = data.users.filter((row) => inPrevious(row.createdAt))
    const currentServices = data.services.filter((row) => inCurrent(row.createdAt))
    const previousServices = data.services.filter((row) => inPrevious(row.createdAt))
    const completed = currentServices.filter((row) => normalize(row.status) === 'completed')
    const previousCompleted = previousServices.filter((row) => normalize(row.status) === 'completed')
    const verifiedPayments = data.payments.filter((row) => normalize(row.status) === 'verified' && inCurrent(row.verifiedAt || row.createdAt))
    const previousVerifiedPayments = data.payments.filter((row) => normalize(row.status) === 'verified' && inPrevious(row.verifiedAt || row.createdAt))
    const verifiedFees = verifiedPayments.reduce((sum, row) => sum + moneyOf(row.amount), 0)
    const previousVerifiedFees = previousVerifiedPayments.reduce((sum, row) => sum + moneyOf(row.amount), 0)
    const completionRate = currentServices.length ? (completed.length / currentServices.length) * 100 : 0
    const previousCompletionRate = previousServices.length ? (previousCompleted.length / previousServices.length) * 100 : 0
    const trend = makeTrend(data.services, data.users, range, endTime)

    const statusCounts = new Map<string, number>()
    currentServices.forEach((row) => {
      const status = normalize(row.status) || 'unknown'
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1)
    })
    const statuses = [...statusCounts.entries()]
      .map(([status, count]) => ({ status, count, percentage: currentServices.length ? (count / currentServices.length) * 100 : 0 }))
      .sort((a, b) => b.count - a.count)

    const shopMap = new Map<string, { id: string; name: string; requests: number; completed: number; value: number }>()
    currentServices.forEach((row) => {
      const shopId = row.shopId || row.shopName || 'unknown'
      const existing = shopMap.get(shopId) || {
        id: shopId,
        name: row.shopName || data.shops.find((shop) => shop.id === row.shopId)?.shopName || 'Unassigned shop',
        requests: 0,
        completed: 0,
        value: 0,
      }
      existing.requests += 1
      if (normalize(row.status) === 'completed') existing.completed += 1
      if (PAID_STATUSES.has(normalize(row.status))) existing.value += moneyOf(row.paymentAmount)
      shopMap.set(shopId, existing)
    })
    const topShops = [...shopMap.values()].sort((a, b) => b.requests - a.requests || b.value - a.value).slice(0, 5)

    const currentShops = data.shops.filter((row) => inCurrent(row.createdAt))
    const shopStatuses = ['pending', 'verified', 'live', 'rejected'].map((status) => ({
      status,
      count: currentShops.filter((row) => normalize(row.status) === status).length,
    }))
    const liveShops = data.shops.filter((row) => normalize(row.status) === 'live').length
    const serviceValue = currentServices
      .filter((row) => PAID_STATUSES.has(normalize(row.status)))
      .reduce((sum, row) => sum + moneyOf(row.paymentAmount), 0)
    const currentRefunds = data.refunds.filter((row) => inCurrent(row.requested_at))
    const openRefunds = currentRefunds.filter((row) => ['pending', 'approved'].includes(normalize(row.status)))
    const serviceById = new Map(data.services.map((row) => [row.id, row]))
    const refundExposure = openRefunds.reduce((sum, row) => sum + moneyOf(serviceById.get(row.service_request_id || '')?.paymentAmount), 0)

    return {
      currentUsers,
      previousUsers,
      currentServices,
      previousServices,
      completed,
      previousCompleted,
      completionRate,
      previousCompletionRate,
      verifiedFees,
      previousVerifiedFees,
      trend,
      statuses,
      topShops,
      currentShops,
      shopStatuses,
      liveShops,
      serviceValue,
      currentRefunds,
      openRefunds,
      refundExposure,
    }
  }, [data, loadedAt, range])

  const chartMax = Math.max(3, ...analytics.trend.flatMap((point) => [point.users, point.requests]))
  const userCoordinates = lineCoordinates(analytics.trend.map((point) => point.users), chartMax)
  const requestCoordinates = lineCoordinates(analytics.trend.map((point) => point.requests), chartMax)
  const userPoints = userCoordinates.map((point) => point.x.toFixed(1) + ',' + point.y.toFixed(1)).join(' ')
  const requestPoints = requestCoordinates.map((point) => point.x.toFixed(1) + ',' + point.y.toFixed(1)).join(' ')
  const requestSegments: DonutSegment[] = analytics.statuses.map((entry) => ({
    label: statusLabel(entry.status),
    value: entry.count,
    color: REQUEST_STATUS_COLORS[entry.status] || '#94a3b8',
  }))
  const shopSegments: DonutSegment[] = analytics.shopStatuses.map((entry) => ({
    label: entry.status.charAt(0).toUpperCase() + entry.status.slice(1),
    value: entry.count,
    color: SHOP_STATUS_COLORS[entry.status] || '#94a3b8',
  }))
  const busiestPeriod = analytics.trend.reduce<TrendPoint | null>((best, point) => (
    !best || point.requests > best.requests ? point : best
  ), null)
  const exportAnalytics = () => {
    const csv = buildCsv(analytics.trend, [
      { header: 'Period starting', value: (row) => row.label },
      { header: 'New users', value: (row) => row.users },
      { header: 'Service requests', value: (row) => row.requests },
      { header: 'Completed arrangements', value: (row) => row.completed },
      { header: 'Paid service value', value: (row) => row.serviceValue },
    ])
    downloadCsv(`admin-analytics-${range}-${dateStamp()}.csv`, csv)
  }

  if (loading) {
    return <div className="analytics-page"><div className="analytics-loading">Loading analytics…</div></div>
  }

  return (
    <section className="analytics-page">
      <header className="analytics-header">
        <div>
          <h2>Analytics</h2>
          <p>Users, service requests, shop activity, payments, and refunds.</p>
        </div>
        <div className="analytics-actions">
          <label className="analytics-range">
            <span>Date range</span>
            <select value={range} onChange={(event) => setRange(event.target.value as DateRange)}>
              {(Object.keys(RANGE_LABELS) as DateRange[]).map((value) => (
                <option key={value} value={value}>{RANGE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <button type="button" className="analytics-button secondary" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="analytics-button primary" onClick={exportAnalytics} disabled={analytics.trend.length === 0}>
            Export CSV
          </button>
        </div>
      </header>

      {error ? (
        <div className="analytics-error" role="alert">
          <strong>Analytics could not be loaded.</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : null}

      <div className="analytics-kpis">
        <article>
          <span>New users</span>
          <strong>{formatCompact(analytics.currentUsers.length)}</strong>
          <small className={comparisonTone(analytics.currentUsers.length, analytics.previousUsers.length)}>
            {comparisonLabel(analytics.currentUsers.length, analytics.previousUsers.length)}
          </small>
        </article>
        <article>
          <span>Service requests</span>
          <strong>{formatCompact(analytics.currentServices.length)}</strong>
          <small className={comparisonTone(analytics.currentServices.length, analytics.previousServices.length)}>
            {comparisonLabel(analytics.currentServices.length, analytics.previousServices.length)}
          </small>
        </article>
        <article>
          <span>Completion rate</span>
          <strong>{analytics.completionRate.toFixed(1)}%</strong>
          <small className={comparisonTone(analytics.completionRate, analytics.previousCompletionRate)}>
            {analytics.completed.length} completed · {analytics.completionRate - analytics.previousCompletionRate >= 0 ? '+' : ''}{(analytics.completionRate - analytics.previousCompletionRate).toFixed(1)} pts
          </small>
        </article>
        <article>
          <span>Verified shop fees</span>
          <strong>{formatPeso(analytics.verifiedFees)}</strong>
          <small className={comparisonTone(analytics.verifiedFees, analytics.previousVerifiedFees)}>
            {comparisonLabel(analytics.verifiedFees, analytics.previousVerifiedFees)}
          </small>
        </article>
      </div>

      <div className="analytics-grid analytics-grid-main">
        <article className="analytics-card analytics-trend-card">
          <div className="analytics-card-head">
            <h3>User and request trend</h3>
            <div className="analytics-legend" aria-label="Chart legend">
              <span><i className="users" />New users</span>
              <span><i className="requests" />Service requests</span>
            </div>
          </div>
          <div className="analytics-chart" role="img" aria-label={`New users and service requests for ${RANGE_LABELS[range].toLowerCase()}`}>
            <div className="analytics-chart-layout">
              <div className="analytics-y-axis" aria-hidden="true">
                <span>{chartMax}</span>
                <span>{Math.round(chartMax * .67)}</span>
                <span>{Math.round(chartMax * .33)}</span>
                <span>0</span>
              </div>
              <div className="analytics-chart-main">
                <svg viewBox="0 0 720 190" preserveAspectRatio="none" aria-hidden="true">
                  {[16, 69, 121, 174].map((line) => (
                    <line key={line} x1="22" x2="698" y1={line} y2={line} className="grid-line" />
                  ))}
                  <polygon points={'22,174 ' + requestPoints + ' 698,174'} className="trend-area" />
                  <polyline points={userPoints} className="trend-line users" />
                  <polyline points={requestPoints} className="trend-line requests" />
                  {userCoordinates.map((point, index) => (
                    <circle key={'user-' + index} cx={point.x} cy={point.y} r="3.2" className="trend-point users">
                      <title>{analytics.trend[index]?.label}: {point.value} new users</title>
                    </circle>
                  ))}
                  {requestCoordinates.map((point, index) => (
                    <circle key={'request-' + index} cx={point.x} cy={point.y} r="3.2" className="trend-point requests">
                      <title>{analytics.trend[index]?.label}: {point.value} service requests</title>
                    </circle>
                  ))}
                </svg>
                <div className="analytics-axis-labels">
                  {analytics.trend.map((point, index) => (
                    <span key={`${point.label}-${index}`}>{point.label}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="analytics-chart-summary">
              <span><strong>{analytics.currentUsers.length}</strong> new users</span>
              <span><strong>{analytics.currentServices.length}</strong> requests</span>
              <span><strong>{busiestPeriod?.requests || 0}</strong> peak requests in one period</span>
            </div>
          </div>
        </article>

        <article className="analytics-card analytics-status-card">
          <div className="analytics-card-head">
            <h3>Request outcomes</h3>
          </div>
          {analytics.statuses.length ? (
            <div className="analytics-donut-layout">
              <DonutChart
                segments={requestSegments}
                total={analytics.currentServices.length}
                centreLabel="requests"
                ariaLabel="Service request outcomes"
              />
              <div className="analytics-pie-legend">
                {analytics.statuses.map((entry) => (
                  <div key={entry.status}>
                    <i style={{ backgroundColor: REQUEST_STATUS_COLORS[entry.status] || '#94a3b8' }} />
                    <span>{statusLabel(entry.status)}</span>
                    <strong>{entry.count}</strong>
                    <small>{Math.round(entry.percentage)}%</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="analytics-empty-chart">
              <DonutChart segments={[]} total={0} centreLabel="requests" ariaLabel="No service request outcomes" />
              <p>No service requests in this period.</p>
            </div>
          )}
        </article>
      </div>

      <div className="analytics-grid analytics-grid-bottom">
        <article className="analytics-card">
          <div className="analytics-card-head">
            <h3>Top shops by requests</h3>
            <span className="analytics-card-note">{analytics.liveShops} live shops</span>
          </div>
          {analytics.topShops.length ? (
            <div className="analytics-table-wrap">
              <table className="analytics-table">
                <thead><tr><th>Shop</th><th>Requests</th><th>Completed</th><th>Paid value</th></tr></thead>
                <tbody>
                  {analytics.topShops.map((shop) => (
                    <tr key={shop.id}>
                      <td>{shop.name}</td>
                      <td>{shop.requests}</td>
                      <td>{shop.completed}</td>
                      <td>{formatPeso(shop.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="analytics-empty">No shop activity in this period.</p>}
        </article>

        <article className="analytics-card">
          <div className="analytics-card-head">
            <h3>Shop application status</h3>
            <span className="analytics-card-note">{analytics.currentShops.length} new</span>
          </div>
          <div className="analytics-donut-layout compact">
            <DonutChart
              segments={shopSegments}
              total={analytics.currentShops.length}
              centreLabel="new shops"
              ariaLabel="New shop application status"
            />
            <div className="analytics-pie-legend">
              {analytics.shopStatuses.map((entry) => (
                <div key={entry.status}>
                  <i style={{ backgroundColor: SHOP_STATUS_COLORS[entry.status] || '#94a3b8' }} />
                  <span>{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}</span>
                  <strong>{entry.count}</strong>
                  <small>{analytics.currentShops.length ? Math.round((entry.count / analytics.currentShops.length) * 100) : 0}%</small>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="analytics-card">
          <div className="analytics-card-head">
            <h3>Payments and refunds</h3>
          </div>
          <dl className="analytics-finance-list">
            <div><dt>Paid service value</dt><dd>{formatPeso(analytics.serviceValue)}</dd></div>
            <div><dt>Verified shop fees</dt><dd>{formatPeso(analytics.verifiedFees)}</dd></div>
            <div><dt>Refund requests</dt><dd>{analytics.currentRefunds.length}</dd></div>
            <div className={analytics.openRefunds.length ? 'attention' : ''}><dt>Open refund exposure</dt><dd>{formatPeso(analytics.refundExposure)}</dd></div>
          </dl>
        </article>
      </div>
    </section>
  )
}
