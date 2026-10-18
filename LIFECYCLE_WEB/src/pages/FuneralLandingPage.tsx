import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import BrandLogo from '@/components/BrandLogo'
import AnnouncementDropdown from '@/components/AnnouncementDropdown'
import NotificationDropdown from '@/components/NotificationDropdown'
import LogoutLink from '@/components/LogoutLink'
import { loadFuneralCart } from '@/utils/funeralCart'
import { PAYMENT_LOGOS } from '@/assets/paymentLogoAssets'
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

type MobileMenuIconName = 'home' | 'account' | 'shop' | 'messages' | 'purchases' | 'help' | 'logout'

const MOBILE_MENU_ICON_PATHS: Record<MobileMenuIconName, string[]> = {
  home: ['m3 11 9-8 9 8', 'M5 10v11h14V10M9 21v-7h6v7'],
  account: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 21a7.5 7.5 0 0 1 15 0'],
  shop: ['M3 9h18l-2-6H5L3 9Z', 'M5 9v12h14V9M9 21v-7h6v7'],
  messages: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z'],
  purchases: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18M16 10a4 4 0 0 1-8 0'],
  help: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01'],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4'],
}

function MobileMenuIcon({ name }: { name: MobileMenuIconName }) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      {MOBILE_MENU_ICON_PATHS[name].map(path => <path d={path} key={path} />)}
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()

  /* Filters */
  const [queryText,        setQueryText]        = useState('')
  const [selectedShopId,   setSelectedShopId]   = useState('all')
  const [minPrice,         setMinPrice]          = useState('')
  const [maxPrice,         setMaxPrice]          = useState('')
  const [sortBy,           setSortBy]            = useState('Relevance')
  const [page,             setPage]              = useState(1)
  const [filtersOpen,      setFiltersOpen]       = useState(false)
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
  const activeFilterCount = Number(selectedShopId !== 'all') + Number(Boolean(minPrice)) + Number(Boolean(maxPrice))

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
    if (!filtersOpen) return

    const previousOverflow = document.body.style.overflow
    const root = document.documentElement
    const viewport = window.visualViewport
    let viewportFrame = 0
    const closeCatalogPopup = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setFiltersOpen(false)
    }
    const syncVisualViewport = () => {
      window.cancelAnimationFrame(viewportFrame)
      viewportFrame = window.requestAnimationFrame(() => {
        const layoutHeight = document.documentElement.clientHeight
        const bottomInset = viewport
          ? Math.max(0, layoutHeight - viewport.height - viewport.offsetTop)
          : 0
        root.style.setProperty('--sp-visual-bottom-inset', `${Math.ceil(bottomInset)}px`)
      })
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeCatalogPopup)
    window.addEventListener('resize', syncVisualViewport)
    viewport?.addEventListener('resize', syncVisualViewport)
    viewport?.addEventListener('scroll', syncVisualViewport)
    syncVisualViewport()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeCatalogPopup)
      window.removeEventListener('resize', syncVisualViewport)
      viewport?.removeEventListener('resize', syncVisualViewport)
      viewport?.removeEventListener('scroll', syncVisualViewport)
      window.cancelAnimationFrame(viewportFrame)
      root.style.removeProperty('--sp-visual-bottom-inset')
    }
  }, [filtersOpen])

  const accountPath = isLoggedIn ? '/user/profile' : '/login?next=/user/profile'
  const purchasesPath = isLoggedIn ? '/user/purchase' : '/login?next=/user/purchase'
  const helpPath = isLoggedIn ? '/user/help' : '/login?next=/user/help'

  const openMessages = () => {
    setMobileMenuOpen(false)
    if (!isLoggedIn) {
      navigate('/login?next=/funeral')
      return
    }
    window.dispatchEvent(new CustomEvent('open-chat'))
  }
  /* â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  return (
    <div className='sp-page'>

      {mobileMenuOpen ? (
        <div className='sp-mobile-menu-layer'>
          <button
            type='button'
            className='sp-mobile-menu-backdrop'
            onClick={() => setMobileMenuOpen(false)}
            aria-label='Close navigation menu'
          />
          <aside className='sp-mobile-menu' role='dialog' aria-modal='true' aria-label='Navigation menu'>
            <div className='sp-mobile-menu-head'>
              <span>Menu</span>
              <button
                ref={mobileMenuCloseRef}
                type='button'
                className='sp-mobile-menu-close'
                onClick={() => setMobileMenuOpen(false)}
                aria-label='Close navigation menu'
              >
                <svg viewBox='0 0 24 24' aria-hidden='true'><path d='m6 6 12 12M18 6 6 18'/></svg>
              </button>
            </div>

            {isLoggedIn ? (
              <div className='sp-mobile-menu-profile'>
                {userProfile?.photoURL ? (
                  <img src={userProfile.photoURL} alt='' />
                ) : (
                  <span className='sp-mobile-menu-avatar'><MobileMenuIcon name='account' /></span>
                )}
                <div className='sp-mobile-menu-profile-copy'>
                  <strong>{userProfile?.fullName || 'My account'}</strong>
                  <span>{viewer?.email}</span>
                </div>
                <div className='sp-mobile-menu-profile-actions'>
                  <LogoutLink
                    className='sp-mobile-menu-profile-action sp-mobile-menu-logout'
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <MobileMenuIcon name='logout' />
                    <span>Log out</span>
                  </LogoutLink>
                </div>
              </div>
            ) : (
              <div className='sp-mobile-menu-guest-actions'>
                <Link className='sp-mobile-menu-profile-action' to='/login' onClick={() => setMobileMenuOpen(false)}>Sign in</Link>
                <Link className='sp-mobile-menu-profile-action sp-mobile-menu-primary' to='/register' onClick={() => setMobileMenuOpen(false)}>Sign up</Link>
              </div>
            )}

            <nav className='sp-mobile-menu-nav' aria-label='Mobile navigation'>
              <Link to='/funeral' onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name='home' /><span>Home</span></Link>
              <Link to={accountPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name='account' /><span>My Account</span></Link>
              <Link to='/seller' onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name='shop' /><span>Shop Center</span></Link>
              <button type='button' onClick={openMessages}><MobileMenuIcon name='messages' /><span>Messages</span></button>
              <div className='sp-mobile-menu-announcement'><AnnouncementDropdown menuItem /></div>
              <Link to={purchasesPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name='purchases' /><span>My Payments</span></Link>
              <Link to={helpPath} onClick={() => setMobileMenuOpen(false)}><MobileMenuIcon name='help' /><span>Help Centre</span></Link>
            </nav>

          </aside>
        </div>
      ) : null}

      {/* â”€â”€ Topbar â”€â”€ */}
      <div className="sp-topbar">
        <div className="sp-topbar-inner">
          <div className="sp-topbar-left">
            <Link to="/seller">Shop Center</Link>
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
            <AnnouncementDropdown />
            <NotificationDropdown variant="seller-centre" />
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
                    <Link to="/user/purchase">My Payments</Link>
                    <LogoutLink>Log out</LogoutLink>
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
          <div className='sp-mobile-brand-row'>
            <button
              type='button'
              className='sp-mobile-menu-trigger'
              onClick={() => setMobileMenuOpen(true)}
              aria-label='Open navigation menu'
              aria-haspopup='dialog'
              aria-expanded={mobileMenuOpen}
            >
              <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 7h16M4 12h16M4 17h16'/></svg>
            </button>
            <BrandLogo to="/funeral" compact className="sp-brand-logo" />
          </div>

          <div className="sp-search-wrap">
            <div className="sp-search-box">
              <input
                id="sp-search-input"
                type="search"
                value={queryText}
                onChange={e => { setQueryText(e.target.value); setPage(1) }}
                placeholder="Search products"
                aria-label="Search"
              />
              <button type="button" className="sp-search-btn" aria-label="Search">
                <SearchIcon />
              </button>
            </div>
          </div>

          <div className='sp-header-actions'>
            <div className='sp-mobile-header-notification'>
              <NotificationDropdown variant='seller-centre' />
            </div>
            <div className="sp-cart-area">
              <Link to={isLoggedIn ? '/user/cart' : '/login?next=/user/cart'} className="sp-cart-btn" aria-label="Shopping cart" title="Shopping cart">
                <CartIcon />
                {isLoggedIn && cartCount > 0 && <span className="sp-cart-count">{cartCount}</span>}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* â”€â”€ Body â”€â”€ */}
      <div className="sp-body">
        <div className="sp-body-inner">

          {filtersOpen ? <button type='button' className='sp-catalog-popup-backdrop' aria-label='Close filters' onClick={() => setFiltersOpen(false)} /> : null}

          {/* â”€â”€ Left Sidebar â”€â”€ */}
          <aside id="sp-search-filters" className={`sp-sidebar${filtersOpen ? ' is-open' : ''}`}>
            <div className="sp-sidebar-heading">
              <span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="11" y1="18" x2="20" y2="18"/></svg>
                Search filters
              </span>
              <button type="button" className="sp-sidebar-close" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>&times;</button>
            </div>

            <div className="sp-filter-scroll">
            <div className='sp-mobile-filter-sort'>
              <div className='sp-filter-title'>Sort by</div>
              <div className='sp-mobile-filter-sort-options'>
                {SORT_OPTIONS.map(option => (
                  <button
                    type='button'
                    key={option}
                    className={sortBy === option ? 'is-active' : ''}
                    onClick={() => { setSortBy(option); setPage(1) }}
                  >
                    {option}
                  </button>
                ))}
              </div>
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
            </div>

            <div className="sp-filter-actions">
              <button type="button" className="sp-clear-btn" onClick={clearFilters}>
                CLEAR ALL
              </button>
              <button type="button" className="sp-filter-done-btn" onClick={() => setFiltersOpen(false)}>
                SHOW RESULTS
              </button>
            </div>
          </aside>

          {/* â”€â”€ Main Content â”€â”€ */}
          <main className="sp-main">

            {/* Search result header */}
            <div className='sp-result-heading'>
              <div className="sp-result-label">
                {queryText
                  ? <>Search results for <strong>'{queryText}'</strong></>
                  : <>Available <strong>Caskets</strong></>}
              </div>
              <button
                type='button'
                className='sp-mobile-filter-btn'
                aria-label='Open filters and sorting'
                aria-expanded={filtersOpen}
                aria-controls='sp-search-filters'
                onClick={() => setFiltersOpen(true)}
              >
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'>
                  <line x1='4' y1='6' x2='20' y2='6' />
                  <line x1='8' y1='12' x2='20' y2='12' />
                  <line x1='11' y1='18' x2='20' y2='18' />
                </svg>
                {activeFilterCount > 0 ? <span>{activeFilterCount}</span> : null}
              </button>
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
            <a href="#guarantee">LifeCycle Guarantee</a>
            <Link to="/user/contact">Contact Us</Link>
          </div>
          <div>
            <h4>ABOUT LIFECYCLE</h4>
            <Link to="/user/about">About Us</Link>
            <a href="#careers">Careers</a>
            <Link to="/policies">Policies</Link>
            <Link to="/privacy-policy">Privacy Policy</Link>
            <Link to="/seller">Shop Center</Link>
          </div>
          <div>
            <h4>PAYMENT</h4>
            <div className="sp-footer-badges">
              <img className="sp-payment-logo" src={PAYMENT_LOGOS.gcash} alt="GCash" loading="lazy" />
              <img className="sp-payment-logo" src={PAYMENT_LOGOS.maya} alt="Maya" loading="lazy" />
              <img className="sp-payment-logo" src={PAYMENT_LOGOS.visa} alt="Visa" loading="lazy" />
              <img className="sp-payment-logo" src={PAYMENT_LOGOS.landbank} alt="Landbank" loading="lazy" />
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
        </div>
       </footer>
     </div>
   )
 }








