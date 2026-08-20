import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import PaymentQrCard from '@/components/PaymentQrCard'
import './SellerCentrePage.css'

export default function SellerPaymentPage() {
  const navigate = useNavigate()
  const [authReady, setAuthReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isVerified, setIsVerified] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null
      setIsLoggedIn(Boolean(user))
      if (user) {
        const { data: shopData } = await supabase
          .from('funeral_shops')
          .select('status')
          .eq('id', user.id)
          .maybeSingle()
        setIsVerified(Boolean(shopData) && (shopData?.status === 'verified' || shopData?.status === 'live' || shopData?.status === 'offline'))
      }
      setAuthReady(true)
      setLoading(false)
    })
  }, [])

  if (!authReady || loading) {
    return (
      <div className="sc-page">
        <div className="sc-state">
          <div className="sc-spinner" />
          <p>Loading payment page…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="sc-page">
      <header className="sc-header-bar">
        <div className="sc-header-left">
          <Link to="/seller" className="sc-logo-area">
            <div className="sc-logo-box">LC</div>
            <span className="sc-logo-text">
              LifeCycle <span className="sc-logo-sub">Shop Payment</span>
            </span>
          </Link>
        </div>
        <div className="sc-header-right">
          <button className="sc-btn sc-btn-secondary" onClick={() => navigate('/seller')}>
            Back to Seller Centre
          </button>
        </div>
      </header>

      <div className="sc-workspace">
        <main className="sc-content-area">
          {!isLoggedIn ? (
            <div className="sc-access-denied">
              <div className="sc-access-denied-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0110 0v4"></path>
                </svg>
              </div>
              <h2 className="sc-access-denied-title">Access Denied</h2>
              <p className="sc-access-denied-desc">You need to be logged in as a funeral shop owner to pay your registration fee.</p>
              <div className="sc-access-denied-actions">
                <button className="sc-access-denied-back" onClick={() => navigate('/seller')}>Go Back</button>
                <Link to="/login" className="sc-access-denied-login">Login to Continue</Link>
              </div>
            </div>
          ) : !isVerified ? (
            <div className="sc-state" style={{ textAlign: 'center', padding: '60px 20px', maxWidth: '420px', margin: '0 auto' }}>
              <h2>Payment Not Yet Available</h2>
              <p style={{ color: '#666', marginTop: '12px', marginBottom: '24px' }}>
                Registration payment is only available once your shop has been verified. Once approved, you can pay here and go live.
              </p>
              <button className="sc-primary-btn" onClick={() => navigate('/seller')}>Back to Seller Centre</button>
            </div>
          ) : (
            <div className="sc-payment-layout">
              <PaymentQrCard onSuccess={() => navigate('/seller')} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
