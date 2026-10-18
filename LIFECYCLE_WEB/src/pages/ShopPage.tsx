import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import NotificationDropdown from '@/components/NotificationDropdown'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import LogoutLink from '@/components/LogoutLink'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart } from '@/utils/funeralCart'
import './ShopPage.css'

type ShopRecord = {
  id: string
  shopName: string
  shopAddress?: string | null
  generalLocation?: string | null
  shopImageUrl?: string | null
  coverImageUrl?: string | null
  createdAt?: string | null
}

type ProductRecord = {
  id: string
  name: string
  price: number
  imageUrl?: string | null
  stock: number
}

const SORT_OPTIONS = ['Name', 'Price: Low to High', 'Price: High to Low']

const HeaderCartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
)

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
)

type MobileMenuIconName = 'home' | 'account' | 'shop' | 'messages' | 'purchases' | 'help'

const MOBILE_MENU_ICON_PATHS: Record<MobileMenuIconName, string[]> = {
  home: ['m3 11 9-8 9 8', 'M5 10v11h14V10M9 21v-7h6v7'],
  account: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 21a7.5 7.5 0 0 1 15 0'],
  shop: ['M3 9h18l-2-6H5L3 9Z', 'M5 9v12h14V9M9 21v-7h6v7'],
  messages: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z'],
  purchases: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18M16 10a4 4 0 0 1-8 0'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01'],
}

function MobileMenuIcon({ name }: { name: MobileMenuIconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {MOBILE_MENU_ICON_PATHS[name].map(path => <path d={path} key={path} />)}
    </svg>
  )
}

export default function ShopPage() {
  const { shopId } = useParams()
  const navigate = useNavigate()
  const [shop, setShop] = useState<ShopRecord | null>(null)
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState('Name')
  const [queryText, setQueryText] = useState('')
  const [isFollowing, setIsFollowing] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [followLoading, setFollowLoading] = useState(false)
  const [viewer, setViewer] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [cartCount, setCartCount] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null)
  const isLoggedIn = Boolean(viewer)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewer(data.session?.user ?? null))
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => setViewer(session?.user ?? null))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!viewer?.id) {
      setUserProfile(null)
      return
    }
    supabase.from('users').select('fullName, photoURL').eq('id', viewer.id).maybeSingle().then(({ data }) => setUserProfile(data))
  }, [viewer?.id])

  useEffect(() => {
    const refreshCart = () => setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum, item) => sum + item.quantity, 0) : 0)
    refreshCart()
    window.addEventListener('funeral-cart-updated', refreshCart)
    return () => window.removeEventListener('funeral-cart-updated', refreshCart)
  }, [isLoggedIn])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    const closeAboveMobile = () => {
      if (window.innerWidth > 768) setMobileMenuOpen(false)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeAboveMobile)
    window.requestAnimationFrame(() => mobileMenuCloseRef.current?.focus())

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeAboveMobile)
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!shopId) return
    setLoading(true)
    setError(null)
    Promise.all([
      supabase.from('funeral_shops').select('id, shopName, shopAddress, generalLocation, shopImageUrl, coverImageUrl, createdAt').eq('id', shopId).eq('status', 'live').gt('paidUntil', new Date().toISOString()).maybeSingle(),
      supabase.from('funeral_products').select('id, name, price, imageUrl, stock').eq('shopId', shopId).eq('active', true),
    ]).then(([shopResult, productResult]) => {
      if (shopResult.error) throw shopResult.error
      if (!shopResult.data) throw new Error('Shop not found.')
      if (productResult.error) throw productResult.error
      setShop(shopResult.data as ShopRecord)
      setProducts((productResult.data ?? []).map((product: any) => ({
        id: String(product.id),
        name: String(product.name || ''),
        price: Number(product.price || 0),
        imageUrl: product.imageUrl || null,
        stock: Number(product.stock || 0),
      })))
    }).catch((reason: any) => {
      setShop(null)
      setError(reason?.message || 'Unable to load this shop.')
    }).finally(() => setLoading(false))
  }, [shopId])

  useEffect(() => {
    if (!shopId) return
    supabase.from('shop_follows').select('*', { count: 'exact', head: true }).eq('shopId', shopId).then(({ count }) => setFollowerCount(count ?? 0))
    if (viewer?.id) {
      supabase.from('shop_follows').select('id').eq('shopId', shopId).eq('userId', viewer.id).maybeSingle().then(({ data }) => setIsFollowing(Boolean(data)))
    } else {
      setIsFollowing(false)
    }
  }, [shopId, viewer?.id])

  const visibleProducts = useMemo(() => {
    const query = queryText.trim().toLowerCase()
    const list = products.filter(product => !query || product.name.toLowerCase().includes(query))
    if (sortBy === 'Price: Low to High') return [...list].sort((a, b) => a.price - b.price)
    if (sortBy === 'Price: High to Low') return [...list].sort((a, b) => b.price - a.price)
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [products, queryText, sortBy])

  const handleFollow = async () => {
    if (!viewer) {
      navigate(`/login?next=${encodeURIComponent(`/shop/${shopId || ''}`)}`)
      return
    }
    if (!shopId || followLoading) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        const { error: followError } = await supabase.from('shop_follows').delete().eq('shopId', shopId).eq('userId', viewer.id)
        if (followError) throw followError
        setIsFollowing(false)
        setFollowerCount(count => Math.max(0, count - 1))
      } else {
        const { error: followError } = await supabase.from('shop_follows').insert({ userId: viewer.id, shopId })
        if (followError) throw followError
        setIsFollowing(true)
        setFollowerCount(count => count + 1)
      }
    } finally {
      setFollowLoading(false)
    }
  }

  const handleOpenChat = () => {
    if (shop) window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: shop.id } }))
  }

  const accountPath = isLoggedIn ? '/user/profile' : '/login?next=/user/profile'
  const purchasesPath = isLoggedIn ? '/user/purchase' : '/login?next=/user/purchase'
  const helpPath = isLoggedIn ? '/user/help' : '/login?next=/user/help'

  const openMessages = () => {
    setMobileMenuOpen(false)
    if (!isLoggedIn) {
      navigate(`/login?next=${encodeURIComponent(`/shop/${shopId || ''}`)}`)
      return
    }
    window.dispatchEvent(new CustomEvent('open-chat'))
  }

  if (loading) return <div className="shop-detail-state">Loading shop…</div>
  if (error || !shop) return <div className="shop-detail-state shop-detail-state-error"><p>{error || 'Shop not found.'}</p><Link to="/funeral/shops">Browse funeral shops</Link></div>

  const joinedDate = shop.createdAt ? new Date(shop.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null
  const coverImageUrl = shop.coverImageUrl || shop.shopImageUrl || ''

  return (
    <div className="sp-bg shop-detail-page">
      {mobileMenuOpen ? (
        <div className="sp-mobile-menu-layer">
          <button type="button" className="sp-mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation menu" />
          <aside className="sp-mobile-menu" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="sp-mobile-menu-head">
              <span>Menu</span>
              <button ref={mobileMenuCloseRef} type="button" className="sp-mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation menu">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>

            {isLoggedIn ? (
              <div className="sp-mobile-menu-profile">
                {userProfile?.photoURL ? <img src={userProfile.photoURL} alt="" /> : <span className="sp-mobile-menu-avatar"><MobileMenuIcon name="account" /></span>}
                <div><strong>{userProfile?.fullName || 'My account'}</strong><span>{viewer?.email}</span></div>
              </div>
            ) : null}

            <nav className="sp-mobile-menu-nav" aria-label="Mobile navigation">
              <Link to="/funeral" onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name="home" /><span>Home</span></Link>
              <Link to={accountPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name="account" /><span>My Account</span></Link>
              <Link to="/seller" onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name="shop" /><span>Shop Center</span></Link>
              <button type="button" onClick={openMessages}><MobileMenuIcon name="messages" /><span>Messages</span></button>
              <div className="sp-mobile-menu-announcement"><AnnouncementDropdown menuItem /></div>
              <Link to={purchasesPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name="purchases" /><span>My Payments</span></Link>
              <Link to={helpPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name="help" /><span>Help Centre</span></Link>
            </nav>

            <div className="sp-mobile-menu-auth">
              {isLoggedIn ? <LogoutLink onClick={() => setMobileMenuOpen(false)}>Log out</LogoutLink> : <><Link to="/login" onClick={() => setMobileMenuOpen(false)}>Log in</Link><Link to="/register" className="sp-mobile-menu-primary" onClick={() => setMobileMenuOpen(false)}>Create account</Link></>}
            </div>
          </aside>
        </div>
      ) : null}

      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left"><Link to="/seller">Shop Center</Link></div>
          <div className="sp-topbar-right">
            <AnnouncementDropdown />
            <NotificationDropdown />
            <Link to="/user/help">Help Centre</Link>
            <span className="sp-divider">|</span>
            {isLoggedIn ? (
              <div className="sp-user-menu">
                <div className="sp-user-menu-trigger">
                  {userProfile?.photoURL ? <img src={userProfile.photoURL} alt="Account" className="sp-user-avatar" /> : <div className="sp-user-avatar-placeholder" aria-hidden="true" />}
                  <span className="sp-user-name">{userProfile?.fullName || viewer?.email}</span>
                  <svg className="sp-user-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                </div>
                <div className="sp-user-dropdown">
                  <Link to="/user/profile">My account</Link>
                  <Link to="/user/requests">Service requests</Link>
                  <Link to="/auth/switch-account" className="sp-dropdown-switch">Switch account</Link>
                  <LogoutLink>Log out</LogoutLink>
                </div>
              </div>
            ) : <><Link to="/register" className="sp-signup">Sign up</Link><Link to="/login">Log in</Link></>}
          </div>
        </div>
      </div>

      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="sp-mobile-brand-row">
            <button type="button" className="sp-mobile-menu-trigger" onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation menu" aria-haspopup="dialog" aria-expanded={mobileMenuOpen}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <BrandLogo to="/funeral" className="sp-brand-logo" />
          </div>
          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input type="search" value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Search this shop" aria-label="Search this shop" />
              <button type="button" className="sp-search-btn" aria-label="Search"><SearchIcon /></button>
            </div>
          </div>
          <div className="sp-header-actions">
            <div className="sp-mobile-header-notification"><NotificationDropdown variant="seller-centre" /></div>
            <div className="sp-cart-area">
              <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Shopping cart" title="Shopping cart">
                <HeaderCartIcon />
                {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="sp-container shop-detail-main">
        <div className="page-back-row"><PageBackButton /></div>

        <section className="shop-detail-overview" id="shop-overview" aria-label={`${shop.shopName} shop information`}>
          <div
            className={`shop-detail-summary${coverImageUrl ? ' shop-detail-summary-cover' : ''}`}
            style={coverImageUrl ? { backgroundImage: `linear-gradient(110deg, rgba(25, 48, 41, 0.94), rgba(34, 49, 45, 0.72)), url("${coverImageUrl}")` } : undefined}
          >
            <div className="shop-detail-profile">
              {shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" className="shop-detail-avatar" /> : <div className="shop-detail-avatar shop-detail-avatar-fallback" aria-hidden="true">{shop.shopName.charAt(0).toUpperCase()}</div>}
              <div className="shop-detail-identity">
                <h1>{shop.shopName}</h1>
                <p className="shop-detail-status"><span aria-hidden="true">•</span> Online</p>
                <p className="shop-detail-location">{shop.generalLocation || shop.shopAddress || 'Location not provided'}</p>
              </div>
            </div>
            <div className="shop-detail-actions">
              <button type="button" className="shop-secondary-button" onClick={handleFollow} disabled={followLoading}>{isFollowing ? 'Following' : 'Follow shop'}</button>
              <button type="button" className="shop-primary-button" onClick={handleOpenChat}>Chat with shop</button>
            </div>
          </div>
          <dl className="shop-detail-facts">
            <div><dt>Products</dt><dd>{products.length}</dd></div>
            <div><dt>Followers</dt><dd>{followerCount}</dd></div>
            {joinedDate && <div><dt>Joined</dt><dd>{joinedDate}</dd></div>}
          </dl>
        </section>

        <nav className="shop-detail-tabs" aria-label="Shop navigation">
          <a href="#shop-overview">Shop</a>
          <a href="#shop-products">All products</a>
        </nav>

        <section className="shop-detail-products" id="shop-products">
          <div className="shop-detail-products-header">
            <div><h2>Products</h2><p>{visibleProducts.length} shown</p></div>
            <label className="shop-sort-control">Sort
              <select value={sortBy} onChange={event => setSortBy(event.target.value)}>{SORT_OPTIONS.map(option => <option key={option}>{option}</option>)}</select>
            </label>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="shop-detail-empty">{queryText ? 'No products match your search.' : 'This shop has no active products.'}</div>
          ) : (
            <div className="shop-detail-grid">
              {visibleProducts.map(product => (
                <Link key={product.id} to={`/funeral/product/${product.id}`} className="shop-product-card">
                  {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <div className="shop-product-image-empty">No image</div>}
                  <div className="shop-product-copy">
                    <h3>{product.name}</h3>
                    <strong>₱{product.price.toLocaleString()}</strong>
                    <span>{product.stock} available</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
