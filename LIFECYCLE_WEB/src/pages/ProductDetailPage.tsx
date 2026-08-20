import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { addFuneralCartItem, loadFuneralCart } from '@/utils/funeralCart'
import type { User } from '@supabase/supabase-js'
import './ProductDetailPage.css'

type Product = {
  id: string
  shopId: string
  shopName: string
  shopImageUrl: string | null
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

type RelatedProduct = {
  id: string
  name: string
  price: number
  stock: number
  imageUrl: string | null
}

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '-'
  return `\u20b1${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function Stars({ rating = 4.8 }: { rating?: number }) {
  const full = Math.floor(rating || 0)
  const half = (rating || 0) - full >= 0.5
  return (
    <div className="pd-stars">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={i < full || (half && i === full) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
      ))}
    </div>
  )
}

// Icons
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
)
const BookmarkIcon = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
)
const CartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
)
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


export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>()
  const navigate = useNavigate()
  const [viewer, setViewer] = useState<User | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [selectedVariation, setSelectedVariation] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [cartCount, setCartCount] = useState(0)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [queryText, setQueryText] = useState('')
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)

  useEffect(() => {
    if (productId && viewer) {
      const favs = JSON.parse(localStorage.getItem('lifecycle_favorites') || '{}')
      setIsFavorite(!!favs[productId])
    } else {
      setIsFavorite(false)
    }
  }, [productId, viewer])

  const [showLoginToast, setShowLoginToast] = useState(false)
  const [showAddedToast, setShowAddedToast] = useState(false)
  const [showVariationToast, setShowVariationToast] = useState(false)

  const toggleFavorite = () => {
    if (!productId) return
    if (!isLoggedIn) {
      setShowLoginToast(true)
      setTimeout(() => setShowLoginToast(false), 3000)
      return
    }
    const nextState = !isFavorite
    setIsFavorite(nextState)
    const favs = JSON.parse(localStorage.getItem('lifecycle_favorites') || '{}')
    if (nextState) {
      favs[productId] = true
    } else {
      delete favs[productId]
    }
    localStorage.setItem('lifecycle_favorites', JSON.stringify(favs))
  }

  const gallery = product?.galleryImageUrls.length ? product.galleryImageUrls
    : product?.imageUrl ? [product.imageUrl]
    : []

  const variations = product?.variations ?? []
  const isLoggedIn = Boolean(viewer)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewer(data.session?.user ?? null))
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setViewer(s?.user ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (viewer?.id) {
      supabase.from('users').select('*').eq('id', viewer.id).single().then(({ data }) => setUserProfile(data))
    } else {
      setUserProfile(null)
    }
  }, [viewer?.id])

  useEffect(() => {
    setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum: number, item: any) => sum + item.quantity, 0) : 0)
    const refreshCart = () => {
      setCartCount(isLoggedIn ? loadFuneralCart().reduce((sum: number, item: any) => sum + item.quantity, 0) : 0)
    }
    window.addEventListener('funeral-cart-updated', refreshCart)
    return () => window.removeEventListener('funeral-cart-updated', refreshCart)
  }, [isLoggedIn])

  useEffect(() => {
    if (!productId) return
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const { data, error: err } = await supabase
          .from('funeral_products')
          .select(`
            id, name, description, price, stock, "imageUrl", active, "shopId", "hasVariations",
            funeral_product_images ( "imageUrl", "displayOrder" ),
            funeral_product_variations ( id, name, "imageUrl" ),
            funeral_shops!inner ( "shopName", "shopImageUrl", "shopAddress", "shopPhoneNumber", "generalLocation", status )
          `)
          .eq('id', productId)
          .eq('active', true)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
          .maybeSingle()

        if (err) throw err
        if (!data) { setError('Product not found.'); setLoading(false); return }

        const row = data as any
        const imgs = (row.funeral_product_images ?? []) as any[]
        const sorted = [...imgs].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        const galleryUrls = sorted.map((img: any) => img.imageUrl).filter((url: string) => Boolean(url))
        const vars = (row.funeral_product_variations ?? []) as any[]
        const variationList = vars.map((v: any) => ({
          id: String(v.id),
          name: String(v.name || 'Standard'),
          imageUrl: v.imageUrl ?? null,
        }))

        const productData: Product = {
          id: String(row.id),
          shopId: String(row.shopId ?? ''),
          shopName: String(row.funeral_shops?.shopName ?? 'Verified Shop'),
          shopImageUrl: row.funeral_shops?.shopImageUrl ?? null,
          shopAddress: String(row.funeral_shops?.shopAddress ?? ''),
          shopPhoneNumber: String(row.funeral_shops?.shopPhoneNumber ?? ''),
          name: String(row.name ?? 'Untitled Product'),
          description: String(row.description ?? ''),
          price: Number(row.price) || 0,
          stock: Number(row.stock) || 0,
          category: resolveCategory(row),
          imageUrl: getPrimaryImage(row),
          galleryImageUrls: galleryUrls,
          variations: variationList,
        }
        setProduct(productData)
        setGalleryIndex(0)
        setSelectedVariation(null)
        setQuantity(1)

        // Load related products from the same shop (excluding this product)
        const { data: relData } = await supabase
          .from('funeral_products')
          .select(`id, name, price, stock, "imageUrl", active, funeral_shops!inner(status)`)
          .eq('active', true)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
          .neq('id', productId)
          .limit(6)

        if (relData) {
          setRelatedProducts((relData as any[]).map(r => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            price: Number(r.price) || 0,
            stock: Number(r.stock) || 0,
            imageUrl: r.imageUrl ?? null,
          })))
        }
      } catch (e: any) {
        setError(e?.message ?? 'Unable to load product.')
      } finally {
        setLoading(false)
      }
    })()
  }, [productId])

  const handleAddToCart = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/product/' + productId)
      return
    }
    if (!product) return
    if (product.variations.length > 0 && !selectedVariation) {
      setShowVariationToast(true)
      setTimeout(() => setShowVariationToast(false), 3000)
      return
    }
    const varItem = product.variations.find(v => v.id === selectedVariation)
    addFuneralCartItem({
      productId: product.id,
      shopId: product.shopId,
      shopName: product.shopName,
      name: product.name,
      price: product.price,
      imageUrl: varItem?.imageUrl ?? product.imageUrl,
      variationName: varItem?.name ?? null,
      quantity: quantity
    })
    
    // Dispatch event so cart count updates immediately
    window.dispatchEvent(new Event('funeral-cart-updated'))

    setShowAddedToast(true)
    setTimeout(() => {
      setShowAddedToast(false)
    }, 3500)
  }

  const handleBuyNow = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/product/' + productId)
      return
    }
    if (!product) return
    if (product.variations.length > 0 && !selectedVariation) {
      setShowVariationToast(true)
      setTimeout(() => setShowVariationToast(false), 3000)
      return
    }
    const varItem = product.variations.find(v => v.id === selectedVariation)
    addFuneralCartItem({
      productId: product.id,
      shopId: product.shopId,
      shopName: product.shopName,
      name: product.name,
      price: product.price,
      imageUrl: varItem?.imageUrl ?? product.imageUrl,
      variationName: varItem?.name ?? null,
      quantity: quantity
    })
    navigate('/user/cart')
  }

  const updateQuantity = (amount: number) => {
    if (!product) return
    const maxStock = product.stock || 1
    const newQty = quantity + amount
    if (newQty >= 1 && newQty <= maxStock) {
      setQuantity(newQty)
    }
  }

  if (loading) {
    return (
      <div className="pd-page">
        <div className="pd-container pd-state">
          <div className="pd-spinner" />
          <p>Loading product...</p>
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="pd-page">
        <div className="pd-container pd-state">
          <p style={{ color: '#334155' }}>{error ?? 'Product not found.'}</p>
        </div>
      </div>
    )
  }

  const mainImage = gallery[galleryIndex] || product.imageUrl || ''

  return (
    <div className="pd-page">
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
                placeholder="Search funeral products, caskets, urns..."
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

      <div className="pd-breadcrumbs-wrap">
        <div className="pd-breadcrumbs">
          <button 
            type="button" 
            className="pd-breadcrumbs-back"
            onClick={() => navigate(-1)} 
            aria-label="Go back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back
          </button>
          <span className="pd-breadcrumbs-divider"></span>

          <Link to="/funeral">Home</Link>
          <span className="pd-breadcrumb-sep">&gt;</span>
          <Link to={`/funeral?category=${encodeURIComponent(product.category)}`}>{product.category}</Link>
          <span className="pd-breadcrumb-sep">&gt;</span>
          <span className="pd-breadcrumb-current">{product.name}</span>
        </div>
      </div>

      <div className="pd-container">

        {/* Main Product Card */}
        <div className="pd-main-card">
          
          {/* Gallery Left */}
          <div className="pd-gallery-section">
            <div className="pd-main-image" onClick={() => mainImage && setIsImageModalOpen(true)} style={{ cursor: mainImage ? 'zoom-in' : 'default' }}>
              {mainImage ? (
                <img src={mainImage} alt={product.name} />
              ) : (
                <div style={{ color: '#ccc', fontSize: 64 }}>No Image</div>
              )}
            </div>
            
            {gallery.length > 0 && (
              <div className="pd-thumbs">
                {gallery.slice(0, 5).map((url, idx) => (
                  <div 
                    key={idx} 
                    className={`pd-thumb ${idx === galleryIndex ? 'active' : ''}`}
                    onClick={() => setGalleryIndex(idx)}
                  >
                    <img src={url} alt={`thumb ${idx}`} />
                  </div>
                ))}
              </div>
            )}
            
            <div className="pd-social-share">
              <div className="pd-social-icons">
                <span style={{color: 'var(--text-main)', fontSize: 16, marginRight: 5}}>Share:</span>
                <ShareIcon />
              </div>
              <div className={`pd-favorite ${isFavorite ? 'saved' : ''}`} onClick={toggleFavorite} style={{ cursor: 'pointer' }}>
                <BookmarkIcon filled={isFavorite} />
                <span>{isFavorite ? 'Saved' : 'Save'}</span>
              </div>
            </div>
          </div>

          {/* Info Right */}
          <div className="pd-info-section">
            <h1 className="pd-title">{product.name}</h1>
            
            <div className="pd-meta">
              <div className="pd-meta-item">
                <Stars rating={4.8} />
              </div>
              <div className="pd-meta-item">
                <span className="pd-meta-value" style={{color: 'var(--text-main)', borderBottomColor: 'var(--text-main)'}}>{product.stock}</span>
                <span className="pd-meta-label" style={{marginLeft: 5}}>In Stock</span>
              </div>
            </div>

            <div className="pd-price-block">
              <div className="pd-price-value">{formatPeso(product.price)}</div>
            </div>



            {variations.length > 0 && (
              <div className="pd-option-row align-start">
                <div className="pd-option-label" style={{marginTop: 8}}>Variations</div>
                <div className="pd-option-content">
                  {variations.map(v => (
                    <div 
                      key={v.id} 
                      className={`pd-variation-btn ${selectedVariation === v.id ? 'selected' : ''}`}
                      onClick={() => setSelectedVariation(v.id)}
                    >
                      {v.imageUrl && <img src={v.imageUrl} alt={v.name} className="pd-variation-img" />}
                      <span>{v.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pd-option-row">
              <div className="pd-option-label">Quantity</div>
              <div className="pd-option-content">
                <div className="pd-qty-control">
                  <button className="pd-qty-btn" onClick={() => updateQuantity(-1)} disabled={quantity <= 1}>-</button>
                  <input type="text" className="pd-qty-input" value={quantity} readOnly />
                  <button className="pd-qty-btn" onClick={() => updateQuantity(1)} disabled={quantity >= product.stock}>+</button>
                </div>
                <span className="pd-stock-info">{product.stock} pieces available</span>
              </div>
            </div>

            <div className="pd-actions-row">
              <button className="pd-btn pd-btn-cart" onClick={handleAddToCart} disabled={product.stock === 0}>
                <CartIcon /> Add To Cart
              </button>
              <button className="pd-btn pd-btn-buy" onClick={handleBuyNow} disabled={product.stock === 0}>
                Buy Now
              </button>
            </div>
            {!isLoggedIn && (
              <p style={{color: 'var(--text-muted)', fontSize: 12, marginTop: 10}}>Guests must log in to checkout.</p>
            )}

          </div>
        </div>

        {/* Shop Section */}
        <div className="pd-shop-card">
          <div className="pd-shop-left">
            <div className="pd-shop-avatar">
              {product.shopImageUrl ? (
                <img src={product.shopImageUrl} alt={product.shopName} className="pd-shop-avatar-img" />
              ) : (
                <span style={{fontSize: 24, fontWeight: 'bold'}}>{product.shopName.charAt(0)}</span>
              )}
            </div>
            <div className="pd-shop-info">
              <div className="pd-shop-name">{product.shopName}</div>
              <div className="pd-shop-active">Verified Shop</div>
              <div className="pd-shop-actions">
                <button 
                  className="pd-shop-btn pd-shop-btn-primary"
                  onClick={() => {
                    if (!isLoggedIn) {
                      navigate('/login', { state: { returnTo: location.pathname } })
                      return
                    }
                    window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: product.shopId } }))
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                  Chat Now
                </button>
                <button 
                  className="pd-shop-btn pd-shop-btn-outline"
                  onClick={() => navigate(`/shop/${product.shopId}`)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  View Shop
                </button>
              </div>
            </div>
          </div>
          <div className="pd-shop-right">
            {product.shopAddress && <div className="pd-shop-stat">Location <span>{product.shopAddress}</span></div>}
            {product.shopPhoneNumber && <div className="pd-shop-stat">Contact <span>{product.shopPhoneNumber}</span></div>}
          </div>
        </div>

        {/* Product Description */}
        <div className="pd-details-card">
          <h2 className="pd-section-header">Product Description</h2>
          <div className="pd-spec-row">
            <div className="pd-spec-label">Availability</div>
            <div className="pd-spec-value">{product.stock > 0 ? 'In Stock' : 'Ask Shop'}</div>
          </div>
          <div className="pd-spec-row">
            <div className="pd-spec-label">Variations</div>
            <div className="pd-spec-value">{product.variations.length > 0 ? `${product.variations.length} options` : 'Standard'}</div>
          </div>
          <div className="pd-desc-content">
            {product.description || 'No description provided by the seller.'}
          </div>
        </div>

        {/* Related Products (real data) */}
        {relatedProducts.length > 0 && (
          <div className="pd-related">
            <div className="pd-related-header">YOU MAY ALSO LIKE</div>
            <div className="pd-related-grid">
              {relatedProducts.map(rp => (
                <Link to={`/funeral/product/${rp.id}`} key={rp.id} className="pd-related-card">
                  {rp.imageUrl ? (
                    <img src={rp.imageUrl} alt={rp.name} className="pd-related-img" />
                  ) : (
                    <div className="pd-related-img" style={{ background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>No Image</div>
                  )}
                  <div className="pd-related-info">
                    <div className="pd-related-name">{rp.name}</div>
                    <div className="pd-related-price-row">
                      <span className="pd-related-price">{formatPeso(rp.price)}</span>
                      <span className="pd-related-sold">{rp.stock} in stock</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Image Modal */}
      {isImageModalOpen && (
        <div className="pd-image-modal-overlay" onClick={() => setIsImageModalOpen(false)}>
          <div className="pd-image-modal-content" onClick={e => e.stopPropagation()}>
            <div className="pd-image-modal-left">
              <img src={gallery[galleryIndex] || product.imageUrl || ''} alt={product.name} />
              <button 
                className="pd-image-modal-nav pd-image-modal-prev" 
                onClick={() => setGalleryIndex((prev) => (prev > 0 ? prev - 1 : gallery.length - 1))}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
              <button 
                className="pd-image-modal-nav pd-image-modal-next" 
                onClick={() => setGalleryIndex((prev) => (prev < gallery.length - 1 ? prev + 1 : 0))}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
            <div className="pd-image-modal-right">
              <button className="pd-image-modal-close" onClick={() => setIsImageModalOpen(false)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <h2 className="pd-image-modal-title">{product.name}</h2>
              <div className="pd-image-modal-gallery">
                {gallery.map((url, idx) => (
                  <div 
                    key={idx} 
                    className={`pd-image-modal-thumb ${idx === galleryIndex ? 'active' : ''}`}
                    onClick={() => setGalleryIndex(idx)}
                  >
                    <img src={url} alt={`thumb ${idx}`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Added to Cart Toast — Centered Card */}
      {showAddedToast && (
        <div className="pd-added-overlay">
          <div className="pd-added-card">
            <div className="pd-added-icon-ring">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="pd-added-heading">Added to Cart</p>
            <p className="pd-added-sub">This item has been added to your shopping cart successfully.</p>
          </div>
        </div>
      )}

      {/* Login Toast */}
      {showLoginToast && (
        <div className="pd-login-toast">
          <div className="pd-login-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span>Please <Link to="/login" style={{ color: '#334155', fontWeight: 600, textDecoration: 'underline' }}>log in</Link> first to add favorites.</span>
          </div>
        </div>
      )}

      {/* Select Variation Toast */}
      {showVariationToast && (
        <div className="pd-login-toast">
          <div className="pd-login-toast-content pd-variation-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>Please select a variation first before adding this product to your cart or buying it.</span>
          </div>
        </div>
      )}

    </div>
  )
}

function resolveCategory(row: any): string {
  const n = String(row.name ?? '').trim().toLowerCase()
  if (n.includes('casket') || n.includes('coffin')) return 'Caskets'
  if (n.includes('flower') || n.includes('bouquet') || n.includes('wreath') || n.includes('floral')) return 'Floral Tributes'
  if (n.includes('urn') || n.includes('memorial') || n.includes('candle')) return 'Urns & Memorial'
  if (n.includes('package') || n.includes('service') || n.includes('plan')) return 'Service Packages'
  if (n.includes('burial') || n.includes('interment')) return 'Burial Needs'
  if (n.includes('chapel') || n.includes('hall') || n.includes('venue')) return 'Chapel Services'
  if (n.includes('transport') || n.includes('hearse')) return 'Transportation'
  if (n.includes('keepsake') || n.includes('token')) return 'Keepsakes'
  return 'Caskets'
}

function getPrimaryImage(row: any): string | null {
  if (row.imageUrl) return row.imageUrl
  const gallery = (row.funeral_product_images ?? []) as any[]
  if (gallery.length > 0) {
    const sorted = [...gallery].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    if (sorted[0]?.imageUrl) return sorted[0].imageUrl
  }
  const vars = (row.funeral_product_variations ?? []) as any[]
  return vars.find((v: any) => v.imageUrl)?.imageUrl ?? null
}
