import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart } from '@/utils/funeralCart'
import type { User } from '@supabase/supabase-js'
import './ShopPage.css'

// Icons
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

export default function ShopPage() {
  const { shopId } = useParams()
  const navigate = useNavigate()

  const [shop, setShop] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [activeTab, setActiveTab] = useState('Shop')
  const [activeCategory, setActiveCategory] = useState('All Products')
  const [sortBy, setSortBy] = useState('Relevance')

  const [isFollowing, setIsFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)

  const [viewer, setViewer] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [cartCount, setCartCount] = useState(() =>
    loadFuneralCart().reduce((sum: number, item: any) => sum + item.quantity, 0)
  )
  const [queryText, setQueryText] = useState('')
  const isLoggedIn = Boolean(viewer)

  const [prevViewerId, setPrevViewerId] = useState<string | null>(viewer?.id ?? null)
  if (prevViewerId !== (viewer?.id ?? null)) {
    setPrevViewerId(viewer?.id ?? null)
    setUserProfile(null)
  }

  const [prevShopId, setPrevShopId] = useState<string | undefined>(shopId)
  if (prevShopId !== shopId) {
    setPrevShopId(shopId)
    setLoading(true)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewer(data.session?.user ?? null))
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setViewer(s?.user ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!viewer?.id) return
    supabase.from('users').select('*').eq('id', viewer.id).single().then(({ data }) => setUserProfile(data))
  }, [viewer?.id])

  useEffect(() => {
    const refreshCart = () => {
      setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum: number, item: any) => sum + item.quantity, 0) : 0)
    }
    window.addEventListener('funeral-cart-updated', refreshCart)
    return () => window.removeEventListener('funeral-cart-updated', refreshCart)
  }, [isLoggedIn])

  useEffect(() => {
    if (!shopId) return
    
    Promise.all([
      supabase.from('funeral_shops').select('*').eq('id', shopId).eq('status', 'live').gt('paidUntil', new Date().toISOString()).maybeSingle(),
      supabase.from('funeral_products').select('id, name, price, "imageUrl", stock').eq('shopId', shopId).eq('active', true)
    ]).then(([ { data: shopData, error: shopErr }, { data: prodData, error: prodErr } ]) => {
      setLoading(false)
      if (shopErr) {
        setError(shopErr.message)
        return
      }
      if (!shopData) {
        setError('Shop not found.')
        return
      }
      setShop(shopData)
      if (!prodErr && prodData) {
        setProducts(prodData)
      }
    })
  }, [shopId])

  // Load follow state & count
  useEffect(() => {
    if (!shopId) return
    // Get follower count
    supabase
      .from('shop_follows')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shopId)
      .then(({ count }) => setFollowerCount(count ?? 0))

    // Check if current user follows this shop
    if (viewer?.id) {
      supabase
        .from('shop_follows')
        .select('id')
        .eq('shopId', shopId)
        .eq('userId', viewer.id)
        .maybeSingle()
        .then(({ data }) => setIsFollowing(!!data))
    }
  }, [shopId, viewer?.id])

  const handleFollow = async () => {
    if (!viewer) {
      navigate('/login', { state: { returnTo: location.pathname } })
      return
    }
    if (followLoading || !shopId) return
    setFollowLoading(true)

    if (isFollowing) {
      // Unfollow
      await supabase
        .from('shop_follows')
        .delete()
        .eq('shopId', shopId)
        .eq('userId', viewer.id)
      setIsFollowing(false)
      setFollowerCount(prev => Math.max(0, prev - 1))
    } else {
      // Follow
      await supabase
        .from('shop_follows')
        .insert({ userId: viewer.id, shopId })
      setIsFollowing(true)
      setFollowerCount(prev => prev + 1)
    }
    setFollowLoading(false)
  }

  if (loading) {
    return (
      <div className="sp-bg" style={{ minHeight: '100vh' }}>
        <div className="sp-container" style={{textAlign: 'center', padding: '100px 0'}}>Loading shop...</div>
      </div>
    )
  }

  if (error || !shop) {
    return (
      <div className="sp-bg" style={{ minHeight: '100vh' }}>
        <div className="sp-container" style={{textAlign: 'center', padding: '100px 0', color: 'red'}}>{error || 'Shop not found.'}</div>
      </div>
    )
  }

  const handleOpenChat = () => {
    window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: shop.id } }))
  }
  
  const joinedDate = new Date(shop.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  
  // Calculate relative time (mocked for "Active X hours ago" since we don't have real-time presence yet)
  const activeAgo = '2 hours ago'
  const recommendedProducts = products.slice(0, 6)
  const topProducts = [...products].sort((a, b) => Number(b.stock) - Number(a.stock)).slice(0, 6)

  return (
    <div className="sp-bg">
      {/* ── Topbar ── */}
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

      {/* ── Header ── */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <Link to="/funeral" className="sp-logo" aria-label="LifeCycle Home">
            <div className="sp-logo-box">LC</div>
            <span>LifeCycle</span>
          </Link>

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && navigate(`/funeral?search=${encodeURIComponent(queryText)}`)}
                placeholder="Search in this shop..."
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" onClick={() => navigate(`/funeral?search=${encodeURIComponent(queryText)}`)} aria-label="Search">
                <SearchIcon />
              </button>
            </div>
            <div className="sp-trending">
              {['Caskets', 'Floral Tributes', 'Urns', 'Memorial Package', 'Burial Needs'].map(t => (
                <button key={t} onClick={() => navigate(`/funeral?search=${encodeURIComponent(t)}`)}>{t}</button>
              ))}
            </div>
          </div>

          <div className="sp-cart-area">
            <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Cart">
              <HeaderCartIcon />
              {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
            </Link>
          </div>
        </div>
      </header>

        <div className="sp-container">
          
          <button 
            onClick={() => navigate(-1)} 
            style={{ 
              marginBottom: '16px', 
              background: 'transparent', 
              border: 'none', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              color: '#666',
              fontSize: '14px',
              fontWeight: '500',
              padding: '0'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back
          </button>

          {/* Top Banner */}
          <div className="sp-banner">
            <div className="sp-banner-top">
              
              {/* Profile Card */}
              <div className="sp-banner-profile" style={shop.shopImageUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url(${shop.shopImageUrl})` } : {}}>
                <div className="sp-profile-info">
                  <img src={shop.shopImageUrl || '/placeholder.png'} alt="Shop" className="sp-profile-avatar" />
                  <div className="sp-profile-text">
                    <div className="sp-profile-name">{shop.shopName}</div>
                    <div className="sp-profile-active">Active {activeAgo}</div>
                  </div>
                </div>
                <div className="sp-profile-actions">
                  <button 
                    className={`sp-btn-action ${isFollowing ? 'sp-btn-following' : ''}`}
                    onClick={handleFollow}
                    disabled={followLoading}
                  >
                    {isFollowing ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        Following
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Follow
                      </>
                    )}
                  </button>
                  <button className="sp-btn-action" onClick={handleOpenChat}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    Chat
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="sp-banner-stats">
                <div className="sp-stats-grid">
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                    <span className="sp-stat-label">Products:</span>
                    <span className="sp-stat-value">{products.length}</span>
                  </div>
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                    <span className="sp-stat-label">Followers:</span>
                    <span className="sp-stat-value">{followerCount}</span>
                  </div>
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <span className="sp-stat-label">Following:</span>
                    <span className="sp-stat-value">0</span>
                  </div>
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    <span className="sp-stat-label">Rating:</span>
                    <span className="sp-stat-value">0.0 (0 Rating)</span>
                  </div>
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    <span className="sp-stat-label">Chat Performance:</span>
                    <span className="sp-stat-value">100% (Within Hours)</span>
                  </div>
                  <div className="sp-stat-item">
                    <svg className="sp-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    <span className="sp-stat-label">Joined:</span>
                    <span className="sp-stat-value">{joinedDate}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="sp-tabs">
              {['Shop', 'Products', 'Categories', 'Reviews'].map(tab => (
                <div 
                  key={tab} 
                  className={`sp-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'Products' ? <><span>{tab}</span><span className="sp-new-badge">New</span></> : tab}
                </div>
              ))}
            </div>
          </div>

          {activeTab === 'Shop' ? (
            <div className="sp-shop-home">
              {[
                ['Recommended For You', recommendedProducts],
                ['Top Products', topProducts],
              ].map(([title, items]) => (
                <section className="sp-shop-section" key={String(title)}>
                  <div className="sp-shop-section-heading"><h2>{title}</h2><button onClick={() => setActiveTab('Products')}>See More ›</button></div>
                  <div className="sp-shop-product-row">
                    {(items as any[]).map(product => (
                      <article key={product.id} className="sp-shop-product-card" onClick={() => navigate(`/funeral/product/${product.id}`)}>
                        <img src={product.imageUrl || '/placeholder.png'} alt={product.name} />
                        <strong>{product.name}</strong>
                        <span>₱{Number(product.price).toLocaleString()}</span>
                        <small>{Number(product.stock) > 0 ? `${product.stock} available` : 'Ask shop'}</small>
                      </article>
                    ))}
                  </div>
                  {products.length === 0 ? <div className="sp-empty">This shop has no products yet.</div> : null}
                </section>
              ))}
              <section className="sp-shop-service"><div className="sp-shop-service-icon">✦</div><div><small>PERSONALISED SERVICE</small><h2>Need a custom casket arrangement?</h2><p>Contact this shop to discuss materials, finishes, and memorial details.</p></div><button onClick={handleOpenChat}>Chat with shop ›</button></section>
            </div>
          ) : null}

          {activeTab === 'Products' ? <div className="sp-content">
            <div className="sp-sidebar">
              <div className="sp-cat-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                Category
              </div>
              <div className="sp-cat-list">
                {['All Products', 'Others'].map(cat => (
                  <div key={cat} className={`sp-cat-item ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>{cat}</div>
                ))}
              </div>
            </div>

            <div className="sp-main">
              {activeTab === 'Products' ? (
                <div className="sp-sort-bar">
                  <span className="sp-sort-label">Sort by</span>
                  {['Relevance', 'Latest', 'Top Sales', 'Price'].map(sort => (
                    <button key={sort} className={`sp-sort-btn ${sortBy === sort ? 'active' : ''}`} onClick={() => setSortBy(sort)}>{sort}</button>
                  ))}
                  <div className="sp-sort-right">
                    <div className="sp-page-info"><span className="sp-page-cur">1</span>/1</div>
                    <div className="sp-page-nav"><button disabled>{'\u2039'}</button><button disabled>{'\u203A'}</button></div>
                  </div>
                </div>
              ) : null}

              <div className="sp-grid">
                {products.length === 0 ? <div className="sp-empty">This shop has no products yet.</div> : products.map(product => (
                  <div key={product.id} className="sp-product-card" onClick={() => navigate(`/funeral/product/${product.id}`)}>
                    <img src={product.imageUrl || '/placeholder.png'} alt={product.name} className="sp-product-img" />
                    <div className="sp-product-info"><div className="sp-product-name">{product.name}</div><div className="sp-product-bottom"><span className="sp-product-price">₱{Number(product.price).toLocaleString()}</span><span className="sp-product-sold">0 sold</span></div></div>
                  </div>
                ))}
              </div>
            </div>
          </div> : null}

          {activeTab === 'Categories' ? (
            <section className="sp-tab-panel sp-category-panel">
              <div className="sp-tab-panel-heading"><div><h2>Shop Categories</h2><p>Choose a collection to start browsing.</p></div></div>
              <div className="sp-web-category-grid">
                {[
                  ['All Products', products.length],
                  ['Available Now', products.filter(product => Number(product.stock) > 0).length],
                  ['Memorial Essentials', products.length],
                ].map(([label, count]) => <button key={String(label)} onClick={() => { setActiveCategory(String(label)); setActiveTab('Products') }}><span>▦</span><strong>{label}</strong><small>{count} products</small></button>)}
              </div>
            </section>
          ) : null}

          {activeTab === 'Reviews' ? (
            <section className="sp-tab-panel sp-web-review-panel"><div className="sp-web-review-score"><strong>New</strong><span>★★★★★</span></div><h2>Customer Reviews</h2><p>Reviews from families who purchase from this shop will appear here.</p><button onClick={handleOpenChat}>Chat with shop</button></section>
          ) : null}

        </div>
      </div>
  )
}
