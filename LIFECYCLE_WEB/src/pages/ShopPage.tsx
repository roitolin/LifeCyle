import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
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

  if (loading) return <div className="shop-detail-state">Loading shop…</div>
  if (error || !shop) return <div className="shop-detail-state shop-detail-state-error"><p>{error || 'Shop not found.'}</p><Link to="/funeral/shops">Browse funeral shops</Link></div>

  const joinedDate = shop.createdAt ? new Date(shop.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null
  const coverImageUrl = shop.coverImageUrl || shop.shopImageUrl || ''

  return (
    <div className="sp-bg shop-detail-page">
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left"><Link to="/seller">Seller Centre</Link></div>
          <div className="sp-topbar-right">
            <Link to="/user/notifications">Notifications</Link>
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
                  <Link to="/auth/logout">Log out</Link>
                </div>
              </div>
            ) : <><Link to="/register" className="sp-signup">Sign up</Link><Link to="/login">Log in</Link></>}
          </div>
        </div>
      </div>

      <header className="sp-header">
        <div className="sp-header-inner">
          <BrandLogo />
          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input type="search" value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Search this shop" aria-label="Search this shop" />
              <button type="button" className="sp-search-btn" aria-label="Search"><SearchIcon /></button>
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

      <main className="sp-container shop-detail-main">
        <button type="button" className="shop-detail-back" onClick={() => navigate(-1)}>← Back</button>

        <section
          className={`shop-detail-summary${coverImageUrl ? ' shop-detail-summary-cover' : ''}`}
          style={coverImageUrl ? { backgroundImage: `linear-gradient(rgba(15, 23, 42, 0.66), rgba(15, 23, 42, 0.74)), url("${coverImageUrl}")` } : undefined}
        >
          {shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" className="shop-detail-avatar" /> : <div className="shop-detail-avatar shop-detail-avatar-fallback" aria-hidden="true">{shop.shopName.charAt(0).toUpperCase()}</div>}
          <div className="shop-detail-identity">
            <h1>{shop.shopName}</h1>
            <p>{shop.generalLocation || shop.shopAddress || 'Location not provided'}</p>
            <div className="shop-detail-facts">
              <span>{products.length} {products.length === 1 ? 'product' : 'products'}</span>
              <span>{followerCount} {followerCount === 1 ? 'follower' : 'followers'}</span>
              {joinedDate && <span>Joined {joinedDate}</span>}
            </div>
          </div>
          <div className="shop-detail-actions">
            <button type="button" className="shop-secondary-button" onClick={handleFollow} disabled={followLoading}>{isFollowing ? 'Following' : 'Follow shop'}</button>
            <button type="button" className="shop-primary-button" onClick={handleOpenChat}>Chat with shop</button>
          </div>
        </section>

        <section className="shop-detail-products">
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
