const FUNERAL_CART_KEY = 'funeral_cart_v1'

export type FuneralPaymentOption = 'full' | 'downpayment'

export type WebFuneralCartItem = {
  cartId: string
  productId: string
  shopId: string
  shopName: string
  name: string
  /** Full product price. Payment is selected after shop approval. */
  price: number
  fullPrice: number
  paymentOption: FuneralPaymentOption
  downpaymentAmount?: number | null
  downpaymentPercentage?: number | null
  remainingBalance?: number
  imageUrl?: string | null
  variationId?: string | null
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
      ? parsed.map((item) => {
          const price = Number(item.price) || 0
          const fullPrice = Number(item.fullPrice) || price
          return {
            ...item,
            price: fullPrice,
            fullPrice,
            paymentOption: 'full',
            remainingBalance: 0,
            quantity: 1,
          }
        })
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
    (cartItem.variationId || cartItem.variationName) === (item.variationId || item.variationName)
  )
  const itemWithoutQty: Omit<WebFuneralCartItem, 'cartId' | 'quantity'> = {
    productId: item.productId,
    shopId: item.shopId,
    shopName: item.shopName,
    name: item.name,
    price: item.price,
    fullPrice: item.fullPrice,
    paymentOption: item.paymentOption,
    downpaymentAmount: item.downpaymentAmount,
    downpaymentPercentage: item.downpaymentPercentage,
    remainingBalance: item.remainingBalance,
    imageUrl: item.imageUrl,
    variationId: item.variationId,
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
