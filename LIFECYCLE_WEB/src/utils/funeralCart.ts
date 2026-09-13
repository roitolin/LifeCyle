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
  packageItems?: string[]
  quantity: number
}

function readCart(): WebFuneralCartItem[] {
  try {
    const raw = window.localStorage.getItem(FUNERAL_CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((item) => ({ ...item, quantity: 1 }))
      : []
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
    cartItem.variationName === item.variationName &&
    JSON.stringify(cartItem.packageItems || []) === JSON.stringify(item.packageItems || [])
  )
  const itemWithoutQty: Omit<WebFuneralCartItem, 'cartId' | 'quantity'> = {
    productId: item.productId,
    shopId: item.shopId,
    shopName: item.shopName,
    name: item.name,
    price: item.price,
    imageUrl: item.imageUrl,
    variationName: item.variationName,
    packageItems: item.packageItems,
  }
  
  const next = existing
    ? current.map(cartItem => cartItem.cartId === existing.cartId ? { ...cartItem, ...itemWithoutQty, quantity: 1 } : cartItem)
    : [
        ...current,
        {
          ...itemWithoutQty,
          cartId: `${item.shopId}_${item.productId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          quantity: 1,
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
