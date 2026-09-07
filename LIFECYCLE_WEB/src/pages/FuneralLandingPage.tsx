import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import BrandLogo from '@/components/BrandLogo'
import { loadFuneralCart } from '@/utils/funeralCart'
import './FuneralLandingPage.css'

/* â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
type Product = {
  id: string
  shopId: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  name: string
  description: string
  price: number
  stock: number
  category: string
  imageUrl: string | null
  galleryImageUrls: string[]
  variations: { id: string; name: string; imageUrl?: string | null }[]
}

type Shop = { id: string; shopName: string; generalLocation: string }

/* â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const SORT_OPTIONS = ['Relevance', 'Latest', 'Top Sales', 'Price']

/* â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function normalize(v: string | null | undefined) {
  return String(v ?? '').trim().toLowerCase()
}

function formatPeso(v: number | string | null | undefined): string {
  const num = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return v ? String(v) : '-'
  return `PHP ${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function getPrimaryImage(row: any): string | null {
  if (row.imageUrl) return row.imageUrl
  const gallery: any[] = row.funeral_product_images ?? []
  if (gallery.length > 0) {
    const sorted = [...gallery].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    if (sorted[0]?.imageUrl) return sorted[0].imageUrl
  }
  const vars: any[] = row.funeral_product_variations ?? []
  return vars.find(v => v.imageUrl)?.imageUrl ?? null
}

function resolveCategory(row: any): string {
  const n = normalize(row.name)
  if (n.includes('casket') || n.includes('coffin'))                                          return 'Caskets'
  if (n.includes('flower') || n.includes('bouquet') || n.includes('wreath') || n.includes('floral')) return 'Floral Tributes'
  if (n.includes('urn') || n.includes('memorial') || n.includes('candle'))                   return 'Urns & Memorial'
  if (n.includes('package') || n.includes('service') || n.includes('plan'))                  return 'Service Packages'
  if (n.includes('burial') || n.includes('interment'))                                       return 'Burial Needs'
  if (n.includes('chapel') || n.includes('hall') || n.includes('venue'))                     return 'Chapel Services'
  if (n.includes('transport') || n.includes('hearse'))                                       return 'Transportation'
  if (n.includes('keepsake') || n.includes('token'))                                         return 'Keepsakes'
  return 'Caskets'
}

/* â”€â”€ Star Rating â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function Stars({ rating = 4.8 }: { rating?: number }) {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  return (
    <span className="sp-stars">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < full ? 'sp-star full' : half && i === full ? 'sp-star half' : 'sp-star'}>{'\u2605'}</span>
      ))}
      <span className="sp-rating-num">{rating.toFixed(1)}</span>
    </span>
  )
}

/* â”€â”€ Casket placeholder icon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function CasketSVG() {
  return (
    <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="12" y="8" width="40" height="48" rx="3" />
      <path d="M12 22h40M22 8v14M42 8v14" />
      <rect x="27" y="30" width="10" height="6" rx="1" />
    </svg>
  )
}

/* â”€â”€ Cart Icon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function CartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  )
}

/* â”€â”€ Search Icon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   MAIN COMPONENT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
export default function FuneralLandingPage() {
  const [viewer,          setViewer]          = useState<User | null>(null)
  const [userProfile,     setUserProfile]     = useState<any>(null)
  const [products,        setProducts]        = useState<Product[]>([])
  const [shops,           setShops]           = useState<Shop[]>([])
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)
  const [cartCount, setCartCount] = useState(0)
  const navigate = useNavigate()

  /* Filters */
  const [queryText,        setQueryText]        = useState('')
  const [selectedShopId,   setSelectedShopId]   = useState('all')
  const [minPrice,         setMinPrice]          = useState('')
  const [maxPrice,         setMaxPrice]          = useState('')
  const [sortBy,           setSortBy]            = useState('Relevance')
  const [page,             setPage]              = useState(1)
  const PAGE_SIZE = 20

  /* Auth */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setViewer(data.session?.user ?? null)
      if (data.session?.user) {
        supabase.from('users').select('fullName, photoURL').eq('id', data.session.user.id).maybeSingle().then(({ data: profileData }) => {
          if (profileData) setUserProfile(profileData)
        })
      }
    })
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => {
      setViewer(s?.user ?? null)
      if (s?.user) {
        supabase.from('users').select('fullName, photoURL').eq('id', s.user.id).maybeSingle().then(({ data: profileData }) => {
          if (profileData) setUserProfile(profileData)
        })
      } else {
        setUserProfile(null)
      }
    })
    return () => l.subscription.unsubscribe()
  }, [])

   /* Load products */
  useEffect(() => {
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const { data, error: err } = await supabase
          .from('funeral_products')
          .select(`
            id, name, description, price, stock, "imageUrl", active, "shopId", "hasVariations",
            funeral_product_images ( "imageUrl", "displayOrder" ),
            funeral_product_variations ( id, name, "imageUrl" ),
            funeral_shops!inner ( "shopName", "shopAddress", "shopPhoneNumber", "generalLocation", status, "paidUntil" )
          `)
          .eq('active', true)
          .gt('stock', 0)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())

        if (err) throw err

        const rows = (data ?? []) as any[]
        const mapped: Product[] = rows.map(row => {
          const gallery = (row.funeral_product_images ?? []) as any[]
          const sortedGallery = [...gallery].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          const galleryUrls = sortedGallery.map((img: any) => img.imageUrl).filter((url: string) => Boolean(url))
          const variations = (row.funeral_product_variations ?? []) as any[]
           const variationList = variations.map((v: any) => ({
             id: String(v.id),
             name: String(v.name || 'Standard'),
             imageUrl: v.imageUrl ?? null,
           }))
          return {
            id:              String(row.id),
            shopId:          String(row.shopId ?? ''),
            shopName:        String(row.funeral_shops?.shopName ?? 'Verified Shop'),
            shopAddress:     String(row.funeral_shops?.shopAddress ?? ''),
            shopPhoneNumber: String(row.funeral_shops?.shopPhoneNumber ?? ''),
            name:            String(row.name ?? 'Untitled Product'),
            description:     String(row.description ?? ''),
            price:           Number(row.price) || 0,
            stock:           Number(row.stock) || 0,
            category:        resolveCategory(row),
            imageUrl:        getPrimaryImage(row),
            galleryImageUrls: galleryUrls,
            variations:      variationList,
          }
        })
        mapped.sort((a, b) => a.name.localeCompare(b.name))
        setProducts(mapped)

        // Build shop list
        const shopMap = new Map<string, Shop>()
        rows.forEach(row => {
          if (!shopMap.has(row.shopId)) {
            shopMap.set(row.shopId, {
              id: row.shopId,
              shopName: String(row.funeral_shops?.shopName ?? 'Shop'),
              generalLocation: String(row.funeral_shops?.generalLocation ?? row.funeral_shops?.shopAddress ?? ''),
            })
          }
        })
        setShops(Array.from(shopMap.values()).sort((a, b) => a.shopName.localeCompare(b.shopName)))
      } catch (e: any) {
        setError(e?.message ?? 'Unable to load products.')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  /* Derived filtered + sorted list */
  const filtered = useMemo(() => {
    const q   = normalize(queryText)
    const min = Number(minPrice) || 0
    const max = Number(maxPrice) || Infinity

    let list = products.filter(p => {
      const shopOk = selectedShopId === 'all' || p.shopId === selectedShopId
      const priceOk = p.price >= min && p.price <= max
      const qOk    = !q || normalize(`${p.name} ${p.description} ${p.shopName}`).includes(q)
      return shopOk && priceOk && qOk
    })

    if (sortBy === 'Price')      list = [...list].sort((a, b) => a.price - b.price)
    else if (sortBy === 'Latest') list = [...list].reverse()
    else if (sortBy === 'Top Sales') list = [...list].sort((a, b) => b.stock - a.stock)

    return list
  }, [products, queryText, selectedShopId, minPrice, maxPrice, sortBy])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function clearFilters() {
    setSelectedShopId('all')
    setMinPrice('')
    setMaxPrice('')
    setQueryText('')
    setSortBy('Relevance')
    setPage(1)
  }

  const isLoggedIn = Boolean(viewer)

  const refreshCartCount = () => {
    setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum, item) => sum + item.quantity, 0) : 0)
  }

  useEffect(() => {
    refreshCartCount()
    window.addEventListener('funeral-cart-updated', refreshCartCount)
    return () => window.removeEventListener('funeral-cart-updated', refreshCartCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])
  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <div className="sp-page">

      {/* â”€â”€ Topbar â”€â”€ */}
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left">
            <Link to="/seller">Seller Centre</Link>
            <span className="sp-divider">|</span>
            <span>Follow us on</span>
            <a href="#fb" aria-label="Facebook">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>
            </a>
            <a href="#ig" aria-label="Instagram">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor"/></svg>
            </a>
          </div>
          <div className="sp-topbar-right">
            <Link to="/user/notifications">Notifications</Link>
            <a href="#help">Help</a>
            <a href="#language">English</a>
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
                    <Link to="/auth/logout">Log out</Link>
                  </div>
                </div>
              )
              : <><Link to="/register" className="sp-signup">Sign Up</Link><Link to="/login">Login</Link></>}
          </div>
        </div>
      </div>

      {/* â”€â”€ Header â”€â”€ */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <BrandLogo to="/funeral" compact className="sp-brand-logo" />

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => { setQueryText(e.target.value); setPage(1) }}
                placeholder="Search for caskets..."
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" aria-label="Search">
                <SearchIcon />
              </button>
            </div>
            <div className="sp-trending">
              <button type="button" onClick={() => { setQueryText('Caskets'); setPage(1) }}>Caskets</button>
            </div>
          </div>

          <div className="sp-cart-area">
            <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Cart">
              <CartIcon />
              {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>

      {/* â”€â”€ Body â”€â”€ */}
      <div className="sp-body">
        <div className="sp-body-inner">

          {/* â”€â”€ Left Sidebar â”€â”€ */}
          <aside className="sp-sidebar">
            <div className="sp-sidebar-heading">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="11" y1="18" x2="20" y2="18"/></svg>
              SEARCH FILTER
            </div>

            {/* Shop Filter */}
            {shops.length > 0 && (
              <div className="sp-filter-block">
                <button type="button" className="sp-filter-shops-link" onClick={() => navigate('/funeral/shops')}>
                  Funeral Shops
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <label className="sp-checkbox-row">
                  <input type="radio" name="shop" checked={selectedShopId === 'all'} onChange={() => { setSelectedShopId('all'); setPage(1) }} />
                  <span>All Verified Shops</span>
                </label>
                {shops.map(s => (
                  <label key={s.id} className="sp-checkbox-row">
                    <input type="radio" name="shop" checked={selectedShopId === s.id} onChange={() => { setSelectedShopId(s.id); setPage(1) }} />
                    <span>{s.shopName}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Price Range */}
            <div className="sp-filter-block">
              <div className="sp-filter-title">Price Range</div>
              <div className="sp-price-row">
                <input
                  type="number"
                  placeholder="PHP MIN"
                  value={minPrice}
                  onChange={e => { setMinPrice(e.target.value); setPage(1) }}
                  className="sp-price-input"
                />
                <span className="sp-price-dash">-</span>
                <input
                  type="number"
                  placeholder="PHP MAX"
                  value={maxPrice}
                  onChange={e => { setMaxPrice(e.target.value); setPage(1) }}
                  className="sp-price-input"
                />
              </div>
              <button
                type="button"
                className="sp-apply-btn"
                onClick={() => setPage(1)}
              >
                APPLY
              </button>
            </div>

            {/* Rating */}
            <div className="sp-filter-block">
              <div className="sp-filter-title">Rating</div>
              {[5, 4, 3, 2, 1].map(r => (
                <div key={r} className="sp-rating-row">
                  {Array.from({ length: 5 }, (_, i) => (
                    <span key={i} className={i < r ? 'sp-star full' : 'sp-star'}>{'\u2605'}</span>
                  ))}
                  <span className="sp-rating-up">&amp; Up</span>
                </div>
              ))}
            </div>

            <button type="button" className="sp-clear-btn" onClick={clearFilters}>
              CLEAR ALL
            </button>
          </aside>

          {/* â”€â”€ Main Content â”€â”€ */}
          <main className="sp-main">

            {/* Search result header */}
            <div className="sp-result-label">
              {queryText
                ? <>Search results for <strong>'{queryText}'</strong></>
                : <>All <strong>Funeral Products</strong></>}
            </div>

            {/* Sort bar */}
            <div className="sp-sort-bar">
              <span className="sp-sort-label">Sort by</span>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt}
                  className={`sp-sort-btn${sortBy === opt ? ' active' : ''}`}
                  onClick={() => { setSortBy(opt); setPage(1) }}
                >
                  {opt}
                </button>
              ))}
              <div className="sp-pagination-label">
                {!loading && <><span className="sp-page-cur">{page}</span>/<span>{totalPages}</span></>}
              </div>
              <div className="sp-page-btns">
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{'\u2039'}</button>
                <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>{'\u203A'}</button>
              </div>
            </div>

            {/* States */}
            {loading && (
              <div className="sp-state">
                <div className="sp-spinner" />
                <p>Loading products...</p>
              </div>
            )}
            {!loading && error && (
              <div className="sp-state sp-state-error">{error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div className="sp-state">
                <CasketSVG />
                <p>No products found. Try adjusting your filters.</p>
                <button className="sp-apply-btn" style={{ marginTop: 12 }} onClick={clearFilters}>Clear Filters</button>
              </div>
            )}

            {/* Product Grid */}
            {!loading && !error && (
              <div className="sp-grid">
                {paginated.map(product => (
                  <article
                    key={`${product.shopId}_${product.id}`}
                    className="sp-card"
                     onClick={() => navigate(`/funeral/product/${product.id}`)}
                  >
                    <div className="sp-card-img-wrap">
                      {product.imageUrl
                        ? <img src={product.imageUrl} alt={product.name} loading="lazy" />
                        : <div className="sp-card-img-ph"><CasketSVG /></div>}
                      <span className="sp-verified-badge">Verified</span>
                    </div>

                    <div className="sp-card-body">
                      <p className="sp-card-name">{product.name}</p>
                      <div className="sp-card-price-row">
                        <span className="sp-card-price">{formatPeso(product.price)}</span>
                      </div>
                      <div className="sp-card-meta">
                        <Stars rating={4.8} />
                        <span className="sp-card-stock">{product.stock} left</span>
                      </div>
                      <p className="sp-card-location">{product.shopName}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Bottom pagination */}
            {!loading && totalPages > 1 && (
              <div className="sp-bottom-pagination">
                <button disabled={page <= 1} onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 300) }}>{'\u2039'}</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                  <button
                    key={n}
                    className={n === page ? 'active' : ''}
                    onClick={() => { setPage(n); window.scrollTo(0, 300) }}
                  >
                    {n}
                  </button>
                ))}
                <button disabled={page >= totalPages} onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 300) }}>{'\u203A'}</button>
              </div>
            )}


          </main>
        </div>
      </div>

      {/* â”€â”€ Footer â”€â”€ */}
      <footer className="sp-footer">
        <div className="sp-footer-top">
          <div>
            <h4>CUSTOMER SERVICE</h4>
            <Link to="/user/help">Help Centre</Link>
            <a href="#payment">Payment Methods</a>
            <a href="#return">Return &amp; Refund</a>
            <a href="#guarantee">LifeCycle Guarantee</a>
            <Link to="/user/contact">Contact Us</Link>
          </div>
          <div>
            <h4>ABOUT LIFECYCLE</h4>
            <Link to="/user/about">About Us</Link>
            <a href="#careers">Careers</a>
            <Link to="/policies">Policies</Link>
            <Link to="/privacy-policy">Privacy Policy</Link>
            <Link to="/seller">Seller Centre</Link>
          </div>
          <div>
            <h4>PAYMENT</h4>
            <div className="sp-footer-badges">
              <span className="sp-badge">GCash</span>
              <span className="sp-badge">Maya</span>
              <span className="sp-badge">Visa</span>
              <span className="sp-badge">Mastercard</span>
              <span className="sp-badge">COD</span>
            </div>
            <h4 style={{ marginTop: 16 }}>LOGISTICS</h4>
            <div className="sp-footer-badges">
              <span className="sp-badge">LBC</span>
              <span className="sp-badge">J&amp;T</span>
              <span className="sp-badge">Flash</span>
              <span className="sp-badge">2GO</span>
            </div>
          </div>
          <div>
            <h4>FOLLOW US</h4>
            <a href="#fb">Facebook</a>
            <a href="#ig">Instagram</a>
            <a href="#yt">YouTube</a>
          </div>
        </div>
        <div className="sp-footer-bottom">
          <span>(c) {new Date().getFullYear()} LifeCycle Funeral Services Philippines. All Rights Reserved.</span>
          <span>Philippines - Metro Manila - Nationwide</span>
        </div>
       </footer>
     </div>
   )
 }








