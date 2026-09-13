import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { addFuneralCartItem, loadFuneralCart } from '@/utils/funeralCart'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
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

const PACKAGE_OPTIONS = [
  { name: 'Flowers', description: 'Floral arrangements for the funeral service' },
  { name: 'Candles', description: 'Memorial candles for the funeral service' },
] as const

function readStoredFavorites(): Record<string, boolean> {
  try {
    const stored = JSON.parse(localStorage.getItem('lifecycle_favorites') || '{}')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '-'
  return `\u20b1${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
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
  const [selectedPackageItems, setSelectedPackageItems] = useState<string[]>([])
  const [cartCount, setCartCount] = useState(0)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [queryText, setQueryText] = useState('')
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const imageTriggerRef = useRef<HTMLButtonElement>(null)
  const imageCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (productId && viewer) {
      const favs = readStoredFavorites()
      setIsFavorite(!!favs[productId])
    } else {
      setIsFavorite(false)
    }
  }, [productId, viewer])

  const [showLoginToast, setShowLoginToast] = useState(false)
  const [showAddedToast, setShowAddedToast] = useState(false)
  const [showVariationToast, setShowVariationToast] = useState(false)
  const [showShareToast, setShowShareToast] = useState(false)

  const toggleFavorite = () => {
    if (!productId) return
    if (!isLoggedIn) {
      setShowLoginToast(true)
      setTimeout(() => setShowLoginToast(false), 3000)
      return
    }
    const nextState = !isFavorite
    setIsFavorite(nextState)
    const favs = readStoredFavorites()
    if (nextState) {
      favs[productId] = true
    } else {
      delete favs[productId]
    }
    localStorage.setItem('lifecycle_favorites', JSON.stringify(favs))
    window.dispatchEvent(new Event('lifecycle-favorites-updated'))
  }

  const shareProduct = async () => {
    if (!product) return
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: `View ${product.name} on LifeCycle`, url: window.location.href })
      } else {
        await navigator.clipboard.writeText(window.location.href)
        setShowShareToast(true)
        window.setTimeout(() => setShowShareToast(false), 2500)
      }
    } catch {
      // Closing the native share sheet is not an error the page needs to surface.
    }
  }

  const variations = product?.variations ?? []
  const baseGallery = product?.galleryImageUrls.length ? product.galleryImageUrls
    : product?.imageUrl ? [product.imageUrl]
    : []
  const gallery = Array.from(new Set([
    ...baseGallery,
    ...variations.map(variation => variation.imageUrl).filter((url): url is string => Boolean(url)),
  ]))
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
    if (!isImageModalOpen) return
    const imageTrigger = imageTriggerRef.current
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsImageModalOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    window.requestAnimationFrame(() => imageCloseRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      imageTrigger?.focus()
    }
  }, [isImageModalOpen])

  useEffect(() => {
    if (!productId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setRelatedProducts([])
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
        if (!data) {
          if (!cancelled) setError('Product not found.')
          return
        }

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
        if (cancelled) return
        setProduct(productData)
        setGalleryIndex(0)
        setSelectedVariation(null)

        // Load related products from the same shop (excluding this product)
        const { data: relData } = await supabase
          .from('funeral_products')
          .select(`id, name, price, stock, "imageUrl", active, funeral_shops!inner(status)`)
          .eq('active', true)
          .gt('stock', 0)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
          .eq('shopId', productData.shopId)
          .neq('id', productId)
          .limit(6)

        if (relData && !cancelled) {
          setRelatedProducts((relData as any[]).map(r => ({
            id: String(r.id),
            name: String(r.name ?? ''),
            price: Number(r.price) || 0,
            stock: Number(r.stock) || 0,
            imageUrl: r.imageUrl ?? null,
          })))
        }
      } catch (e: any) {
        console.error('Unable to load product details', e)
        if (!cancelled) setError('We could not load this product right now. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  const handleAddToCart = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/product/' + productId)
      return
    }
    if (!product) return
    if (product.variations.length > 0 && !selectedVariation) {
      setShowVariationToast(true)
      window.requestAnimationFrame(() => document.getElementById('pd-variations')?.focus())
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
      packageItems: selectedPackageItems,
      quantity: 1,
    })
    
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
      window.requestAnimationFrame(() => document.getElementById('pd-variations')?.focus())
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
      packageItems: selectedPackageItems,
      quantity: 1,
    })
    navigate('/user/cart')
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
          <div className="pd-state-card">
            <span className="pd-state-eyebrow">Product unavailable</span>
            <h1>We could not open this item.</h1>
            <p>{error ?? 'This product may no longer be available.'}</p>
            <div className="pd-state-actions">
              <button type="button" onClick={() => window.location.reload()}>Try again</button>
              <Link to="/funeral">Browse the catalog</Link>
            </div>
          </div>
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
          </div>
          <div className="sp-topbar-right">
            <Link to="/user/notifications">Notifications</Link>
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
          <BrandLogo to="/" />

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && navigate(`/funeral?search=${encodeURIComponent(queryText)}`)}
                placeholder="Search for caskets..."
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" onClick={() => navigate(`/funeral?search=${encodeURIComponent(queryText)}`)} aria-label="Search">
                <SearchIcon />
              </button>
            </div>
            <div className="sp-trending">
              <button type="button" onClick={() => navigate('/funeral?search=Caskets')}>Caskets</button>
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

      <main className="pd-container">
        <div className="pd-product-nav">
          <button
            type="button"
            className="pd-product-back"
            onClick={() => navigate(-1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"></path><polyline points="12 19 5 12 12 5"></polyline></svg>
            Back to products
          </button>
          <nav className="pd-product-path" aria-label="Breadcrumb">
            <Link to="/funeral">Catalog</Link>
            <span aria-hidden="true">/</span>
            <Link to={`/funeral?search=${encodeURIComponent(product.category)}`}>{product.category}</Link>
          </nav>
        </div>

        {/* Main Product Card */}
        <div className="pd-main-card">
          
          {/* Gallery Left */}
          <div className="pd-gallery-section">
            <button
              type="button"
              ref={imageTriggerRef}
              className="pd-main-image"
              onClick={() => mainImage && setIsImageModalOpen(true)}
              disabled={!mainImage}
              aria-label={mainImage ? `Open a larger image of ${product.name}` : 'No product image available'}
            >
              {mainImage ? (
                <img src={mainImage} alt={product.name} />
              ) : (
                <span className="pd-image-placeholder">No image available</span>
              )}
              {mainImage && <span className="pd-image-zoom">View larger</span>}
            </button>
            
            {gallery.length > 0 && (
              <div className="pd-thumbs">
                {gallery.slice(0, 5).map((url, idx) => (
                  <button
                    type="button"
                    key={idx} 
                    className={`pd-thumb ${idx === galleryIndex ? 'active' : ''}`}
                    onClick={() => setGalleryIndex(idx)}
                    aria-label={`View image ${idx + 1} of ${gallery.length}`}
                    aria-pressed={idx === galleryIndex}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            )}
            
            <div className="pd-social-share">
              <button type="button" className="pd-share-button" onClick={shareProduct}>
                <ShareIcon />
                <span>Share</span>
              </button>
              <button type="button" className={`pd-favorite ${isFavorite ? 'saved' : ''}`} onClick={toggleFavorite} aria-pressed={isFavorite}>
                <BookmarkIcon filled={isFavorite} />
                <span>{isFavorite ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Info Right */}
          <div className="pd-info-section">
            <div className="pd-product-kicker">
              <span>{product.category}</span>
              <span className="pd-verified-label">Verified provider</span>
            </div>
            <h1 className="pd-title">{product.name}</h1>
            
            <div className="pd-meta">
              <div className="pd-meta-item">
                <span className="pd-stock-dot" aria-hidden="true"></span>
                <span>{product.stock > 0 ? 'Available' : 'Contact provider'}</span>
              </div>
              <div className="pd-meta-item">
                <span>{product.stock} {product.stock === 1 ? 'item' : 'items'} in stock</span>
              </div>
            </div>

            <div className="pd-price-block">
              <span className="pd-price-label">Price</span>
              <div className="pd-price-value">{formatPeso(product.price)}</div>
            </div>



            {variations.length > 0 && (
              <div
                className={`pd-option-row align-start${showVariationToast ? ' has-error' : ''}`}
                id="pd-variations"
                tabIndex={-1}
              >
                <div className="pd-option-label">Choose an option</div>
                <div className="pd-option-content">
                  {variations.map(v => (
                    <button
                      type="button"
                      key={v.id} 
                      className={`pd-variation-btn ${selectedVariation === v.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedVariation(v.id)
                        if (v.imageUrl) {
                          const imageIndex = gallery.indexOf(v.imageUrl)
                          if (imageIndex >= 0) setGalleryIndex(imageIndex)
                        }
                      }}
                      aria-pressed={selectedVariation === v.id}
                    >
                      {v.imageUrl && <img src={v.imageUrl} alt={v.name} className="pd-variation-img" />}
                      <span>{v.name}</span>
                    </button>
                  ))}
                </div>
                {showVariationToast && <p className="pd-variation-error">Choose an option before continuing.</p>}
              </div>
            )}

            <div className="pd-option-row align-start">
              <div className="pd-option-label">Select packages</div>
              <div className="pd-option-content pd-package-options">
                {PACKAGE_OPTIONS.map(option => {
                  const selected = selectedPackageItems.includes(option.name)
                  return (
                    <button
                      type="button"
                      key={option.name}
                      className={`pd-package-btn${selected ? ' selected' : ''}`}
                      onClick={() => {
                        setSelectedPackageItems(current =>
                          current.includes(option.name)
                            ? current.filter(item => item !== option.name)
                            : [...current, option.name],
                        )
                      }}
                      aria-pressed={selected}
                    >
                      <span className="pd-package-check" aria-hidden="true">{selected ? '\u2713' : '+'}</span>
                      <span>
                        <strong>{option.name}</strong>
                        <small>{option.description}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="pd-package-hint">Optional. Choose Flowers, Candles, or both for this service request.</p>
            </div>

            <div className="pd-option-row">
              <div className="pd-option-label">Service request</div>
              <div className="pd-option-content">
                <span className="pd-single-order-note">One casket per service request</span>
                <span className="pd-stock-info">{product.stock} available</span>
              </div>
            </div>

            <div className="pd-actions-row">
              <button className="pd-btn pd-btn-cart" onClick={handleAddToCart} disabled={product.stock === 0}>
                <CartIcon /> Add to cart
              </button>
              <button className="pd-btn pd-btn-buy" onClick={handleBuyNow} disabled={product.stock === 0}>
                Buy now
              </button>
            </div>
            {!isLoggedIn && (
              <p className="pd-login-note">You can browse freely. Sign in when you are ready to check out.</p>
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
                <span className="pd-shop-avatar-fallback">{product.shopName.charAt(0)}</span>
              )}
            </div>
            <div className="pd-shop-info">
              <span className="pd-shop-eyebrow">Sold and fulfilled by</span>
              <h2 className="pd-shop-name">{product.shopName}</h2>
              <div className="pd-shop-active">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
                Active LifeCycle shop
              </div>
              <div className="pd-shop-actions">
                <button 
                  className="pd-shop-btn pd-shop-btn-primary"
                  onClick={() => {
                    if (!isLoggedIn) {
                      navigate('/login?next=' + encodeURIComponent(window.location.pathname))
                      return
                    }
                    window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: product.shopId } }))
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                  Chat
                </button>
                <button 
                  className="pd-shop-btn pd-shop-btn-outline"
                  onClick={() => navigate(`/shop/${product.shopId}`)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  View shop
                </button>
              </div>
            </div>
          </div>
          <div className="pd-shop-right">
            {product.shopAddress && <div className="pd-shop-stat"><strong>Location</strong><span>{product.shopAddress}</span></div>}
            {product.shopPhoneNumber && <div className="pd-shop-stat"><strong>Contact</strong><span>{product.shopPhoneNumber}</span></div>}
          </div>
        </div>

        {/* Product Description */}
        <article className="pd-details-card">
          <h2 className="pd-section-header">About this product</h2>
          <div className="pd-details-layout">
            <div className="pd-desc-content">
              {product.description || 'The provider has not added a detailed description yet. Contact the shop if you need more information before deciding.'}
            </div>
            <dl className="pd-spec-list">
              <div className="pd-spec-row">
                <dt className="pd-spec-label">Category</dt>
                <dd className="pd-spec-value">{product.category}</dd>
              </div>
              <div className="pd-spec-row">
                <dt className="pd-spec-label">Availability</dt>
                <dd className="pd-spec-value">{product.stock > 0 ? 'In stock' : 'Ask provider'}</dd>
              </div>
              <div className="pd-spec-row">
                <dt className="pd-spec-label">Options</dt>
                <dd className="pd-spec-value">{product.variations.length > 0 ? `${product.variations.length} available` : 'Standard'}</dd>
              </div>
            </dl>
          </div>
        </article>

        {/* Related Products (real data) */}
        {relatedProducts.length > 0 && (
          <div className="pd-related">
            <div className="pd-related-header">
              <span>More from {product.shopName}</span>
              <Link to={`/shop/${product.shopId}`}>View shop <span aria-hidden="true">→</span></Link>
            </div>
            <div className="pd-related-grid">
              {relatedProducts.map(rp => (
                <Link to={`/funeral/product/${rp.id}`} key={rp.id} className="pd-related-card">
                  {rp.imageUrl ? (
                    <img src={rp.imageUrl} alt={rp.name} className="pd-related-img" />
                  ) : (
                    <div className="pd-related-img pd-related-img-empty">No image</div>
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

      </main>

      {/* Image Modal */}
      {isImageModalOpen && (
        <div className="pd-image-modal-overlay" onClick={() => setIsImageModalOpen(false)} role="presentation">
          <div className="pd-image-modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Images of ${product.name}`}>
            <div className="pd-image-modal-left">
              <img src={gallery[galleryIndex] || product.imageUrl || ''} alt={product.name} />
              {gallery.length > 1 && <button
                type="button"
                className="pd-image-modal-nav pd-image-modal-prev" 
                onClick={() => setGalleryIndex((prev) => (prev > 0 ? prev - 1 : gallery.length - 1))}
                aria-label="Previous image"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>}
              {gallery.length > 1 && <button
                type="button"
                className="pd-image-modal-nav pd-image-modal-next" 
                onClick={() => setGalleryIndex((prev) => (prev < gallery.length - 1 ? prev + 1 : 0))}
                aria-label="Next image"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>}
            </div>
            <div className="pd-image-modal-right">
              <button ref={imageCloseRef} type="button" className="pd-image-modal-close" onClick={() => setIsImageModalOpen(false)} aria-label="Close image viewer">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
              <h2 className="pd-image-modal-title">{product.name}</h2>
              <div className="pd-image-modal-gallery">
                {gallery.map((url, idx) => (
                  <button
                    type="button"
                    key={idx} 
                    className={`pd-image-modal-thumb ${idx === galleryIndex ? 'active' : ''}`}
                    onClick={() => setGalleryIndex(idx)}
                    aria-label={`View image ${idx + 1}`}
                    aria-pressed={idx === galleryIndex}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Added to Cart Toast — Centered Card */}
      {showAddedToast && (
        <div className="pd-added-overlay" role="status" aria-live="polite">
          <div className="pd-added-card">
            <div className="pd-added-icon-ring">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="pd-added-heading">Added to cart</p>
          </div>
        </div>
      )}

      {showShareToast && (
        <div className="pd-login-toast" role="status" aria-live="polite">
          <div className="pd-login-toast-content pd-share-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>Product link copied.</span>
          </div>
        </div>
      )}

      {/* Login Toast */}
      {showLoginToast && (
        <div className="pd-login-toast" role="status" aria-live="polite">
          <div className="pd-login-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <span><Link to="/login" className="pd-login-link">Log in</Link> to add favorites.</span>
          </div>
        </div>
      )}

      {/* Select Variation Toast */}
      {showVariationToast && (
        <div className="pd-login-toast" role="status" aria-live="polite">
          <div className="pd-login-toast-content pd-variation-toast-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>Select a variation before adding this product.</span>
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
