import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import ProfileLayout from './ProfileLayout'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import './FavoritesPage.css'

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
      <div className="favorites-content">
        {loading ? (
          <div className="favorites-state">
            <div className="pd-spinner" />
            <p>Loading your favorites...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="favorites-state">
            <div className="favorites-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <h3>No favorites yet</h3>
            <p>Tap the bookmark icon on a product to save it here for quick access.</p>
            <Link to="/funeral" className="favorites-browse-btn">Browse Products</Link>
          </div>
        ) : (
          <div className="favorites-grid">
            {products.map(product => (
              <div key={product.id} className="favorites-card">
                <Link to={`/funeral/product/${product.id}`} className="favorites-card-link">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="favorites-card-img" />
                  ) : (
                    <div className="favorites-card-img favorites-card-img-fallback">No Image</div>
                  )}
                  <div className="favorites-card-info">
                    <div className="favorites-card-name">{product.name}</div>
                    <div className="favorites-card-price">{formatPeso(product.price)}</div>
                    <div className="favorites-card-stock">
                      {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="favorites-remove-btn"
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
