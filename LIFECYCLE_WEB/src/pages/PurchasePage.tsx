import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { loadFuneralPurchases, type WebFuneralPurchase } from '@/utils/funeralPurchase'
import BrandLogo from '@/components/BrandLogo'
import './PurchasePage.css'

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function groupByShop(purchases: WebFuneralPurchase[]) {
  const groups = new Map<string, WebFuneralPurchase[]>()
  purchases.forEach(purchase => {
    const key = purchase.items[0]?.shopId || purchase.items[0]?.shopName || 'shop'
    groups.set(key, [...(groups.get(key) ?? []), purchase])
  })
  return Array.from(groups.entries()).map(([shopId, shopPurchases]) => ({
    shopId,
    shopName: shopPurchases[0]?.items[0]?.shopName || 'Funeral Shop',
    purchases: shopPurchases,
  }))
}

export default function PurchasePage() {
  const navigate = useNavigate()
  const [purchases, setPurchases] = useState<WebFuneralPurchase[]>(() => loadFuneralPurchases())
  const [profile, setProfile] = useState<ViewerProfile | null>(null)

  const refreshPurchases = () => {
    setPurchases(loadFuneralPurchases())
  }

  useEffect(() => {
    window.addEventListener('funeral-purchase-updated', refreshPurchases)
    return () => window.removeEventListener('funeral-purchase-updated', refreshPurchases)
  }, [])

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const { data } = await supabase.from('users').select('fullName, photoURL').eq('id', session.user.id).maybeSingle()
      setProfile(data ?? { fullName: session.user.email, photoURL: null })
    }
    void loadProfile()
  }, [])

  const groupedPurchases = useMemo(() => groupByShop(purchases), [purchases])
  const totalSpent = purchases.reduce((sum, p) => sum + p.total, 0)

  const statusLabel: Record<WebFuneralPurchase['status'], string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    processing: 'Processing',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }

  return (
    <div className="purchase-shop-page">
      <div className="purchase-topbar">
        <div className="purchase-topbar-inner">
          <div className="purchase-topbar-left">
            <Link to="/seller">Seller Centre</Link>
          </div>
          <div className="purchase-topbar-right">
            <Link to="/user/notifications">Notifications</Link>
            <Link to="/user/help">Help Centre</Link>
            <span className="purchase-divider">|</span>
            <div className="purchase-user-menu">
              <div className="purchase-user-menu-trigger">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Avatar" className="purchase-user-avatar" />
                ) : (
                  <div className="purchase-user-avatar-placeholder">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" /></svg>
                  </div>
                )}
                <span className="purchase-user-name">{profile?.fullName || 'User'}</span>
                <svg className="purchase-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              </div>
              <div className="purchase-user-dropdown">
                <Link to="/user/profile">My Account</Link>
                <Link to="/user/purchase">Purchases</Link>
                <Link to="/auth/switch-account">Switch Account</Link>
                <Link to="/auth/logout">Log out</Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <header className="purchase-header">
        <div className="purchase-header-inner">
          <BrandLogo to="/" />
          <div className="purchase-header-divider" />
          <h1>My Purchases</h1>
          <div className="purchase-search">
            <input type="search" placeholder="Search purchase orders" />
            <button type="button" aria-label="Search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="purchase-main">
        <div className="purchase-page-nav">
          <button type="button" className="purchase-back-btn" onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
            Back
          </button>
        </div>

        {purchases.length === 0 ? (
          <section className="purchase-empty-state">
            <h2>No Purchases Yet</h2>
            <p>Your funeral service orders and item purchases will appear here.</p>
            <Link to="/funeral" className="purchase-checkout-btn">Browse Products</Link>
          </section>
        ) : groupedPurchases.map(group => (
          <section key={group.shopId} className="purchase-shop-card">
            <div className="purchase-shop-row">
              <span className="purchase-preferred">Preferred</span>
              <strong>{group.shopName}</strong>
            </div>

            {group.purchases.map(purchase => (
              <article key={purchase.orderId} className="purchase-order-card">
                <div className="purchase-order-header">
                  <span className="purchase-order-id">Order #{purchase.orderId.slice(0, 8)}</span>
                  <span className={`purchase-order-status status-${purchase.status}`}>{statusLabel[purchase.status]}</span>
                  <span className="purchase-order-date">{formatDate(purchase.createdAt)}</span>
                </div>

                <div className="purchase-order-items">
                  {purchase.items.map(item => (
                    <div key={item.cartId} className="purchase-order-item">
                      <div className="purchase-item-image">
                        {item.imageUrl ? <img src={item.imageUrl} alt={item.name} /> : <span>LC</span>}
                      </div>
                        <div className="purchase-item-info">
                          <h2>{item.name}</h2>
                          {item.variationName ? (
                            <p>{item.shopName}{' \u00b7 '}Variation: {item.variationName}{' \u00b7 '}Qty: {item.quantity}</p>
                          ) : (
                            <p>{item.shopName}{' \u00b7 '}Qty: {item.quantity}</p>
                          )}
                        </div>
                      <span className="purchase-item-total">{formatPeso(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>

                <div className="purchase-order-footer">
                  <strong>Order Total:</strong>
                  <span className="purchase-order-total">{formatPeso(purchase.total)}</span>
                </div>
              </article>
            ))}
          </section>
        ))}
      </main>

      <footer className="purchase-sticky-footer">
        <span className="purchase-footer-spacer" />
        <strong>Total Spent: <span>{formatPeso(totalSpent)}</span></strong>
        <span className="purchase-footer-count">{purchases.length} order{purchases.length === 1 ? '' : 's'}</span>
      </footer>
    </div>
  )
}
