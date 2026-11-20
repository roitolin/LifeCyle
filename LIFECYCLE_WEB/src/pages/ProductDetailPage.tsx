import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { addFuneralCartItem, loadFuneralCart } from '@/utils/funeralCart'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import HeaderAccountMenu from '@/components/HeaderAccountMenu'
import MarketplaceFooter from '@/components/MarketplaceFooter'
import MarketplaceMobileDrawer from '@/components/MarketplaceMobileDrawer'
import PageBackButton from '@/components/PageBackButton'
import { ProductDetailSkeleton } from '@/components/ContentSkeleton'
import ImageWithSkeleton from '@/components/ImageWithSkeleton'
import ProductRating from '@/components/ProductRating'
import { summarizeProductRatings } from '@/utils/productRatings'
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
  variations: { id: string; name: string; price?: number | null; imageUrl?: string | null }[]
  packageItems: PackageDisplayItem[] | null
  downpaymentEnabled: boolean
  downpaymentAmount: number | null
  downpaymentPercentage: number | null
  rating: number
  ratingCount: number
}

type ShopPackage = {
  items?: { id?: string; name?: string; imageUrl?: string | null }[] | null
  flowersImageUrl?: string | null
  candlesImageUrl?: string | null
  curtainsImageUrl?: string | null
  vehicleImageUrl?: string | null
  active?: boolean
}

type PackageDisplayItem = {
  name: string
  imageUrl?: string | null
}

type RelatedProduct = {
  id: string
  name: string
  price: number
  stock: number
  imageUrl: string | null
  rating: number
  ratingCount: number
}

type ProductResult = { id: string; product?: Product; error?: string }

function getPackageItems(row?: ShopPackage | null): PackageDisplayItem[] {
  if (!row || row.active === false) return []
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items
      .map(item => ({
        name: String(item?.name || '').trim(),
        imageUrl: item?.imageUrl || null,
      }))
      .filter(item => Boolean(item.name && item.imageUrl))
  }
  return [
    { name: 'Flowers', imageUrl: row.flowersImageUrl },
    { name: 'Candles', imageUrl: row.candlesImageUrl },
    { name: 'Curtains', imageUrl: row.curtainsImageUrl },
    { name: 'Vehicle', imageUrl: row.vehicleImageUrl },
  ].filter(item => Boolean(item.imageUrl))
}

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
const HeartIcon = ({ filled }: { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
  </svg>
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
  const viewer = useOutletContext<User | null>()
  const [result, setResult] = useState<ProductResult | null>(null)
  const current = result?.id === productId ? result : null
  const product = current?.product
  const error = current?.error
  const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([])
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [selectedVariation, setSelectedVariation] = useState<string | null>(null)
  const [cartCount, setCartCount] = useState(0)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [queryText, setQueryText] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const imageTriggerRef = useRef<HTMLButtonElement>(null)
  const imageCloseRef = useRef<HTMLButtonElement>(null)
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (productId && viewer) {
      const favs = readStoredFavorites()
      setIsFavorite(!!favs[productId])
    } else {
      setIsFavorite(false)
    }
  }, [productId, viewer])

  const [showLoginToast, setShowLoginToast] = useState(false)
  const [cartNotice, setCartNotice] = useState<{ productId: string; revision: number; success: boolean } | null>(null)
  const cartNoticeTimer = useRef<number | undefined>(undefined)
  const cartNoticeRevision = useRef(0)
  const currentCartNotice = cartNotice?.productId === productId ? cartNotice : null

  useEffect(() => () => window.clearTimeout(cartNoticeTimer.current), [productId])

  const announceCartUpdate = (id: string, success: boolean) => {
    window.clearTimeout(cartNoticeTimer.current)
    setCartNotice({ productId: id, revision: ++cartNoticeRevision.current, success })
    cartNoticeTimer.current = window.setTimeout(() => setCartNotice(null), 3400)
  }
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
  const selectedVariationItem = variations.find(variation => variation.id === selectedVariation) || null
  const selectedProductPrice = selectedVariationItem?.price && selectedVariationItem.price > 0
    ? selectedVariationItem.price
    : product?.price || 0
  const calculatedTotal = selectedProductPrice
  const canUseDownpayment = Boolean(
    product?.downpaymentEnabled
    && product.downpaymentAmount
    && product.downpaymentPercentage
    && product.downpaymentAmount <= calculatedTotal
  )
  const baseGallery = product?.galleryImageUrls.length ? product.galleryImageUrls
    : product?.imageUrl ? [product.imageUrl]
    : []
  const gallery = Array.from(new Set([
    ...baseGallery,
    ...variations.map(variation => variation.imageUrl).filter((url): url is string => Boolean(url)),
  ]))
  const isLoggedIn = Boolean(viewer)

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
    const controller = new AbortController()
    const { signal } = controller
    setResult(null)
    setRelatedProducts([])
    void (async () => {
      try {
        const { data, error: err } = await supabase
          .from('funeral_products')
          .select(`
            id, name, description, price, stock, "imageUrl", active, "shopId", "hasVariations", "downpaymentEnabled", "downpaymentAmount", "downpaymentPercentage",
            funeral_product_images ( "imageUrl", "displayOrder" ),
            funeral_product_variations ( id, name, price, "imageUrl" ),
            funeral_product_ratings ( rating ),
            funeral_shops!inner ( "shopName", "shopImageUrl", "shopAddress", "shopPhoneNumber", "generalLocation", status )
          `)
          .eq('id', productId)
          .eq('active', true)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
          .abortSignal(signal)
          .maybeSingle()

        if (signal.aborted) return
        if (err) throw err
        if (!data) {
          setResult({ id: productId, error: 'Product not found.' })
          return
        }

        const row = data as any
        const ratingSummary = summarizeProductRatings(row.funeral_product_ratings)
        const imgs = (row.funeral_product_images ?? []) as any[]
        const sorted = [...imgs].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        const galleryUrls = sorted.map((img: any) => img.imageUrl).filter((url: string) => Boolean(url))
        const vars = (row.funeral_product_variations ?? []) as any[]
        const variationList = vars.map((v: any) => ({
          id: String(v.id),
          name: String(v.name || 'Standard'),
          price: v.price == null ? null : Number(v.price),
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
          packageItems: null,
          downpaymentEnabled: Boolean(row.downpaymentEnabled),
          downpaymentAmount: row.downpaymentAmount == null ? null : Number(row.downpaymentAmount),
          downpaymentPercentage: row.downpaymentPercentage == null ? null : Number(row.downpaymentPercentage),
          rating: ratingSummary.average,
          ratingCount: ratingSummary.count,
        }

        setResult({ id: productId, product: productData })
        setGalleryIndex(0)
        setSelectedVariation(null)

        const packageRequest = supabase
          .from('funeral_shop_packages')
          .select('items, "flowersImageUrl", "candlesImageUrl", "curtainsImageUrl", "vehicleImageUrl", active')
          .eq('shopId', productData.shopId)
          .eq('active', true)
          .abortSignal(signal)
          .maybeSingle()
          .then(({ data: packageData }) => {
            if (signal.aborted) return
            const packageItems = getPackageItems(packageData as ShopPackage | null)
            setResult(previous => previous?.id === productId && previous.product
              ? { id: productId, product: { ...previous.product, packageItems } }
              : previous)
          })

        // Load related products from the same shop (excluding this product)
        const relatedRequest = supabase
          .from('funeral_products')
          .select(`id, name, price, stock, "imageUrl", active, funeral_product_ratings(rating), funeral_shops!inner(status)`)
          .eq('active', true)
          .gt('stock', 0)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
          .eq('shopId', productData.shopId)
          .neq('id', productId)
          .limit(6)
          .abortSignal(signal)
          .then(({ data: relData }) => {
            if (!relData || signal.aborted) return
            setRelatedProducts(relData.map(row => {
              const summary = summarizeProductRatings(row.funeral_product_ratings)
              return {
                id: String(row.id),
                name: String(row.name ?? ''),
                price: Number(row.price) || 0,
                stock: Number(row.stock) || 0,
                imageUrl: row.imageUrl ?? null,
                rating: summary.average,
                ratingCount: summary.count,
              }
            }))
          })

        await Promise.allSettled([packageRequest, relatedRequest])
      } catch (e) {
        if (signal.aborted) return
        console.error('Unable to load product details', e)
        setResult({ id: productId, error: 'We could not load this product right now. Please try again.' })
      }
    })()
    return () => controller.abort()
  }, [productId])

  const handleAddToCart = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/product/' + productId)
      return
    }
    if (!product?.packageItems) return
    if (product.variations.length > 0 && !selectedVariation) {
      setShowVariationToast(true)
      window.requestAnimationFrame(() => document.getElementById('pd-variations')?.focus())
      setTimeout(() => setShowVariationToast(false), 3000)
      return
    }
    const varItem = product.variations.find(v => v.id === selectedVariation)
    try {
      addFuneralCartItem({
        productId: product.id,
        shopId: product.shopId,
        shopName: product.shopName,
        name: product.name,
        price: calculatedTotal,
        fullPrice: calculatedTotal,
        paymentOption: 'full',
        downpaymentAmount: product.downpaymentAmount,
        downpaymentPercentage: product.downpaymentPercentage,
        remainingBalance: 0,
        imageUrl: varItem?.imageUrl ?? product.imageUrl,
        variationId: varItem?.id ?? null,
        variationName: varItem?.name ?? null,
        packageItems: product.packageItems.map(item => item.name),
        quantity: 1,
      })
      announceCartUpdate(product.id, true)
    } catch {
      announceCartUpdate(product.id, false)
    }
  }

  const handleBuyNow = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/product/' + productId)
      return
    }
    if (!product?.packageItems) return
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
      price: calculatedTotal,
      fullPrice: calculatedTotal,
      paymentOption: 'full',
      downpaymentAmount: product.downpaymentAmount,
      downpaymentPercentage: product.downpaymentPercentage,
      remainingBalance: 0,
      imageUrl: varItem?.imageUrl ?? product.imageUrl,
      variationId: varItem?.id ?? null,
      variationName: varItem?.name ?? null,
      packageItems: product.packageItems.map(item => item.name),
      quantity: 1,
    })
    navigate('/user/cart')
  }

  const loadingProduct = Boolean(productId && !current)
  if (!loadingProduct && (error || !product)) {
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

  const mainImage = gallery[galleryIndex] || product?.imageUrl || ''
  const waitingForPackage = Boolean(isLoggedIn && product && product.stock > 0 && product.packageItems === null)
  const accountPath = isLoggedIn ? '/user/profile' : '/login?next=/user/profile'
  const serviceRequestsPath = isLoggedIn ? '/user/requests' : '/login?next=/user/requests'
  const helpPath = isLoggedIn ? '/user/help' : '/login?next=/user/help'

  const openMessages = () => {
    setMobileMenuOpen(false)
    if (!isLoggedIn) {
      navigate(`/login?next=/funeral/product/${productId ?? ''}`)
      return
    }
    window.dispatchEvent(new CustomEvent('open-chat'))
  }

  return (
    <div className="pd-page marketplace-page-shell">
      <MarketplaceMobileDrawer
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        closeButtonRef={mobileMenuCloseRef}
        isLoggedIn={isLoggedIn}
        userName={userProfile?.fullName}
        userEmail={viewer?.email}
        photoUrl={userProfile?.photoURL}
        gender={userProfile?.gender}
        accountPath={accountPath}
        serviceRequestsPath={serviceRequestsPath}
        helpPath={helpPath}
        onOpenMessages={openMessages}
      />

      {/* ── Topbar ── */}
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left">
            <Link to="/seller">Shop Center</Link>
          </div>
          <div className="sp-topbar-right">
            <AnnouncementDropdown />
            <Link to="/user/help">Help Centre</Link>
            {isLoggedIn && <span className="sp-divider" aria-hidden="true">|</span>}
            {isLoggedIn
              ? (
                <HeaderAccountMenu profile={userProfile} fallbackName={viewer?.email} />
              )
              : <><Link to="/register" className="sp-signup">Sign Up</Link><Link to="/login">Login</Link></>}
          </div>
        </div>
      </div>

      {/* ── Header ── */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="pd-mobile-brand-row">
            <button
              type="button"
              className="pd-mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={mobileMenuOpen}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
            </button>
            <BrandLogo to="/funeral" compact className="pd-brand-logo" />
          </div>

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && navigate(`/funeral?search=${encodeURIComponent(queryText)}`)}
                placeholder="Search products"
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" onClick={() => navigate(`/funeral?search=${encodeURIComponent(queryText)}`)} aria-label="Search">
                <SearchIcon />
              </button>
            </div>
          </div>

          <div className="pd-header-actions">
            <div className="sp-cart-area">
              <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Shopping cart" title="Shopping cart">
                <HeaderCartIcon />
                {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="pd-container">
        <div className="pd-product-nav">
          <PageBackButton />
          <nav className="pd-product-path" aria-label="Breadcrumb">
            <Link to="/funeral">Catalog</Link>
            {product && <>
              <span aria-hidden="true">/</span>
              <Link to={`/funeral?search=${encodeURIComponent(product.category)}`}>{product.category}</Link>
            </>}
          </nav>
        </div>

        {loadingProduct && <ProductDetailSkeleton />}
        {product && <>
        {/* Main Product Card */}
        <div className="pd-main-card lc-content-reveal">
          
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
                <ImageWithSkeleton src={mainImage} alt={product.name} fetchPriority="high" style={{ objectFit: "contain" }} />
              ) : (
                <span className="pd-image-placeholder">No image available</span>
              )}
              {mainImage && <span className="pd-image-zoom">View larger</span>}
            </button>
            
            {gallery.length > 1 && (
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
                <HeartIcon filled={isFavorite} />
                <span>{isFavorite ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          </div>

          {/* Info Right */}
          <div className="pd-info-section">
            <h1 className="pd-title">{product.name}</h1>
            <Link className="pd-listing-shop" to={`/shop/${product.shopId}`}>{product.shopName}</Link>
            
            <div className="pd-meta">
              <div className="pd-meta-item">
                <ProductRating rating={product.rating} count={product.ratingCount} />
              </div>
              <div className="pd-meta-item">
                <span className={`pd-stock-dot${product.stock <= 0 ? ' pd-stock-dot--unavailable' : ''}`} aria-hidden="true" />
                <span>{product.stock > 0 ? `${product.stock} in stock` : 'Sold out'}</span>
              </div>
            </div>

            <div className="pd-price-block">
              <span className="pd-price-label">Full product price</span>
              <div className="pd-price-value">{formatPeso(calculatedTotal)}</div>
              {canUseDownpayment ? (
                <span className="pd-price-breakdown">
                  Down payment {formatPeso(Number(product?.downpaymentAmount))} ({product?.downpaymentPercentage}%) can be selected after shop approval.
                </span>
              ) : null}
              {selectedVariationItem && (
                <span className="pd-price-breakdown">
                  Selected variation: {selectedVariationItem.name}
                </span>
              )}
            </div>



            {variations.length > 0 && (
              <div
                className={`pd-option-row align-start${showVariationToast ? ' has-error' : ''}`}
                id="pd-variations"
                tabIndex={-1}
              >
                <div className="pd-option-label">Variation</div>
                <div className="pd-option-content">
                  {variations.map(v => (
                    <button
                      type="button"
                      key={v.id} 
                      className={`pd-variation-btn ${selectedVariation === v.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedVariation(v.id)
                        setShowVariationToast(false)
                        if (v.imageUrl) {
                          const imageIndex = gallery.indexOf(v.imageUrl)
                          if (imageIndex >= 0) setGalleryIndex(imageIndex)
                        }
                      }}
                      aria-pressed={selectedVariation === v.id}
                    >
                      {v.imageUrl ? (
                        <img src={v.imageUrl} alt={v.name} className="pd-variation-img" />
                      ) : (
                        <span className="pd-variation-fallback" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                            <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
                            <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.1V21" />
                          </svg>
                        </span>
                      )}
                      <span className="pd-variation-copy">
                        <strong>{v.name}</strong>
                      </span>
                    </button>
                  ))}
                </div>
                {showVariationToast && <p className="pd-variation-error">Select a variation before continuing.</p>}
              </div>
            )}


            {product.packageItems && product.packageItems.length > 0 && (
            <section className="pd-package-section" aria-labelledby="pd-package-title">
              <div className="pd-package-heading">
                <div className="pd-option-label" id="pd-package-title">Package inclusions</div>
                <p className="pd-package-intro">Included in the displayed price</p>
              </div>
              <div className="pd-package-options" role="list">
                {product.packageItems.map(option => (
                    <div
                      key={option.name}
                      className="pd-package-item"
                      aria-label={`${option.name}, included in the casket price`}
                      role="listitem"
                    >
                      <div className="pd-package-media">
                        {option.imageUrl ? (
                          <img src={option.imageUrl} alt={option.name} className="pd-package-img" loading="lazy" />
                        ) : (
                          <div className="pd-package-fallback" aria-hidden="true">{option.name.slice(0, 1).toUpperCase()}</div>
                        )}
                      </div>
                      <div className="pd-package-copy"><strong title={option.name}>{option.name}</strong></div>
                    </div>
                ))}
              </div>
            </section>
            )}

            <p className="pd-single-order-note">One casket per service request</p>

            <div className="pd-actions-row">
              <button type="button" className={`pd-btn pd-btn-cart${currentCartNotice?.success ? ' pd-btn-cart--added' : ''}`} aria-label="Add to cart"
                onClick={handleAddToCart} disabled={product.stock <= 0 || waitingForPackage}>
                {currentCartNotice?.success ? <span className="pd-cart-check" key={currentCartNotice.revision}><CartCheckIcon /></span> : <CartIcon />}
                {currentCartNotice?.success ? 'Added to cart' : 'Add to cart'}
              </button>
              <button className="pd-btn pd-btn-buy" onClick={handleBuyNow} disabled={product.stock <= 0 || waitingForPackage}>
                Buy now · {formatPeso(calculatedTotal)}
              </button>
            </div>
            {waitingForPackage && <p className="pd-login-note" role="status">Loading package details…</p>}
            {!isLoggedIn && (
              <p className="pd-login-note">You can browse freely. Sign in when you are ready to check out.</p>
            )}

          </div>
        </div>

        {/* Product Description */}
        <article className="pd-details-card">
          <h2 className="pd-section-header">Product description</h2>
          <div className="pd-details-layout">
            <dl className="pd-spec-list">
              <div className="pd-spec-row">
                <dt className="pd-spec-label">Availability</dt>
                <dd className="pd-spec-value">{product.stock > 0 ? 'In stock' : 'Sold out'}</dd>
              </div>
              <div className="pd-spec-row">
                <dt className="pd-spec-label">Variations</dt>
                <dd className="pd-spec-value">{product.variations.length > 0 ? `${product.variations.length} ${product.variations.length === 1 ? 'option' : 'options'}` : 'Standard'}</dd>
              </div>
            </dl>
            <div className="pd-desc-content">
              {product.description || 'No description provided by the seller.'}
            </div>
          </div>
        </article>

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
                <Link className="pd-shop-btn pd-shop-btn-outline" to={`/shop/${product.shopId}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  View shop
                </Link>
              </div>
            </div>
          </div>
          <div className="pd-shop-right">
            {product.shopAddress && <div className="pd-shop-stat"><strong>Location</strong><span>{product.shopAddress}</span></div>}
            {product.shopPhoneNumber && <div className="pd-shop-stat"><strong>Contact</strong><span>{product.shopPhoneNumber}</span></div>}
          </div>
        </div>

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
                    <img src={rp.imageUrl} alt={rp.name} className="pd-related-img" loading="lazy" decoding="async" />
                  ) : (
                    <div className="pd-related-img pd-related-img-empty">No image</div>
                  )}
                  <div className="pd-related-info">
                    <div className="pd-related-name">{rp.name}</div>
                    <div className="pd-related-price-row">
                      <span className="pd-related-price">{formatPeso(rp.price)}</span>
                      <span className="pd-related-sold">{rp.stock} in stock</span>
                    </div>
                    <ProductRating rating={rp.rating} count={rp.ratingCount} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        </>}
      </main>
      <MarketplaceFooter />

      {/* Image Modal */}
      {product && isImageModalOpen && (
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

      <div className="pd-cart-notice-region" role="status" aria-live="polite" aria-atomic="true">
        {currentCartNotice && (
          <div className={`pd-cart-notice${currentCartNotice.success ? '' : ' pd-cart-notice--error'}`} key={currentCartNotice.revision}>
            {currentCartNotice.success && <CartCheckIcon />}
            <span>{currentCartNotice.success ? 'Added to cart' : 'Could not add this item. Try again.'}</span>
          </div>
        )}
      </div>

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

function CartCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
