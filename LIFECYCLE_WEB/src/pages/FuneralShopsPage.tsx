import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import NotificationDropdown from '@/components/NotificationDropdown'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import LogoutLink from '@/components/LogoutLink'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart } from '@/utils/funeralCart'
import './FuneralLandingPage.css'
import './FuneralShopsPage.css'

const HeaderCartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
)
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
)

type ShopRecord = {
  id: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  shopImageUrl: string | null
  businessName: string
  generalLocation: string
  productCount: number
}

export default function FuneralShopsPage() {
  const navigate = useNavigate()
  const [viewer, setViewer] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [shops, setShops] = useState<ShopRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cartCount, setCartCount] = useState(0)
  const [queryText, setQueryText] = useState('')
  const isLoggedIn = Boolean(viewer)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewer(data.session?.user ?? null))
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setViewer(s?.user ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (viewer?.id) {
      supabase.from('users').select('fullName, photoURL').eq('id', viewer.id).maybeSingle().then(({ data }) => setUserProfile(data))
    } else {
      setUserProfile(null)
    }
  }, [viewer?.id])

  const refreshCartCount = () => {
    setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum, item) => sum + item.quantity, 0) : 0)
  }

  useEffect(() => {
    refreshCartCount()
    window.addEventListener('funeral-cart-updated', refreshCartCount)
    return () => window.removeEventListener('funeral-cart-updated', refreshCartCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await supabase
          .from('funeral_shops')
          .select('id, shopName, shopAddress, shopPhoneNumber, shopImageUrl, businessName, generalLocation')
          .eq('status', 'live')
          .gt('paidUntil', new Date().toISOString())
          .order('shopName', { ascending: true })

        if (err) throw err
        const shopRows = data ?? []
        const productCounts = new Map<string, number>()
        const shopIds = shopRows.map(row => String(row.id))

        if (shopIds.length > 0) {
          const { data: productRows } = await supabase
            .from('funeral_products')
            .select('shopId')
            .in('shopId', shopIds)
            .eq('active', true)
            .gt('stock', 0)

          for (const product of productRows ?? []) {
            const shopId = String(product.shopId)
            productCounts.set(shopId, (productCounts.get(shopId) ?? 0) + 1)
          }
        }

        setShops(shopRows.map((row: any) => ({
          id: String(row.id),
          shopName: String(row.shopName || ''),
          shopAddress: String(row.shopAddress || ''),
          shopPhoneNumber: String(row.shopPhoneNumber || ''),
          shopImageUrl: row.shopImageUrl || null,
          businessName: String(row.businessName || ''),
          generalLocation: String(row.generalLocation || ''),
          productCount: productCounts.get(String(row.id)) ?? 0,
        })))
      } catch (e: any) {
        setError(e?.message ?? 'Unable to load shops.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const filtered = shops.filter(s => {
    const q = String(queryText ?? '').trim().toLowerCase()
    return !q || `${s.shopName} ${s.businessName} ${s.generalLocation} ${s.shopAddress}`.toLowerCase().includes(q)
  })

  return (
    <div className="sp-page funeral-shops-page">
      {/* ── Topbar ── */}
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left">
            <Link to="/seller">Shop Center</Link>
          </div>
          <div className="sp-topbar-right">
            <AnnouncementDropdown />
            <NotificationDropdown />
            <Link to="/user/help">Help Centre</Link>
            <span className="sp-divider">|</span>
            {isLoggedIn
              ? (
                <div className="sp-user-menu">
                  <div className="sp-user-menu-trigger">
                    {userProfile?.photoURL ? (
                      <img src={userProfile.photoURL} alt="Avatar" className="sp-user-avatar" />
                    ) : (
                      <div className="sp-user-avatar-placeholder">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                      </div>
                    )}
                    <span className="sp-user-name">{userProfile?.fullName || viewer?.email}</span>
                    <svg className="sp-user-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div className="sp-user-dropdown">
                    <Link to="/user/profile">My Account</Link>
                    <Link to="/user/purchase">Purchases</Link>
                    <Link to="/auth/switch-account" className="sp-dropdown-switch">Switch Account</Link>
                    <LogoutLink>Log out</LogoutLink>
                  </div>
                </div>
              )
              : <><Link to="/register" className="sp-signup">Sign Up</Link><Link to="/login">Login</Link></>}
          </div>
        </div>
      </div>

      {/* ── Header ── */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <h1 className="fsp-mobile-page-title">Shops</h1>
          <BrandLogo />

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && navigate(`/funeral?search=${encodeURIComponent(queryText)}`)}
                placeholder="Search funeral products"
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" onClick={() => navigate(`/funeral?search=${encodeURIComponent(queryText)}`)} aria-label="Search">
                <SearchIcon />
              </button>
            </div>
          </div>

          <div className="sp-cart-area">
            <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Shopping cart" title="Shopping cart">
              <HeaderCartIcon />
              {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>

      <div className="sp-container">
        <div className="page-back-row"><PageBackButton /></div>

        <div className="fsp-hero">
          <h1>
            <span className="fsp-desktop-copy">Funeral shops</span>
            <span className="fsp-mobile-copy">Find the right funeral shop</span>
          </h1>
          <p>
            <span className="fsp-desktop-copy">Browse active funeral shops and view their available products and contact details.</span>
            <span className="fsp-mobile-copy">Browse active funeral shops and their available products.</span>
          </p>
          <div className="fsp-hero-pill">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span className="fsp-desktop-copy">
            {loading ? 'Loading…' : `${shops.length} available ${shops.length === 1 ? 'shop' : 'shops'}`}
            </span>
            <span className="fsp-mobile-copy">
              {loading ? 'Loading...' : shops.length + ' active ' + (shops.length === 1 ? 'shop' : 'shops')}
            </span>
          </div>
        </div>
        <div className="fsp-mobile-search">
          <SearchIcon />
          <input type="search" value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Search by shop or location" aria-label="Search by shop or location" />
          {queryText ? (
            <button type="button" onClick={() => setQueryText('')} aria-label="Clear shop search">&times;</button>
          ) : null}
        </div>


        {loading ? (
          <div className="fsp-state">
            <div className="sp-spinner" />
            <p>Loading shops…</p>
          </div>
        ) : error ? (
          <div className="fsp-state fsp-state-error">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="fsp-state">
            <p>{queryText ? 'No shops match your search.' : 'No funeral shops are currently available.'}</p>
            {queryText ? <button type="button" className="fsp-clear-search" onClick={() => setQueryText('')}>Clear search</button> : null}
          </div>
        ) : (
          <div className="fsp-list">
            {filtered.map(shop => (
              <article key={shop.id} className="fsp-card">
                {shop.shopImageUrl ? (
                  <img src={shop.shopImageUrl} alt={shop.shopName} className="fsp-card-img" />
                ) : (
                  <div className="fsp-card-img fsp-card-img-fallback">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22312d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9v11h16V9M3 9l2-6h14l2 6M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6" /></svg>
                  </div>
                )}

                <div className="fsp-card-body">
                  <div className="fsp-card-name">{shop.shopName}</div>
                  <div className="fsp-card-meta">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    {shop.generalLocation || shop.shopAddress || 'Location not available'}
                  </div>
                  {shop.shopPhoneNumber ? (
                    <div className="fsp-card-meta">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      {shop.shopPhoneNumber}
                    </div>
                  ) : null}
                  {shop.businessName ? <div className="fsp-card-business">{shop.businessName}</div> : null}
                </div>
                <div className="fsp-card-inventory">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8V6a6 6 0 0 1 12 0v2M4 8h16l1 13H3L4 8Z" /></svg>
                  <span>
                    <strong>{shop.productCount}</strong> available &middot; <strong>{shop.productCount}</strong> {shop.productCount === 1 ? 'product' : 'products'}
                  </span>
                </div>

                <Link className="fsp-card-btn" to={`/shop/${shop.id}`}>
                  <span className="fsp-card-btn-desktop">View products</span>
                  <span className="fsp-card-btn-mobile">Browse Catalog</span>
                  <span className="fsp-card-btn-arrow" aria-hidden="true">&rarr;</span>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
