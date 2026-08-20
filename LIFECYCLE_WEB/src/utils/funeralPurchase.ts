const FUNERAL_PURCHASE_KEY = 'funeral_purchase_v1'

export type WebFuneralPurchaseItem = {
  cartId: string
  productId: string
  shopId: string
  shopName: string
  name: string
  price: number
  imageUrl?: string | null
  quantity: number
  variationName?: string | null
}

export type WebFuneralPurchase = {
  orderId: string
  items: WebFuneralPurchaseItem[]
  total: number
  status: 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled'
  createdAt: string
}

function readPurchases(): WebFuneralPurchase[] {
  try {
    const raw = window.localStorage.getItem(FUNERAL_PURCHASE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadFuneralPurchases(): WebFuneralPurchase[] {
  if (typeof window === 'undefined') return []
  return readPurchases()
}

export function saveFuneralPurchases(purchases: WebFuneralPurchase[]) {
  window.localStorage.setItem(FUNERAL_PURCHASE_KEY, JSON.stringify(purchases))
  window.dispatchEvent(new Event('funeral-purchase-updated'))
}

export function addFuneralPurchase(order: WebFuneralPurchase) {
  const current = loadFuneralPurchases()
  const next = [order, ...current]
  saveFuneralPurchases(next)
  return next
}

export function updateFuneralPurchaseStatus(orderId: string, status: WebFuneralPurchase['status']) {
  const current = loadFuneralPurchases()
  const next = current.map(p => p.orderId === orderId ? { ...p, status } : p)
  saveFuneralPurchases(next)
  return next
}

export function removeFuneralPurchase(orderId: string) {
  const next = loadFuneralPurchases().filter(p => p.orderId !== orderId)
  saveFuneralPurchases(next)
  return next
}