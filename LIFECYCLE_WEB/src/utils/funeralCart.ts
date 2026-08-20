const FUNERAL_CART_KEY = 'funeral_cart_v1'

export type WebFuneralCartItem = {
  cartId: string
  productId: string
  shopId: string
  shopName: string
  name: string
  price: number
  imageUrl?: string | null
  variationName?: string | null
  quantity: number
}

function readCart(): WebFuneralCartItem[] {
  try {
    const raw = window.localStorage.getItem(FUNERAL_CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadFuneralCart(): WebFuneralCartItem[] {
  if (typeof window === 'undefined') return []
  return readCart()
}

export function saveFuneralCart(items: WebFuneralCartItem[]) {
  window.localStorage.setItem(FUNERAL_CART_KEY, JSON.stringify(items))
  window.dispatchEvent(new Event('funeral-cart-updated'))
}

export function addFuneralCartItem(item: Omit<WebFuneralCartItem, 'cartId' | 'quantity'> & { quantity?: number }) {
  const current = loadFuneralCart()
  const existing = current.find(cartItem => 
    cartItem.productId === item.productId && 
    cartItem.shopId === item.shopId && 
    cartItem.variationName === item.variationName
  )
  const qtyToAdd = item.quantity ?? 1
  const itemWithoutQty: Omit<WebFuneralCartItem, 'cartId' | 'quantity'> = {
    productId: item.productId,
    shopId: item.shopId,
    shopName: item.shopName,
    name: item.name,
    price: item.price,
    imageUrl: item.imageUrl,
    variationName: item.variationName,
  }
  
  const next = existing
    ? current.map(cartItem => cartItem.cartId === existing.cartId ? { ...cartItem, quantity: cartItem.quantity + qtyToAdd } : cartItem)
    : [
        ...current,
        {
          ...itemWithoutQty,
          cartId: `${item.shopId}_${item.productId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          quantity: qtyToAdd,
        },
      ]
  saveFuneralCart(next)
  return next
}

export function removeFuneralCartItem(cartId: string) {
  const next = loadFuneralCart().filter(item => item.cartId !== cartId)
  saveFuneralCart(next)
  return next
}

export function updateFuneralCartQuantity(cartId: string, quantity: number) {
  const next = quantity <= 0
    ? loadFuneralCart().filter(item => item.cartId !== cartId)
    : loadFuneralCart().map(item => item.cartId === cartId ? { ...item, quantity } : item)
  saveFuneralCart(next)
  return next
}
