import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import BrandLogo from '@/components/BrandLogo'
import NotificationDropdown from '@/components/NotificationDropdown'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import LogoutLink from '@/components/LogoutLink'
import MarketplaceFooter from '@/components/MarketplaceFooter'
import MarketplaceMobileDrawer from '@/components/MarketplaceMobileDrawer'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart } from '@/utils/funeralCart'
import { getProfileAvatar } from '@/utils/profileAvatar'
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

export default function FuneralShopsPage() {
  const navigate = useNavigate()
  const [viewer, setViewer] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [shops, setShops] = useState<ShopRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cartCount, setCartCount] = useState(0)
  const [queryText, setQueryText] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null)
  const isLoggedIn = Boolean(viewer)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setViewer(data.session?.user ?? null))
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setViewer(s?.user ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (viewer?.id) {
      supabase.from('users').select('fullName, photoURL, gender').eq('id', viewer.id).maybeSingle().then(({ data }) => setUserProfile(data))
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
        setShops((data ?? []).map((row: any) => ({
          id: String(row.id),
          shopName: String(row.shopName || ''),
          shopAddress: String(row.shopAddress || ''),
          shopPhoneNumber: String(row.shopPhoneNumber || ''),
          shopImageUrl: row.shopImageUrl || null,
          businessName: String(row.businessName || ''),
          generalLocation: String(row.generalLocation || ''),
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

  const accountPath = isLoggedIn ? '/user/profile' : '/login?next=/user/profile'
  const purchasesPath = isLoggedIn ? '/user/purchase' : '/login?next=/user/purchase'
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
        purchasesPath={purchasesPath}
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
            <NotificationDropdown />
            <Link to="/user/help">Help Centre</Link>
            <span className="sp-divider">|</span>
            {isLoggedIn
              ? (
                <div className="sp-user-menu">
                  <div className="sp-user-menu-trigger">
                    <img src={getProfileAvatar(userProfile?.photoURL, userProfile?.gender)} alt="Avatar" className="sp-user-avatar" />
                    <span className="sp-user-name">{userProfile?.fullName || viewer?.email}</span>
                    <svg className="sp-user-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </div>
                  <div className="sp-user-dropdown">
                    <Link to="/user/profile">My Account</Link>
                    <Link to="/user/purchase">My Payments</Link>
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

      <main className="sp-container funeral-shops-content mx-auto min-h-[calc(100vh-150px)] w-full max-w-[1200px] px-4 pb-[60px] pt-5 max-[480px]:px-3 max-[480px]:pb-10 max-[480px]:pt-3.5">
        <div className="page-back-row funeral-shops-back"><PageBackButton /></div>

        <section className="funeral-shops-intro mb-6 box-border rounded-md border border-[#d8e0e8] bg-[#f1f4f7] p-7 text-[#22312d] max-[768px]:mb-4 max-[768px]:px-[18px] max-[768px]:py-6 max-[480px]:px-4 max-[480px]:py-5" aria-labelledby="funeral-shops-title">
          <h1 id="funeral-shops-title" className="funeral-shops-title mb-2 text-[26px] font-bold max-[768px]:text-[22px]">Funeral shops</h1>
          <p className="funeral-shops-description mb-4 max-w-[640px] text-sm leading-[1.6] text-[#617087]">Browse active funeral shops and view their available products and contact details.</p>
          <div className="funeral-shops-count inline-flex items-center gap-1.5 rounded border border-[#d8e0e8] bg-white px-3.5 py-1.5 text-[13px] font-bold">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            {loading ? 'Loading…' : `${shops.length} available ${shops.length === 1 ? 'shop' : 'shops'}`}
          </div>
        </section>

        {loading ? (
          <div className="funeral-shops-state box-border flex min-h-[148px] flex-col items-center gap-3 rounded-lg bg-white px-6 py-[60px] text-center text-sm leading-[1.6] text-[#66746f] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <div className="funeral-shops-spinner size-7 animate-spin rounded-full border-[3px] border-[rgba(34,49,45,0.15)] border-t-[#22312d]" />
            <p className="m-0 max-w-[420px]">Loading shops…</p>
          </div>
        ) : error ? (
          <div className="funeral-shops-state funeral-shops-state--error box-border flex min-h-[148px] flex-col items-center gap-3 rounded-lg bg-white px-6 py-[60px] text-center text-sm leading-[1.6] text-[#b91c1c] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="funeral-shops-state box-border flex min-h-[148px] flex-col items-center gap-3 rounded-lg bg-white px-6 py-[60px] text-center text-sm leading-[1.6] text-[#66746f] shadow-[0_1px_1px_rgba(0,0,0,0.05)]">
            <p className="m-0 max-w-[420px]">No funeral shops are currently available.</p>
          </div>
        ) : (
          <div className="funeral-shops-grid box-border grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 max-[768px]:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] max-[768px]:gap-3 max-[480px]:grid-cols-[minmax(0,1fr)]">
            {filtered.map(shop => (
              <article key={shop.id} className="funeral-shop-card flex items-center gap-4 rounded-lg border border-[#eef1ee] bg-white p-4 shadow-[0_1px_1px_rgba(0,0,0,0.05)] max-[768px]:flex-col max-[768px]:items-stretch max-[768px]:text-center">
                {shop.shopImageUrl ? (
                  <img src={shop.shopImageUrl} alt={`${shop.shopName} logo`} loading="lazy" className="funeral-shop-card-image size-[84px] shrink-0 rounded-lg object-cover max-[768px]:h-[140px] max-[768px]:w-full max-[768px]:self-center max-[480px]:h-auto max-[480px]:aspect-video" />
                ) : (
                  <div className="funeral-shop-card-placeholder flex size-[84px] shrink-0 items-center justify-center rounded-lg bg-[#eef1ec] max-[768px]:h-[140px] max-[768px]:w-full max-[768px]:self-center max-[480px]:h-auto max-[480px]:aspect-video">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22312d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  </div>
                )}

                <div className="funeral-shop-card-details min-w-0 flex-1">
                  <h2 className="funeral-shop-card-name mb-1 truncate text-base font-extrabold text-[#22312d] max-[480px]:whitespace-normal">{shop.shopName}</h2>
                  <div className="funeral-shop-card-meta mt-[3px] flex items-center gap-[5px] truncate text-xs text-[#7d8682] max-[480px]:whitespace-normal">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    {shop.generalLocation || shop.shopAddress || 'Location not available'}
                  </div>
                  {shop.shopPhoneNumber ? (
                    <div className="funeral-shop-card-meta mt-[3px] flex items-center gap-[5px] truncate text-xs text-[#7d8682] max-[480px]:whitespace-normal">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                      {shop.shopPhoneNumber}
                    </div>
                  ) : null}
                  {shop.businessName ? <div className="funeral-shop-card-business mt-1.5 inline-block rounded bg-[#f2ede5] px-2 py-[3px] text-[11px] font-bold text-[#7f6653]">{shop.businessName}</div> : null}
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
