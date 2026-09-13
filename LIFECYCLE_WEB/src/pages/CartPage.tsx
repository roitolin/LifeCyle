import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart, removeFuneralCartItem, type WebFuneralCartItem } from '@/utils/funeralCart'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import BrandLogo from '@/components/BrandLogo'
import './CartPage.css'

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function CartPage() {
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [items, setItems] = useState<WebFuneralCartItem[]>(() => loadFuneralCart())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Load cart and profile
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session?.user)
      if (data.session?.user) {
        supabase.from('users').select('fullName, photoURL').eq('id', data.session.user.id).single()
          .then(({ data: ud }) => setProfile(ud))
      }
    })
    
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setIsLoggedIn(!!session?.user)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Group items by shop
  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.shopId]) {
      acc[item.shopId] = { shopName: item.shopName, items: [] }
    }
    acc[item.shopId].items.push(item)
    return acc
  }, {} as Record<string, { shopName: string, items: WebFuneralCartItem[] }>)

  const handleSelect = (cartId: string) => {
    const next = new Set(selectedIds)
    if (next.has(cartId)) next.delete(cartId)
    else next.add(cartId)
    setSelectedIds(next)
  }

  const handleSelectShop = (shopId: string, isSelected: boolean) => {
    const next = new Set(selectedIds)
    groupedItems[shopId].items.forEach(item => {
      if (isSelected) next.add(item.cartId)
      else next.delete(item.cartId)
    })
    setSelectedIds(next)
  }

  const handleSelectAll = (isSelected: boolean) => {
    if (isSelected) setSelectedIds(new Set(items.map(i => i.cartId)))
    else setSelectedIds(new Set())
  }

  const handleDelete = (cartId: string) => {
    openConfirm({
      title: 'Remove Item',
      message: 'Remove this item from your cart?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        setItems(removeFuneralCartItem(cartId))
        const next = new Set(selectedIds)
        next.delete(cartId)
        setSelectedIds(next)
      },
    })
  }

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) {
      openAlert({
        title: 'No Item Selected',
        message: 'Please select at least one item from your cart before deleting. Tick the box beside the item you wish to remove, then click Delete.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    openConfirm({
      title: 'Remove Items',
      message: 'Remove selected items from your cart?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        let currentItems = [...items]
        selectedIds.forEach(id => {
          currentItems = removeFuneralCartItem(id)
        })
        setItems(currentItems)
        setSelectedIds(new Set())
      },
    })
  }

  const checkout = () => {
    if (!isLoggedIn) {
      navigate('/login?next=/user/cart')
      return
    }
    if (selectedIds.size === 0) {
      openAlert({
        title: 'No Item Selected',
        message: 'Please select at least one item from your cart before proceeding to checkout. Tick the box beside the item you wish to order, then click Check Out to continue.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    // Funeral service requests are 1:1. We only support checking out one item at a time.
    if (selectedIds.size > 1) {
      openAlert({
        title: 'One Request at a Time',
        message: 'Only one funeral service request can be checked out at a time. Please deselect the remaining items and try again.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    
    const selectedItem = items.find(i => selectedIds.has(i.cartId))
    if (selectedItem) {
      navigate('/user/checkout', { state: { cartItem: selectedItem } })
    }
  }

  const selectedItems = items.filter(i => selectedIds.has(i.cartId))
  const totalPrice = selectedItems.reduce((acc, curr) => acc + curr.price, 0)

  return (
    <div className="cart-shop-page">
      <TopBar profile={profile} />
      <Header />

      <div className="cart-main">
        <div className="cart-page-nav">
          <button type="button" className="cart-back-btn" onClick={() => navigate(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
            Back
          </button>
        </div>

        {items.length === 0 ? (
          <div className="cart-empty">
            <h2>Your Cart is Empty</h2>
            <p>Looks like you haven't added anything to your cart yet.</p>
            <Link to="/funeral" className="shopee-btn-primary">Browse Services</Link>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="cart-table-header">
              <div className="header-col-product">
                <input 
                  type="checkbox" 
                  className="shopee-checkbox" 
                  checked={selectedIds.size === items.length && items.length > 0} 
                  onChange={(e) => handleSelectAll(e.target.checked)} 
                />
                Product
              </div>
              <div>Price</div>
              <div>Actions</div>
            </div>

            {/* Shop Blocks */}
            {Object.entries(groupedItems).map(([shopId, { shopName, items: shopItems }]) => {
              const allShopItemsSelected = shopItems.every(i => selectedIds.has(i.cartId))
              
              return (
                <div key={shopId} className="cart-shop-block">
                  <div className="cart-shop-header">
                    <input 
                      type="checkbox" 
                      className="shopee-checkbox" 
                      checked={allShopItemsSelected} 
                      onChange={(e) => handleSelectShop(shopId, e.target.checked)} 
                    />
                    <span className="chat-icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2C.9 2 0 2.9 0 4v7c0 1.1.9 2 2 2h9l3 3v-3c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM4 9H3V8h1v1zm0-3H3V5h1v1zm3 3H6V8h1v1zm0-3H6V5h1v1zm3 3H9V8h1v1zm0-3H9V5h1v1z"></path></svg></span>
                    {shopName}
                  </div>
                  
                  {shopItems.map(item => (
                    <div key={item.cartId} className="cart-item-row">
                      <div className="item-col-product">
                        <input 
                          type="checkbox" 
                          className="shopee-checkbox" 
                          checked={selectedIds.has(item.cartId)} 
                          onChange={() => handleSelect(item.cartId)} 
                        />
                        {item.imageUrl ? <img src={item.imageUrl} className="item-image" alt="Item" /> : <div className="item-fallback-image">LC</div>}
                        <div className="item-details">
                          <div className="item-name">{item.name}</div>
                          {item.variationName && <div className="item-variation">Variation: {item.variationName}</div>}
                          {item.packageItems?.length ? (
                            <div className="item-variation">Packages: {item.packageItems.join(', ')}</div>
                          ) : null}
                        </div>
                      </div>
                      <div className="item-col-price">{formatPeso(item.price)}</div>
                      <div className="item-col-actions">
                        <button className="item-delete-btn" onClick={() => handleDelete(item.cartId)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}

            {/* Sticky Footer */}
            <div className="cart-footer">
              <div className="footer-left">
                <label className="footer-select-all">
                  <input 
                    type="checkbox" 
                    className="shopee-checkbox" 
                    checked={selectedIds.size === items.length && items.length > 0} 
                    onChange={(e) => handleSelectAll(e.target.checked)} 
                  />
                  Select All
                </label>
                <button className="footer-delete-btn" onClick={handleDeleteSelected}>Delete</button>
              </div>
              <div className="footer-right">
                <div className="footer-total-text">
                  Total ({selectedItems.length} item{selectedItems.length !== 1 && 's'}): 
                  <span className="footer-total-price">{formatPeso(totalPrice)}</span>
                </div>
                <button className="footer-checkout-btn" onClick={checkout}>Check Out</button>
              </div>
            </div>
          </>
        )}
      </div>
      {alertDialog}
      {confirmDialog}
    </div>
  )
}

function TopBar({ profile }: { profile: ViewerProfile | null }) {
  return (
    <div className="cart-topbar">
      <div className="cart-topbar-inner">
        <div className="cart-topbar-left">
          <Link to="/seller">Seller Centre</Link>
        </div>
        <div className="cart-topbar-right">
          <Link to="/user/notifications">Notifications</Link>
          <Link to="/user/help">Help Centre</Link>
          <span className="cart-divider">|</span>
          <div className="cart-user-menu">
            <div className="cart-user-menu-trigger">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Avatar" className="cart-user-avatar" />
              ) : (
                <div className="cart-user-avatar-placeholder">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
                </div>
              )}
              <span className="cart-user-name">{profile?.fullName || 'User'}</span>
              <svg className="cart-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div className="cart-user-dropdown">
              <Link to="/user/profile">My Account</Link>
              <Link to="/user/purchase">Purchases</Link>
              <Link to="/auth/switch-account" className="cart-dropdown-switch">Switch Account</Link>
              <Link to="/auth/logout">Log out</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="cart-header">
      <div className="cart-header-inner">
        <BrandLogo to="/" />
        <div className="cart-header-divider" />
        <h1>Shopping Cart</h1>
      </div>
    </header>
  )
}
