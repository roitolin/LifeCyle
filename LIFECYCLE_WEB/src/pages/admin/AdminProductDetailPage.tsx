import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import './AdminProductDetailPage.css'

type ProductImage = {
  id: string
  imageUrl: string | null
  displayOrder: number
}

type ProductVariation = {
  id: string
  name: string
  imageUrl: string | null
}

type ProductFeedback = {
  id: string
  displayName?: string | null
  userEmail?: string | null
  feedback: string
  ratingSnapshot?: number | null
  createdAt?: string | null
}

type ProductDetail = {
  id: string
  shopId: string
  shopName: string
  shopStatus: string
  shopImageUrl: string | null
  shopAddress: string
  shopPhoneNumber: string
  generalLocation: string
  ownerName: string
  ownerEmail: string
  name: string
  description: string
  price: number
  stock: number
  imageUrl: string | null
  active: boolean
  hasVariations: boolean
  createdAt: string | null
  updatedAt: string | null
  images: ProductImage[]
  variations: ProductVariation[]
  ratingCount: number
  averageRating: number
  feedbackCount: number
  feedbacks: ProductFeedback[]
}

function formatPeso(value: number | string | null | undefined) {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '-'
  return `PHP ${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function getProductState(product: ProductDetail) {
  if (!product.active) return { label: 'Hidden', tone: 'paused' }
  if (product.stock <= 0) return { label: 'Sold out', tone: 'soldout' }
  return { label: 'Available', tone: 'live' }
}

function mapProduct(row: any, ratings: { rating: number }[], feedbacks: any[], feedbackCount: number): ProductDetail {
  const images = ((row.funeral_product_images ?? []) as any[])
    .map((image) => ({
      id: String(image.id),
      imageUrl: image.imageUrl ?? null,
      displayOrder: Number(image.displayOrder) || 0,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder)
  const variations = ((row.funeral_product_variations ?? []) as any[]).map((variation) => ({
    id: String(variation.id),
    name: String(variation.name || 'Standard'),
    imageUrl: variation.imageUrl ?? null,
  }))
  const ratingTotal = ratings.reduce((sum, item) => sum + (Number(item.rating) || 0), 0)
  const shop = row.funeral_shops ?? {}
  const owner = shop.users ?? {}

  return {
    id: String(row.id),
    shopId: String(row.shopId || shop.id || ''),
    shopName: String(shop.shopName || 'Unnamed Shop'),
    shopStatus: String(shop.status || 'unknown'),
    shopImageUrl: shop.shopImageUrl ?? null,
    shopAddress: String(shop.shopAddress || ''),
    shopPhoneNumber: String(shop.shopPhoneNumber || ''),
    generalLocation: String(shop.generalLocation || ''),
    ownerName: String(owner.fullName || '-'),
    ownerEmail: String(owner.email || '-'),
    name: String(row.name || 'Untitled Product'),
    description: String(row.description || ''),
    price: Number(row.price) || 0,
    stock: Number(row.stock) || 0,
    imageUrl: row.imageUrl ?? images.find((image) => image.imageUrl)?.imageUrl ?? variations.find((variation) => variation.imageUrl)?.imageUrl ?? null,
    active: Boolean(row.active),
    hasVariations: Boolean(row.hasVariations) || variations.length > 0,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    images,
    variations,
    ratingCount: ratings.length,
    averageRating: ratings.length ? ratingTotal / ratings.length : 0,
    feedbackCount,
    feedbacks: feedbacks.map((feedback) => ({
      id: String(feedback.id),
      displayName: feedback.displayName ?? null,
      userEmail: feedback.userEmail ?? null,
      feedback: String(feedback.feedback || ''),
      ratingSnapshot: feedback.ratingSnapshot ?? null,
      createdAt: feedback.createdAt ?? null,
    })),
  }
}

function AdminProductDetailPage() {
  const { productId = '' } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [galleryIndex, setGalleryIndex] = useState(0)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!productId) {
        setError('No product was selected.')
        setProduct(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')
      setProduct(null)
      setGalleryIndex(0)
      try {
        const [productRes, ratingRes, feedbackRes, feedbackCountRes] = await Promise.all([
          supabase
            .from('funeral_products')
            .select(`
              id, name, description, price, stock, "imageUrl", active, "hasVariations", "shopId", "createdAt", "updatedAt",
              funeral_product_images ( id, "imageUrl", "displayOrder" ),
              funeral_product_variations ( id, name, "imageUrl" ),
              funeral_shops!inner (
                id, "shopName", "shopImageUrl", "shopAddress", "shopPhoneNumber", "generalLocation", status,
                users!funeral_shops_id_fkey ( email, "fullName" )
              )
            `)
            .eq('id', productId)
            .maybeSingle(),
          supabase.from('funeral_product_ratings').select('rating').eq('productId', productId),
          supabase
            .from('funeral_product_feedback')
            .select('id, "displayName", "userEmail", feedback, "ratingSnapshot", "createdAt"')
            .eq('productId', productId)
            .order('createdAt', { ascending: false })
            .limit(20),
          supabase.from('funeral_product_feedback').select('id', { count: 'exact', head: true }).eq('productId', productId),
        ])

        if (productRes.error) throw productRes.error
        if (ratingRes.error) throw ratingRes.error
        if (feedbackRes.error) throw feedbackRes.error
        if (feedbackCountRes.error) throw feedbackCountRes.error
        if (!productRes.data) {
          if (active) setError('Product not found.')
          return
        }

        if (active) {
          setProduct(mapProduct(
            productRes.data,
            (ratingRes.data || []) as { rating: number }[],
            feedbackRes.data || [],
            feedbackCountRes.count ?? (feedbackRes.data || []).length,
          ))
        }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : 'Unable to load this product right now.'
        if (active) setError(message)
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [productId])

  const gallery = useMemo(() => {
    if (!product) return []
    return Array.from(new Set([
      product.imageUrl,
      ...product.images.map((image) => image.imageUrl),
      ...product.variations.map((variation) => variation.imageUrl),
    ].filter((url): url is string => Boolean(url))))
  }, [product])

  if (loading) {
    return <section className="admin-product-state"><p className="panel-sub">Loading product details...</p></section>
  }

  if (error || !product) {
    return (
      <section className="admin-product-state">
        <h2>Product unavailable</h2>
        <p className="panel-sub">{error || 'This product could not be found.'}</p>
        <button type="button" className="ghost-btn" onClick={() => navigate('/admin/funeral-items')}>Back to Products</button>
      </section>
    )
  }

  const state = getProductState(product)
  const mainImage = gallery[galleryIndex] || product.imageUrl || ''

  return (
    <section className="admin-product-detail-page">
      <div className="admin-product-topbar">
        <button type="button" className="ghost-btn" onClick={() => navigate('/admin/funeral-items')}>Back to Products</button>
        <div>
          <Link to={`/admin/funeral-shops/${product.shopId}`} className="ghost-btn btn-link">Open Shop</Link>
          {product.active ? <Link to={`/funeral/product/${product.id}`} className="ghost-btn btn-link">Public View</Link> : null}
        </div>
      </div>

      <header className="admin-product-hero">
        <div className="admin-product-hero-image">
          {mainImage ? <img src={mainImage} alt={product.name} /> : <span>LC</span>}
        </div>
        <div className="admin-product-hero-copy">
          <h2>{product.name}</h2>
          <p>{product.description || 'No description provided for this product.'}</p>
          <div className="admin-product-hero-meta">
            <strong>{formatPeso(product.price)}</strong>
            <span className={`admin-product-state-pill is-${state.tone}`}>{state.label}</span>
          </div>
        </div>
      </header>

      <div className="admin-product-metrics" aria-label="Product summary">
        <div><span>Stock</span><strong>{product.stock}</strong></div>
        <div><span>Variations</span><strong>{product.variations.length}</strong></div>
        <div><span>Rating</span><strong>{product.ratingCount ? product.averageRating.toFixed(1) : '-'}</strong></div>
        <div><span>Feedback</span><strong>{product.feedbackCount}</strong></div>
      </div>

      <div className="admin-product-layout">
        <main className="admin-product-main">
          <section className="admin-product-section">
            <div className="admin-product-section-head">
              <h3>Gallery</h3>
              <p>{gallery.length || 0} uploaded image{gallery.length === 1 ? '' : 's'}</p>
            </div>
            {gallery.length > 0 ? (
              <div className="admin-product-gallery-strip">
                {gallery.map((url, index) => (
                  <button
                    type="button"
                    key={url}
                    className={index === galleryIndex ? 'is-selected' : ''}
                    onClick={() => setGalleryIndex(index)}
                    aria-label={`View product image ${index + 1}`}
                  >
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
            ) : <p className="admin-product-muted">No product images uploaded.</p>}
          </section>

          <section className="admin-product-section">
            <div className="admin-product-section-head">
              <h3>Variations</h3>
              <p>{product.hasVariations ? 'Configured product options' : 'No options configured'}</p>
            </div>
            {product.variations.length > 0 ? (
              <div className="admin-product-variation-list">
                {product.variations.map((variation) => (
                  <article key={variation.id}>
                    {variation.imageUrl ? <img src={variation.imageUrl} alt={variation.name} /> : <span>LC</span>}
                    <strong>{variation.name}</strong>
                  </article>
                ))}
              </div>
            ) : <p className="admin-product-muted">This product has no variations.</p>}
          </section>

          <section className="admin-product-section">
            <div className="admin-product-section-head">
              <h3>Recent feedback</h3>
              <p>Latest customer comments connected to this product.</p>
            </div>
            {product.feedbacks.length > 0 ? (
              <div className="admin-product-feedback-list">
                {product.feedbacks.map((feedback) => (
                  <article key={feedback.id}>
                    <div>
                      <strong>{feedback.displayName || feedback.userEmail || 'Anonymous customer'}</strong>
                      <span>{formatDate(feedback.createdAt)}</span>
                    </div>
                    {feedback.ratingSnapshot ? <small>{Number(feedback.ratingSnapshot).toFixed(1)} / 5 rating</small> : null}
                    <p>{feedback.feedback}</p>
                  </article>
                ))}
              </div>
            ) : <p className="admin-product-muted">No customer feedback yet.</p>}
          </section>
        </main>

        <aside className="admin-product-side">
          <section className="admin-product-section">
            <div className="admin-product-section-head">
              <h3>Shop</h3>
              <p>Seller attached to this product.</p>
            </div>
            <div className="admin-product-shop-card">
              {product.shopImageUrl ? <img src={product.shopImageUrl} alt={product.shopName} /> : <span>LC</span>}
              <div>
                <strong>{product.shopName}</strong>
                <small>{product.shopStatus}</small>
              </div>
            </div>
            <dl className="admin-product-facts">
              <div><dt>Owner</dt><dd>{product.ownerName}</dd></div>
              <div><dt>Email</dt><dd>{product.ownerEmail}</dd></div>
              <div><dt>Phone</dt><dd>{product.shopPhoneNumber || '-'}</dd></div>
              <div><dt>Location</dt><dd>{product.generalLocation || product.shopAddress || '-'}</dd></div>
            </dl>
          </section>

          <section className="admin-product-section">
            <div className="admin-product-section-head">
              <h3>Record dates</h3>
              <p>System timestamps for this listing.</p>
            </div>
            <dl className="admin-product-facts">
              <div><dt>Created</dt><dd>{formatDate(product.createdAt)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDate(product.updatedAt)}</dd></div>
              <div><dt>Product ID</dt><dd>{product.id}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  )
}

export default AdminProductDetailPage
