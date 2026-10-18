import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import BrandLogo from '@/components/BrandLogo'
import LogoutLink from '@/components/LogoutLink'
import PageBackButton from '@/components/PageBackButton'
import AccountMobileHeader from '@/components/AccountMobileHeader'
import './PurchasePage.css'

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
}

type UserPayment = {
  id: string
  shopName?: string | null
  productName?: string | null
  variationName?: string | null
  status: string
  paymentAmount?: number | string | null
  paymentPayerName?: string | null
  paymentGcashName?: string | null
  paymentReferenceNumber?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
  paymentRejectionReason?: string | null
  createdAt?: string | null
}

function formatPeso(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(Number(value || 0))
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function getPaymentStatus(payment: UserPayment) {
  const status = String(payment.status || '').toLowerCase()
  if (payment.paymentRejectionReason) {
    return { label: 'Needs attention', color: '#991b1b', background: '#fee2e2' }
  }
  if (status === 'payment_verified' || status === 'completed' || status === 'awaiting_customer_confirmation') {
    return { label: 'Paid', color: '#166534', background: '#dcfce7' }
  }
  if (status === 'payment_submitted') {
    return { label: 'Under review', color: '#8a5a16', background: '#fef3c7' }
  }
  return { label: 'Payment due', color: '#7f1d1d', background: '#fee2e2' }
}

export default function PurchasePage() {
  const [payments, setPayments] = useState<UserPayment[]>([])
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [query, setQuery] = useState('')

  const loadPayments = useCallback(async () => {
    setLoading(true)
    setErrorMessage('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setPayments([])
        setLoading(false)
        return
      }

      const [profileResult, paymentResult] = await Promise.all([
        supabase
          .from('users')
          .select('fullName, photoURL')
          .eq('id', session.user.id)
          .maybeSingle(),
        supabase
          .from('funeral_service_requests')
          .select('id, shopName, productName, variationName, status, paymentAmount, paymentPayerName, paymentGcashName, paymentReferenceNumber, paymentSubmittedAt, paymentVerifiedAt, paymentRejectionReason, createdAt')
          .eq('requesterId', session.user.id)
          .gt('paymentAmount', 0)
          .order('createdAt', { ascending: false }),
      ])

      if (paymentResult.error) throw paymentResult.error
      setProfile(profileResult.data ?? { fullName: session.user.email, photoURL: null })
      setPayments((paymentResult.data ?? []) as UserPayment[])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Payments could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPayments()
  }, [loadPayments])

  useEffect(() => {
    const refreshOnFocus = () => void loadPayments()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadPayments()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [loadPayments])

  const visiblePayments = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return payments
    return payments.filter(payment => [
      payment.productName,
      payment.shopName,
      payment.paymentReferenceNumber,
      payment.paymentPayerName,
    ].some(value => String(value || '').toLowerCase().includes(normalized)))
  }, [payments, query])

  return (
    <div className="purchase-shop-page">
      <AccountMobileHeader />

      <div className="purchase-topbar">
        <div className="purchase-topbar-inner">
          <div className="purchase-topbar-left"><Link to="/seller">Shop Center</Link></div>
          <div className="purchase-topbar-right">
            <Link to="/user/notifications">Notifications</Link>
            <Link to="/user/help">Help Centre</Link>
            <span className="purchase-divider">|</span>
            <div className="purchase-user-menu">
              <div className="purchase-user-menu-trigger">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Avatar" className="purchase-user-avatar" />
                ) : (
                  <div className="purchase-user-avatar-placeholder" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" /></svg>
                  </div>
                )}
                <span className="purchase-user-name">{profile?.fullName || 'User'}</span>
                <svg className="purchase-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <div className="purchase-user-dropdown">
                <Link to="/user/profile">My Account</Link>
                <Link to="/user/purchase">My Payments</Link>
                <Link to="/auth/switch-account">Switch Account</Link>
                <LogoutLink>Log out</LogoutLink>
              </div>
            </div>
          </div>
        </div>
      </div>

      <header className="purchase-header">
        <div className="purchase-header-inner">
          <BrandLogo to="/funeral" />
          <div className="purchase-header-divider" />
          <h1>My Payments</h1>
          <label className="purchase-search">
            <span className="sr-only">Search payments</span>
            <input
              type="search"
              placeholder="Search payments"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <span className="purchase-search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </span>
          </label>
        </div>
      </header>

      <main className="purchase-main">
        <div className="page-back-row purchase-page-nav"><PageBackButton to="/user/profile" /></div>

        <section className="payments-page-heading">
          <div>
            <h2>My Payments</h2>
            <p>Review payments for your service requests.</p>
          </div>
          <button type="button" className="payments-refresh" onClick={() => void loadPayments()} disabled={loading} aria-label="Refresh payments">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 11a8 8 0 1 0-2.34 5.66" /><polyline points="20 4 20 11 13 11" /></svg>
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </section>

        <div className="payments-section-header">
          <h2>Payment history</h2>
          <span>{visiblePayments.length} {visiblePayments.length === 1 ? 'record' : 'records'}</span>
        </div>

        {loading ? (
          <section className="payments-state" aria-live="polite">
            <span className="payments-spinner" aria-hidden="true" />
            <p>Loading your payments...</p>
          </section>
        ) : null}

        {!loading && errorMessage ? (
          <section className="payments-state">
            <span className="payments-state-icon" aria-hidden="true">!</span>
            <h2>Payments unavailable</h2>
            <p>Please check your connection and try again.</p>
            <button type="button" className="payments-retry" onClick={() => void loadPayments()}>Try again</button>
          </section>
        ) : null}

        {!loading && !errorMessage && payments.length === 0 ? (
          <section className="payments-state">
            <h2>No payments yet</h2>
            <p>Service request payments will appear here when a shop requests payment.</p>
          </section>
        ) : null}

        {!loading && !errorMessage && payments.length > 0 && visiblePayments.length === 0 ? (
          <section className="payments-state">
            <h2>No matching payments</h2>
            <p>Try another shop, service, sender, or reference number.</p>
          </section>
        ) : null}

        {!loading && !errorMessage ? (
          <div className="payments-list">
            {visiblePayments.map(payment => {
              const status = getPaymentStatus(payment)
              return (
                <article key={payment.id} className="payment-history-card">
                  <div className="payment-history-head">
                    <div className="payment-history-title">
                      <h3>{payment.productName || 'Funeral service'}</h3>
                      <p>{payment.shopName || 'Funeral shop'}{payment.variationName ? ` · ${payment.variationName}` : ''}</p>
                    </div>
                    <span className="payment-history-status" style={{ color: status.color, backgroundColor: status.background }}>{status.label}</span>
                  </div>

                  <div className="payment-history-amount">
                    <span>Amount</span>
                    <strong>{formatPeso(payment.paymentAmount)}</strong>
                  </div>

                  {payment.paymentReferenceNumber ? <DetailRow label="Reference number" value={payment.paymentReferenceNumber} /> : null}
                  {payment.paymentPayerName ? <DetailRow label="Paid by" value={payment.paymentPayerName} /> : null}
                  <DetailRow
                    label={payment.paymentVerifiedAt ? 'Verified' : payment.paymentSubmittedAt ? 'Submitted' : 'Created'}
                    value={formatDate(payment.paymentVerifiedAt || payment.paymentSubmittedAt || payment.createdAt)}
                  />

                  {payment.paymentRejectionReason ? (
                    <div className="payment-history-rejection">
                      <strong>Payment needs attention</strong>
                      <p>{payment.paymentRejectionReason}</p>
                    </div>
                  ) : null}

                  <Link to={`/user/requests/${payment.id}`} className="payment-history-request-link">
                    <span>View service request</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </Link>
                </article>
              )
            })}
          </div>
        ) : null}
      </main>
    </div>
  )
}

function DetailRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="payment-history-detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
