import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import ProfileLayout from './ProfileLayout'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'

type FavProduct = {
  id: string
  name: string
  price: number
  stock: number
  imageUrl: string | null
}

const FAVORITES_KEY = 'lifecycle_favorites'

function loadFavIds(): string[] {
  try {
    const favs = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '{}')
    return Object.keys(favs).filter(id => favs[id] === true)
  } catch {
    return []
  }
}

function saveFavIds(ids: string[]) {
  const favs: Record<string, boolean> = {}
  ids.forEach(id => { favs[id] = true })
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs))
  window.dispatchEvent(new Event('lifecycle-favorites-updated'))
}

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function FavoritesPage() {
  const [favIds, setFavIds] = useState<string[]>(() => loadFavIds())
  const [products, setProducts] = useState<FavProduct[]>([])
  const [loading, setLoading] = useState(true)
  const { openConfirm, confirmDialog } = useConfirmDialog()

  useEffect(() => {
    const refresh = () => setFavIds(loadFavIds())
    window.addEventListener('lifecycle-favorites-updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('lifecycle-favorites-updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (favIds.length === 0) {
        if (!cancelled) { setProducts([]); setLoading(false) }
        return
      }
      setLoading(true)
      try {
        const { data } = await supabase
          .from('funeral_products')
          .select(`id, name, price, stock, "imageUrl", active, funeral_shops!inner(status)`)
          .in('id', favIds)
          .eq('active', true)
          .eq('funeral_shops.status', 'live')
          .gt('funeral_shops.paidUntil', new Date().toISOString())
        if (!cancelled) {
          const rows = (data ?? []) as any[]
          const byId = new Map(rows.map(r => [String(r.id), r]))
          setProducts(favIds
            .map(id => byId.get(id))
            .filter((r): r is any => Boolean(r))
            .map(r => ({
              id: String(r.id),
              name: String(r.name ?? 'Untitled Product'),
              price: Number(r.price) || 0,
              stock: Number(r.stock) || 0,
              imageUrl: r.imageUrl ?? null,
            })))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [favIds])

  const removeFavorite = (id: string) => {
    const next = favIds.filter(fid => fid !== id)
    setFavIds(next)
    setProducts(prev => prev.filter(p => p.id !== id))
    saveFavIds(next)
  }

  const confirmRemoveFavorite = (id: string) => {
    const product = products.find(p => p.id === id)
    openConfirm({
      title: 'Remove Favorite',
      message: `Remove "${product?.name || 'this product'}" from your favorites?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => removeFavorite(id),
    })
  }

  return (
    <ProfileLayout title="My Favorites" subtitle="Funeral products and services you have saved for later.">
      <div className="w-full">
        {loading ? (
          <div className="px-5 py-[60px] text-center text-[var(--text-muted)] max-[480px]:px-4 max-[480px]:py-10">
            <div className="mx-auto size-8 animate-spin rounded-full border-[3px] border-[#d8e0dc] border-t-[var(--sp-accent)]" />
            <p className="mt-2">Loading your favorites...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="px-5 py-[60px] text-center text-[var(--text-muted)] max-[480px]:px-4 max-[480px]:py-10">
            <div className="mx-auto mb-4 flex size-[72px] items-center justify-center rounded-full bg-[var(--sp-bg)] text-[var(--sp-accent)]" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <h3 className="mb-1 text-base text-[var(--text-main)]">No favorites yet</h3>
            <p className="mt-2">Tap the bookmark icon on a product to save it here for quick access.</p>
            <Link to="/funeral" className="mt-5 inline-block rounded-sm bg-[var(--sp-accent)] px-6 py-2.5 text-sm text-white no-underline hover:bg-[var(--sp-accent-dark)]">Browse Products</Link>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5 max-[640px]:grid-cols-2 max-[640px]:gap-2.5">
            {products.map(product => (
              <div key={product.id} className="relative overflow-hidden rounded border border-[var(--border)] bg-[var(--white)] transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] max-[640px]:min-w-0">
                <Link to={`/funeral/product/${product.id}`} className="block min-w-0 text-inherit no-underline">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="flex aspect-square w-full items-center justify-center bg-[var(--sp-bg)] object-cover text-xs text-[#a0aec0]" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-[var(--sp-bg)] text-xs text-[#a0aec0]">No Image</div>
                  )}
                  <div className="min-w-0 p-2.5 max-[640px]:p-[9px]">
                    <div className="mb-1.5 line-clamp-2 h-9 overflow-hidden text-[13px] leading-[1.4] text-[var(--text-main)]">{product.name}</div>
                    <div className="text-base font-semibold text-[var(--sp-accent)] max-[640px]:text-[15px]">{formatPeso(product.price)}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="absolute right-2 top-2 inline-flex cursor-pointer items-center gap-1 rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.92)] px-2.5 py-1 text-xs font-semibold text-[var(--sp-accent)] transition-colors duration-150 hover:bg-[var(--sp-bg)] max-[420px]:size-[34px] max-[420px]:justify-center max-[420px]:p-0 max-[420px]:[&_span]:hidden"
                  onClick={() => confirmRemoveFavorite(product.id)}
                  aria-label={`Remove ${product.name} from favorites`}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
                  <span>Saved</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmDialog}
    </ProfileLayout>
  )
}
