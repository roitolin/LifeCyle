import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { loadFuneralCart, saveFuneralCart, type WebFuneralCartItem } from '@/utils/funeralCart'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import AccountTaskHeader, { type AccountHeaderProfile } from '@/components/AccountTaskHeader'
import ImageWithSkeleton from '@/components/ImageWithSkeleton'
import PageBackButton from '@/components/PageBackButton'
import './CartPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function SelectionCheckbox({ checked, partial, label, onChange }: {
  checked: boolean
  partial?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      className="cart-checkbox"
      type="checkbox"
      checked={checked}
      aria-label={label}
      ref={input => { if (input) input.indeterminate = Boolean(partial) }}
      onChange={event => onChange(event.target.checked)}
    />
  )
}

export default function CartPage() {
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [items, setItems] = useState<WebFuneralCartItem[]>(loadFuneralCart)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [account, setAccount] = useState<{ id: string; profile: AccountHeaderProfile } | null>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_, session) => setViewerId(session?.user.id ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!viewerId) return
    let active = true
    void supabase.from('users').select('fullName, photoURL, gender').eq('id', viewerId).maybeSingle()
      .then(({ data }) => { if (active && data) setAccount({ id: viewerId, profile: data }) })
    return () => { active = false }
  }, [viewerId])

  useEffect(() => {
    const refreshCart = () => {
      const next = loadFuneralCart()
      const available = new Set(next.map(item => item.cartId))
      setItems(next)
      setSelectedIds(previous => new Set([...previous].filter(id => available.has(id))))
    }
    window.addEventListener('storage', refreshCart)
    window.addEventListener('funeral-cart-updated', refreshCart)
    return () => {
      window.removeEventListener('storage', refreshCart)
      window.removeEventListener('funeral-cart-updated', refreshCart)
    }
  }, [])

  const shops = new Map<string, WebFuneralCartItem[]>()
  for (const item of [...items].reverse()) {
    const shopItems = shops.get(item.shopId) ?? []
    shopItems.push(item)
    shops.set(item.shopId, shopItems)
  }

  const selectedItems = items.filter(item => selectedIds.has(item.cartId))
  const selectedCount = selectedItems.length
  const total = selectedItems.reduce((sum, item) => sum + item.price, 0)

  const selectItems = (rows: WebFuneralCartItem[], checked: boolean) => {
    setSelectedIds(previous => {
      const next = new Set(previous)
      for (const item of rows) {
        if (checked) next.add(item.cartId)
        else next.delete(item.cartId)
      }
      return next
    })
  }

  const confirmRemoval = (rows: WebFuneralCartItem[]) => {
    const ids = new Set(rows.map(item => item.cartId))
    if (!ids.size) return
    openConfirm({
      title: ids.size === 1 ? 'Remove item?' : 'Remove selected items?',
      message: ids.size === 1 ? 'Remove this item from your cart?' : `Remove ${ids.size} items from your cart?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        try {
          saveFuneralCart(loadFuneralCart().filter(item => !ids.has(item.cartId)))
        } catch {
          openAlert({
            title: 'Cart could not be updated',
            message: 'Please try removing the items again.',
            tone: 'danger',
          })
        }
      },
    })
  }

  const checkout = () => {
    if (selectedItems.length !== 1) return
    if (!viewerId) {
      navigate('/login?next=/user/cart')
      return
    }
    navigate('/user/checkout', { state: { cartItem: selectedItems[0] } })
  }

  return (
    <div className="web-cart">
      <AccountTaskHeader title="Shopping Cart" profile={account?.id === viewerId ? account.profile : null} showShopCenter />
      <main className="web-cart-main">
        <PageBackButton />

        {items.length === 0 ? (
          <section className="web-cart-empty">
            <h2>Your cart is empty</h2>
            <Link to="/funeral" className="web-cart-primary">Browse services</Link>
          </section>
        ) : (
          <div className="web-cart-layout">
            <section className="web-cart-items" aria-labelledby="cart-items-title">
              <div className="web-cart-items-heading">
                <h2 id="cart-items-title">Cart items</h2>
                <span>{items.length} {items.length === 1 ? 'item' : 'items'}</span>
              </div>
              <div className="web-cart-selection">
                <label>
                  <SelectionCheckbox checked={selectedCount === items.length} partial={selectedCount > 0 && selectedCount < items.length} label="Select all cart items" onChange={checked => selectItems(items, checked)} />
                  Select all
                </label>
                <button type="button" className="web-cart-remove" disabled={selectedCount === 0} onClick={() => confirmRemoval(selectedItems)}>
                  Remove selected
                </button>
              </div>
              {[...shops].map(([shopId, shopItems]) => {
                const shopName = shopItems[0].shopName
                const shopSelected = shopItems.reduce((count, item) => count + Number(selectedIds.has(item.cartId)), 0)
                return (
                  <section key={shopId} aria-label={shopName} className="web-cart-shop">
                    <div className="web-cart-shop-heading">
                      <label className="web-cart-pick" title={`Select all items from ${shopName}`}>
                        <SelectionCheckbox checked={shopSelected === shopItems.length} partial={shopSelected > 0 && shopSelected < shopItems.length} label={`Select all items from ${shopName}`} onChange={checked => selectItems(shopItems, checked)} />
                      </label>
                      <h3><Link to={`/shop/${encodeURIComponent(shopId)}`}>{shopName}</Link></h3>
                    </div>
                    <ul>
                      {shopItems.map(item => (
                        <li className="web-cart-item" key={item.cartId} data-selected={selectedIds.has(item.cartId)}>
                          <label className="web-cart-pick">
                            <SelectionCheckbox checked={selectedIds.has(item.cartId)} label={`Select ${item.name}${item.variationName ? ' · ' + item.variationName : ''}`} onChange={checked => selectItems([item], checked)} />
                          </label>
                          {item.imageUrl ? (
                            <ImageWithSkeleton
                              src={item.imageUrl}
                              className="web-cart-image"
                              alt=""
                              loading="lazy"
                              deliveryWidth={220}
                              deliveryHeight={220}
                              sizes="110px"
                            />
                          ) : <span className="web-cart-image web-cart-image-empty" aria-hidden="true">No image</span>}
                          <div className="web-cart-item-details">
                            <Link className="web-cart-item-name" to={`/funeral/product/${encodeURIComponent(item.productId)}`}>{item.name}</Link>
                            {item.variationName && <p>Variation: {item.variationName}</p>}
                            {Boolean(item.packageItems?.length) && <p>Packages: {item.packageItems?.join(', ')}</p>}
                            {Boolean(item.downpaymentAmount && item.downpaymentPercentage) && <p>Down payment available after shop approval</p>}
                          </div>
                          <div className="web-cart-item-actions">
                            <strong>{peso.format(item.price)}</strong>
                            <button type="button" className="web-cart-remove" onClick={() => confirmRemoval([item])} aria-label={`Remove ${item.name}${item.variationName ? ' · ' + item.variationName : ''} from cart`}>Remove</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </section>

            <aside className="web-cart-summary" aria-labelledby="cart-summary-title">
              <h2 id="cart-summary-title">Order summary</h2>
              <dl className="web-cart-total" aria-live="polite">
                <div><dt>Selected items</dt><dd>{selectedCount}</dd></div>
                <div><dt>Total</dt><dd>{peso.format(total)}</dd></div>
              </dl>
              {selectedCount !== 1 && (
                <p id="cart-checkout-hint">
                  {selectedCount === 0 ? 'Select an item to continue.' : 'Select one item per service request.'}
                </p>
              )}
              <button
                className="web-cart-primary"
                type="button"
                disabled={selectedCount !== 1}
                aria-describedby={selectedCount === 1 ? undefined : 'cart-checkout-hint'}
                onClick={checkout}
              >Check out</button>
            </aside>
          </div>
        )}
      </main>
      {alertDialog}
      {confirmDialog}
    </div>
  )
}
