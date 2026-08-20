import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { loadFuneralPurchases, type WebFuneralPurchase } from '@/utils/funeralPurchase'
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
        <div className="purchase-topbar-left">
          <button type="button" className="purchase-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Back
          </button>
          <Link to="/seller">Seller Centre</Link>
          <span>|</span>
          <a href="#start-selling">Start Selling</a>
          <span>|</span>
          <span>Follow us on</span>
          <a href="#facebook" aria-label="Facebook">?</a>
          <a href="#instagram" aria-label="Instagram">?</a>
        </div>
        <div className="purchase-topbar-right">
          <Link to="/user/notifications">Notifications</Link>
          <a href="#help">Help</a>
          <a href="#language">English?</a>
          <span className="purchase-topbar-user">{profile?.fullName || 'User'}</span>
        </div>
      </div>

      <header className="purchase-header">
        <Link to="/funeral" className="purchase-brand" aria-label="LifeCycle home">
          <span className="purchase-logo-bag">LC</span>
          <span className="purchase-brand-name">LifeCycle</span>
        </Link>
        <div className="purchase-header-divider" />
        <h1>My Purchases</h1>
        <div className="purchase-search">
          <input type="search" placeholder="Search purchase orders" />
          <button type="button" aria-label="Search">?</button>
        </div>
      </header>

      <main className="purchase-main">
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
                            <p>{item.shopName} · Variation: {item.variationName} · Qty: {item.quantity}</p>
                          ) : (
                            <p>{item.shopName} · Qty: {item.quantity}</p>
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