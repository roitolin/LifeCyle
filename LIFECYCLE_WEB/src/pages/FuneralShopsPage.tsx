import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import HeaderAccountMenu from '@/components/HeaderAccountMenu'
import MarketplaceFooter from '@/components/MarketplaceFooter'
import MarketplaceMobileDrawer from '@/components/MarketplaceMobileDrawer'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'
import { SkeletonBlock, SkeletonRegion } from '@/components/ContentSkeleton'
import ImageWithSkeleton from '@/components/ImageWithSkeleton'
import { createMarketplaceResource, earliestShopExpiry, useMarketplaceResource } from '@/hooks/useMarketplaceResource'
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
}

const shopDirectoryResource = createMarketplaceResource(async () => {
  const { data, error } = await supabase
    .from('funeral_shops')
    .select('id, shopName, shopAddress, shopPhoneNumber, shopImageUrl, businessName, generalLocation, paidUntil')
    .eq('status', 'live')
    .gt('paidUntil', new Date().toISOString())
    .order('shopName', { ascending: true })

  if (error) throw error
  const rows = data ?? []
  const shops: ShopRecord[] = rows.map(row => ({
    id: String(row.id),
    shopName: String(row.shopName || ''),
    shopAddress: String(row.shopAddress || ''),
    shopPhoneNumber: String(row.shopPhoneNumber || ''),
    shopImageUrl: row.shopImageUrl || null,
    businessName: String(row.businessName || ''),
    generalLocation: String(row.generalLocation || ''),
  }))
  return { data: shops, expiresAt: earliestShopExpiry(rows.map(row => row.paidUntil)) }
})

const SHOP_GRID = "funeral-shops-grid"
const SHOP_CARD = "funeral-shop-card"
const SHOP_IMAGE = "funeral-shop-card-image"

export default function FuneralShopsPage() {
  const navigate = useNavigate()
  const viewer = useOutletContext<User | null>()
  const viewerId = viewer?.id ?? null
  const [userProfile, setUserProfile] = useState<any>(null)
  const { data: shops = [], loading, error } = useMarketplaceResource(shopDirectoryResource, viewerId, 'Unable to load shops.')
  const [cartCount, setCartCount] = useState(0)
  const [queryText, setQueryText] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null)
  const isLoggedIn = Boolean(viewer)

  useEffect(() => {
    if (!viewerId) return
    const controller = new AbortController()
    void supabase.from('users').select('fullName, photoURL, gender').eq('id', viewerId)
      .abortSignal(controller.signal).maybeSingle().then(({ data }) => {
        if (!controller.signal.aborted) setUserProfile(data)
      })
    return () => controller.abort()
  }, [viewerId])

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

  const filtered = shops.filter(s => {
    const q = String(queryText ?? '').trim().toLowerCase()
    return !q || `${s.shopName} ${s.businessName} ${s.generalLocation} ${s.shopAddress}`.toLowerCase().includes(q)
  })

  const accountPath = isLoggedIn ? '/user/profile' : '/login?next=/user/profile'
  const serviceRequestsPath = isLoggedIn ? '/user/requests' : '/login?next=/user/requests'
  const helpPath = isLoggedIn ? '/user/help' : '/login?next=/user/help'

  const openMessages = () => {
    setMobileMenuOpen(false)
    if (!isLoggedIn) {
      navigate('/login?next=/funeral/shops')
      return
    }
    window.dispatchEvent(new CustomEvent('open-chat'))
  }

  return (
    <div className="sp-page funeral-shops-page">
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
          <div className="sp-mobile-brand-row">
            <button
              type="button"
              className="sp-mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-haspopup="dialog"
              aria-expanded={mobileMenuOpen}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <BrandLogo compact className='sp-brand-logo' />
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

          <div className="sp-header-actions">
            <div className="sp-cart-area">
              <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Shopping cart" title="Shopping cart">
                <HeaderCartIcon />
                {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="sp-container funeral-shops-content mx-auto min-h-[calc(100vh-150px)] w-full max-w-[1200px] px-4 pb-[60px] pt-5 max-[480px]:px-3 max-[480px]:pb-10 max-[480px]:pt-3.5">
        <div className="page-back-row funeral-shops-back"><PageBackButton /></div>

        <section className="funeral-shops-intro" aria-labelledby="funeral-shops-title">
          <h1 id="funeral-shops-title" className="funeral-shops-title">Funeral shops</h1>
          {!loading && !error && <p className="funeral-shops-count">{filtered.length} {filtered.length === 1 ? 'shop' : 'shops'}</p>}
        </section>

        {loading ? (
          <SkeletonRegion label="Loading shops">
            <div className={SHOP_GRID}>
              {[0, 1, 2, 3].map(index => (
                <article className={SHOP_CARD} key={index}>
                  <div className={SHOP_IMAGE}><SkeletonBlock className="lc-skeleton-fill" /></div>
                  <div className="funeral-shop-card-details"><SkeletonBlock className="lc-skeleton-name" /><SkeletonBlock /><SkeletonBlock className="lc-skeleton-short" /></div>
                  <div className="funeral-shop-card-actions"><SkeletonBlock className="lc-skeleton-control" /><SkeletonBlock className="lc-skeleton-control" /></div>
                </article>
              ))}
            </div>
          </SkeletonRegion>
        ) : error ? (
          <div className="funeral-shops-state funeral-shops-state--error box-border flex min-h-[148px] flex-col items-center gap-3 rounded-lg bg-white px-6 py-[60px] text-center text-sm leading-[1.6] text-[#b91c1c] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="funeral-shops-state box-border flex min-h-[148px] flex-col items-center gap-3 rounded-lg bg-white px-6 py-[60px] text-center text-sm leading-[1.6] text-[#66746f] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <p className="m-0 max-w-[420px]">No funeral shops are currently available.</p>
          </div>
        ) : (
          <div className={`${SHOP_GRID} lc-content-reveal`}>
            {filtered.map((shop, index) => (
              <article key={shop.id} className={SHOP_CARD}>
                {shop.shopImageUrl ? (
                  <ImageWithSkeleton
                    src={shop.shopImageUrl}
                    alt={`${shop.shopName} logo`}
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                    className={SHOP_IMAGE}
                    deliveryWidth={320}
                    deliveryHeight={320}
                    deliveryFit="contain"
                    sizes="108px"
                  />
                ) : (
                  <div className="funeral-shop-card-placeholder">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22312d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  </div>
                )}

                <div className="funeral-shop-card-details">
                  <h2 className="funeral-shop-card-name">{shop.shopName}</h2>
                  <div className="funeral-shop-card-meta">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    {shop.generalLocation || shop.shopAddress || 'Location not available'}
                  </div>
                  {shop.shopPhoneNumber ? (
                    <div className="funeral-shop-card-meta">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      {shop.shopPhoneNumber}
                    </div>
                  ) : null}
                  {shop.businessName && shop.businessName.trim().toLowerCase() !== shop.shopName.trim().toLowerCase() ? <div className="funeral-shop-card-business">{shop.businessName}</div> : null}
                </div>

                <div className="funeral-shop-card-actions">
                  <Link className="funeral-shop-card-action" to={`/shop/${shop.id}`}>
                    View products
                  </Link>
                  <Link className="funeral-shop-card-action funeral-shop-card-custom" to={`/funeral/custom-casket/${shop.id}`}>
                    Custom casket
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <MarketplaceFooter />
    </div>
  )
}
