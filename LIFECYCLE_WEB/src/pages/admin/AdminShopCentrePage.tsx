import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import '../SellerCentrePage.css'

type ShopInfo = {
  id: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  shopImageUrl: string | null
  coverImageUrl: string | null
  generalLocation: string
  individualRegisteredName: string
  businessName: string
  registeredAddress: string
  zipCode: string
  tin: string
  vatRegistrationStatus: boolean
  birCertificateUrl: string | null
  status: string
  rejectionReason: string | null
  ownerId: string
  ownerName: string
  ownerEmail: string
  createdAt: string
  updatedAt: string
}

type ShopProduct = {
  id: string
  name: string
  description: string
  price: number
  stock: number
  imageUrl: string | null
  active: boolean
  hasVariations: boolean
  variationCount: number
  createdAt: string
}

type ProductVariation = {
  id: string
  name: string
  imageUrl: string | null
}

type ProductImage = {
  id: string
  imageUrl: string | null
  displayOrder: number
}

type ProductDetail = {
  variations: ProductVariation[]
  images: ProductImage[]
  ratingCount: number
  averageRating: number
  feedbackCount: number
  feedbacks: ProductFeedbackItem[]
}

type ProductFeedbackItem = {
  id: string
  displayName?: string | null
  userEmail?: string | null
  feedback: string
  ratingSnapshot?: number | null
  createdAt?: string | null
}

type ServiceRequest = {
  id: string
  requesterId: string
  productId: string
  productName: string
  productPrice?: string | null
  productImageUrl?: string | null
  variationName?: string | null
  requestType?: string
  contactNumber?: string
  deceasedFullName?: string
  deceasedDateOfPassing?: string
  status: string
  createdAt?: string
}

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(num)}`
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === 'live') return <span className="sc-badge sc-badge-live">Live</span>
  if (s === 'verified') return <span className="sc-badge sc-badge-verified">Verified</span>
  if (s === 'offline') return <span className="sc-badge sc-badge-offline">Offline</span>
  if (s === 'pending') return <span className="sc-badge sc-badge-pending">Pending</span>
  if (s === 'rejected') return <span className="sc-badge sc-badge-rejected">Rejected</span>
  return <span className="sc-badge">{status}</span>
}

function requestStatusClass(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'pending_shop_acceptance') return 'sc-status-pending'
  if (s === 'accepted_by_shop' || s === 'awaiting_payment' || s === 'payment_submitted' || s === 'payment_verified') return 'sc-status-confirmed'
  if (s === 'awaiting_customer_confirmation') return 'sc-status-awaiting_customer_confirmation'
  if (s === 'completed') return 'sc-status-completed'
  if (s === 'declined_by_shop') return 'sc-status-soldout'
  return 'sc-status-pending'
}

function requestStatusLabel(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'pending_shop_acceptance') return 'Waiting'
  if (s === 'accepted_by_shop') return 'Accepted'
  if (s === 'awaiting_payment') return 'Awaiting Payment'
  if (s === 'payment_submitted') return 'Payment Submitted'
  if (s === 'payment_verified') return 'Payment Confirmed'
  if (s === 'awaiting_customer_confirmation') return 'Awaiting Customer Confirmation'
  if (s === 'completed') return 'Completed'
  if (s === 'declined_by_shop') return 'Declined'
  if (s === 'cancelled_by_requester') return 'Cancelled'
  return s.replace(/_/g, ' ')
}

function getProductState(item: ShopProduct) {
  if (!item.active || item.stock <= 0) return 'soldout'
  return 'live'
}

function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value || 0)))
  return (
    <span className="sc-stars" aria-label={`${value} out of 5 stars`}>
      {'★'.repeat(filled)}
      {'☆'.repeat(5 - filled)}
    </span>
  )
}

function AdminShopCentrePage() {
  const { id = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shop, setShop] = useState<ShopInfo | null>(null)
  const [products, setProducts] = useState<ShopProduct[]>([])
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [activeTab, setActiveTab] = useState<'dashboard' | 'orders' | 'products' | 'shop'>('dashboard')
  const [productTab, setProductTab] = useState<'all' | 'live' | 'soldout'>('all')
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailData, setDetailData] = useState<ProductDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const openProductDetail = useCallback(async (product: ShopProduct) => {
    setSelectedProduct(product)
    setDetailData(null)
    setDetailError(null)
    setDetailLoading(true)
    setGalleryIndex(0)
    try {
      const [variationsRes, imagesRes, ratingsRes, feedbackRes, feedbackCountRes] = await Promise.all([
        supabase
          .from('funeral_product_variations')
          .select('id, name, "imageUrl"')
          .eq('productId', product.id)
          .order('name'),
        supabase
          .from('funeral_product_images')
          .select('id, "imageUrl", "displayOrder"')
          .eq('productId', product.id)
          .order('displayOrder'),
        supabase
          .from('funeral_product_ratings')
          .select('rating')
          .eq('productId', product.id),
        supabase
          .from('funeral_product_feedback')
          .select('id, "displayName", "userEmail", feedback, "ratingSnapshot", "createdAt"')
          .eq('productId', product.id)
          .order('createdAt', { ascending: false })
          .limit(20),
        supabase
          .from('funeral_product_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('productId', product.id),
      ])
      if (variationsRes.error) throw variationsRes.error
      if (imagesRes.error) throw imagesRes.error
      if (ratingsRes.error) throw ratingsRes.error
      if (feedbackRes.error) throw feedbackRes.error
      if (feedbackCountRes.error) throw feedbackCountRes.error

      const ratingRows = (ratingsRes.data || []) as { rating: number }[]
      const totalRating = ratingRows.reduce((sum, row) => sum + (Number(row.rating) || 0), 0)
      const averageRating = ratingRows.length ? totalRating / ratingRows.length : 0

      setDetailData({
        variations: (variationsRes.data || []).map((v: any) => ({
          id: String(v.id),
          name: String(v.name),
          imageUrl: v.imageUrl ?? null,
        })),
        images: (imagesRes.data || []).map((img: any) => ({
          id: String(img.id),
          imageUrl: img.imageUrl ?? null,
          displayOrder: Number(img.displayOrder) || 0,
        })),
        ratingCount: ratingRows.length,
        averageRating,
        feedbackCount: feedbackCountRes.count ?? (feedbackRes.data || []).length,
        feedbacks: (feedbackRes.data || []).map((fb: any) => ({
          id: String(fb.id),
          displayName: fb.displayName ?? null,
          userEmail: fb.userEmail ?? null,
          feedback: String(fb.feedback ?? ''),
          ratingSnapshot: fb.ratingSnapshot ?? null,
          createdAt: fb.createdAt ?? null,
        })),
      })
    } catch (e: any) {
      setDetailError(e?.message ?? 'Unable to load product details.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!id) {
      setError('No shop selected.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const [shopRes, productsRes, requestsRes] = await Promise.all([
        supabase
          .from('funeral_shops')
          .select(`
            *,
            users!funeral_shops_id_fkey ( email, "fullName" )
          `)
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('funeral_products')
          .select(`
            id, name, description, price, stock, "imageUrl", active, "hasVariations", "createdAt",
            funeral_product_variations ( id )
          `)
          .eq('shopId', id)
          .order('createdAt', { ascending: false }),
        supabase
          .from('funeral_service_requests')
          .select('*')
          .eq('shopId', id)
          .order('createdAt', { ascending: false })
          .limit(100),
      ])

      if (shopRes.error) throw shopRes.error
      if (productsRes.error) throw productsRes.error
      if (requestsRes.error) throw requestsRes.error

      if (!shopRes.data) {
        setError('Funeral shop not found.')
        setLoading(false)
        return
      }

      const row: any = shopRes.data
      setShop({
        id: row.id,
        shopName: row.shopName || '',
        shopAddress: row.shopAddress || '',
        shopPhoneNumber: row.shopPhoneNumber || '',
        shopImageUrl: row.shopImageUrl || null,
        coverImageUrl: row.coverImageUrl || null,
        generalLocation: row.generalLocation || '',
        individualRegisteredName: row.individualRegisteredName || '',
        businessName: row.businessName || '',
        registeredAddress: row.registeredAddress || '',
        zipCode: row.zipCode || '',
        tin: row.tin || '',
        vatRegistrationStatus: Boolean(row.vatRegistrationStatus),
        birCertificateUrl: row.birCertificateUrl || null,
        status: row.status || 'pending',
        rejectionReason: row.rejectionReason || null,
        ownerId: row.id,
        ownerName: row.users?.fullName || '',
        ownerEmail: row.users?.email || '',
        createdAt: row.createdAt || '',
        updatedAt: row.updatedAt || '',
      })

      setProducts(
        (productsRes.data || []).map((p: any) => ({
          id: String(p.id),
          name: String(p.name ?? 'Untitled'),
          description: String(p.description ?? ''),
          price: Number(p.price) || 0,
          stock: Number(p.stock) || 0,
          imageUrl: p.imageUrl ?? null,
          active: Boolean(p.active),
          hasVariations: Boolean(p.hasVariations),
          variationCount: (p.funeral_product_variations ?? []).length,
          createdAt: p.createdAt ?? '',
        })),
      )

      setRequests((requestsRes.data || []) as ServiceRequest[])
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load shop centre data.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const stats = useMemo(
    () => ({
      totalProducts: products.length,
      liveProducts: products.filter((p) => p.active && p.stock > 0).length,
      soldOutProducts: products.filter((p) => !p.active || p.stock <= 0).length,
      totalOrders: requests.length,
      pendingOrders: requests.filter((r) => r.status === 'pending_shop_acceptance').length,
      confirmedOrders: requests.filter((r) =>
        r.status === 'accepted_by_shop' || r.status === 'awaiting_payment' || r.status === 'payment_submitted' || r.status === 'payment_verified'
      ).length,
      completedOrders: requests.filter((r) => r.status === 'completed').length,
      awaitingPayment: requests.filter((r) =>
        r.status === 'accepted_by_shop' || r.status === 'awaiting_payment'
      ).length,
      paymentReview: requests.filter((r) => r.status === 'payment_submitted').length,
      inService: requests.filter((r) =>
        r.status === 'payment_verified' || r.status === 'awaiting_customer_confirmation'
      ).length,
    }),
    [products, requests],
  )

  const filtered = useMemo(() => {
    if (productTab === 'all') return products
    if (productTab === 'live') return products.filter((p) => p.active && p.stock > 0)
    return products.filter((p) => !p.active || p.stock <= 0)
  }, [products, productTab])

  const galleryImages = useMemo(() => {
    if (!selectedProduct) return []
    const imgs = [
      selectedProduct.imageUrl ?? '',
      ...(detailData?.images ?? []).map((img) => img.imageUrl ?? ''),
    ]
    return imgs.filter((url) => url)
  }, [selectedProduct, detailData])

  const mainImage = galleryImages[galleryIndex] || selectedProduct?.imageUrl || ''

  return (
    <section className="panel sc-page admin-shop-workspace">
      <header className="admin-shop-workspace-head">
        <Link to="/admin/funeral-shops" className="ghost-btn btn-link">
          Back to funeral shops
        </Link>
        <div className="admin-shop-identity">
          {shop?.shopImageUrl ? (
            <img src={shop.shopImageUrl} alt="" />
          ) : (
            <span aria-hidden="true">LC</span>
          )}
          <div>
            <strong>{shop?.shopName || 'Shop'}</strong>
            <small>{shop ? statusBadge(shop.status) : 'Loading'}</small>
          </div>
        </div>
      </header>

      <nav className="admin-shop-tabs" aria-label="Shop workspace sections">
        <button type="button" className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
          Overview
        </button>
        <button type="button" className={activeTab === 'orders' ? 'active' : ''} onClick={() => setActiveTab('orders')}>
          Service requests <span>{stats.totalOrders}</span>
        </button>
        <button type="button" className={activeTab === 'products' ? 'active' : ''} onClick={() => setActiveTab('products')}>
          Products <span>{stats.totalProducts}</span>
        </button>
        <button type="button" className={activeTab === 'shop' ? 'active' : ''} onClick={() => setActiveTab('shop')}>
          Shop profile
        </button>
      </nav>

      <main className="admin-shop-content">
          {loading && (
            <div className="sc-state">
              <div className="sc-spinner" />
              <p>Loading shop centre…</p>
            </div>
          )}

          {error && (
            <div className="sc-state sc-state-error">
              <p>{error}</p>
              <button className="sc-primary-btn" onClick={() => void loadData()}>Retry</button>
            </div>
          )}

          {!loading && !error && shop && (
            <div className="sc-content-grid">
              {activeTab === 'dashboard' && (
                <div className="admin-shop-overview">
                  <div className="admin-shop-overview-main">
                    <section className="admin-shop-section">
                      <div className="admin-shop-section-head">
                        <h3>Needs attention</h3>
                        <p>Current requests and inventory issues.</p>
                      </div>
                      <div className="admin-shop-work-list">
                        <button type="button" onClick={() => setActiveTab('orders')}>
                          <span>New requests</span><strong>{stats.pendingOrders}</strong>
                        </button>
                        <button type="button" onClick={() => setActiveTab('orders')}>
                          <span>Awaiting family payment</span><strong>{stats.awaitingPayment}</strong>
                        </button>
                        <button type="button" onClick={() => setActiveTab('orders')}>
                          <span>Payments to review</span><strong>{stats.paymentReview}</strong>
                        </button>
                        <button type="button" onClick={() => setActiveTab('orders')}>
                          <span>Services in progress</span><strong>{stats.inService}</strong>
                        </button>
                        <button type="button" onClick={() => { setActiveTab('products'); setProductTab('soldout') }}>
                          <span>Unavailable products</span><strong>{stats.soldOutProducts}</strong>
                        </button>
                      </div>
                    </section>

                    <section className="admin-shop-section">
                      <div className="admin-shop-section-head">
                        <h3>Activity summary</h3>
                      </div>
                      <dl className="admin-shop-summary">
                        <div><dt>Products</dt><dd>{stats.totalProducts}</dd><small>{stats.liveProducts} live</small></div>
                        <div><dt>Service requests</dt><dd>{stats.totalOrders}</dd><small>{stats.pendingOrders} new</small></div>
                        <div><dt>Accepted</dt><dd>{stats.confirmedOrders}</dd><small>Active requests</small></div>
                        <div><dt>Completed</dt><dd>{stats.completedOrders}</dd><small>Finished requests</small></div>
                      </dl>
                    </section>
                  </div>

                  <aside className="admin-shop-section admin-shop-details">
                    <div className="admin-shop-section-head">
                      <h3>Shop details</h3>
                    </div>
                    <dl>
                      <div><dt>Owner</dt><dd>{shop.ownerName || 'Not provided'}</dd></div>
                      <div><dt>Email</dt><dd>{shop.ownerEmail || 'Not provided'}</dd></div>
                      <div><dt>Status</dt><dd>{statusBadge(shop.status)}</dd></div>
                      <div><dt>Location</dt><dd>{shop.generalLocation || 'Not provided'}</dd></div>
                      <div><dt>Phone</dt><dd>{shop.shopPhoneNumber || 'Not provided'}</dd></div>
                      <div><dt>Joined</dt><dd>{shop.createdAt ? new Date(shop.createdAt).toLocaleDateString() : 'Not provided'}</dd></div>
                    </dl>
                  </aside>
                </div>
              )}

              {activeTab === 'products' && (
                <div className="sc-products-layout">
                  <div className="sc-section-head">
                    <h2>Products ({stats.totalProducts})</h2>
                  </div>

                  <div className="sc-tabs">
                    <button className={`sc-tab${productTab === 'all' ? ' active' : ''}`} onClick={() => setProductTab('all')}>All</button>
                    <button className={`sc-tab${productTab === 'live' ? ' active' : ''}`} onClick={() => setProductTab('live')}>Live</button>
                    <button className={`sc-tab${productTab === 'soldout' ? ' active' : ''}`} onClick={() => setProductTab('soldout')}>Sold Out</button>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="sc-empty">
                      <p>{productTab === 'all' ? 'No products found for this shop.' : `No ${productTab} products.`}</p>
                    </div>
                  ) : (
                    <div className="sc-table-wrap">
                      <table className="sc-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Variants</th>
                            <th>Status</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((item) => {
                            const state = getProductState(item)
                            return (
                              <tr key={item.id}>
                                <td>
                                  <div className="sc-product-cell">
                                    {item.imageUrl ? (
                                      <img src={item.imageUrl} alt={item.name} className="sc-product-thumb" />
                                    ) : (
                                      <div className="sc-product-thumb-sc">LC</div>
                                    )}
                                    <span>{item.name}</span>
                                  </div>
                                </td>
                                <td>{formatPeso(item.price)}</td>
                                <td>{item.stock}</td>
                                <td>{item.hasVariations ? `${item.variationCount}` : '—'}</td>
                                <td>
                                  <span className={`sc-status ${state === 'live' ? 'sc-status-live' : 'sc-status-soldout'}`}>
                                    {state === 'live' ? 'Live' : 'Sold Out'}
                                  </span>
                                </td>
                                <td>
                                  <button type="button" className="sc-btn" onClick={() => void openProductDetail(item)}>View</button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'orders' && (
                <div className="sc-orders-layout">
                  <h2>Service Requests ({stats.totalOrders})</h2>
                  {requests.length === 0 ? (
                    <div className="sc-empty"><p>No service requests for this shop.</p></div>
                  ) : (
                    <div className="sc-table-wrap">
                      <table className="sc-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Requester Details</th>
                            <th>Deceased Info</th>
                            <th>Status</th>
                            <th>Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {requests.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <div className="sc-product-cell">
                                  {r.productImageUrl ? (
                                    <img src={r.productImageUrl} alt={r.productName} className="sc-product-thumb" />
                                  ) : (
                                    <div className="sc-product-thumb-sc">LC</div>
                                  )}
                                  <div>
                                    <div className="admin-shop-request-product">{r.productName || 'Custom Casket'}</div>
                                    {r.variationName && <div className="admin-shop-request-variation">Variation: {r.variationName}</div>}
                                    <div className="admin-shop-request-price">{formatPeso(r.productPrice)}</div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="admin-shop-request-contact">
                                  <div><strong>Type:</strong> {r.requestType?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</div>
                                  <div><strong>Contact:</strong> {r.contactNumber || '—'}</div>
                                </div>
                              </td>
                              <td>
                                <div className="admin-shop-request-contact">
                                  <div>{r.deceasedFullName || '—'}</div>
                                  {r.deceasedDateOfPassing && (
                                    <div className="admin-shop-request-sub">
                                      Passing: {new Date(r.deceasedDateOfPassing).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span className={`sc-status ${requestStatusClass(r.status)}`}>{requestStatusLabel(r.status)}</span>
                              </td>
                              <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'shop' && (
                <div className="sc-shop-layout">
                  <h2>Shop Profile</h2>
                  <div className="sc-card">
                    <div className="sc-shop-cover">
                      {shop.coverImageUrl ? (
                        <img src={shop.coverImageUrl} alt={`${shop.shopName} cover`} />
                      ) : (
                        <span className="sc-shop-cover-ph">No cover photo</span>
                      )}
                    </div>
                    <div className="sc-shop-header">
                      <div className="sc-shop-icon">
                        {shop.shopImageUrl ? (
                          <img src={shop.shopImageUrl} alt={shop.shopName} />
                        ) : (
                          <span className="sc-shop-icon-ph">LC</span>
                        )}
                      </div>
                      <div>
                        <h3>{shop.shopName}</h3>
                        {statusBadge(shop.status)}
                        {shop.rejectionReason && <p className="sc-rejection">Reason: {shop.rejectionReason}</p>}
                      </div>
                    </div>

                    <div className="sc-shop-section-head">
                      <h4>Shop Details</h4>
                    </div>
                    <div className="sc-detail-grid">
                      <div className="sc-detail"><span>Shop Name</span><strong>{shop.shopName || '—'}</strong></div>
                      <div className="sc-detail"><span>Shop Address</span><strong>{shop.shopAddress || '—'}</strong></div>
                      <div className="sc-detail"><span>Phone Number</span><strong>{shop.shopPhoneNumber || '—'}</strong></div>
                      <div className="sc-detail"><span>General Location</span><strong>{shop.generalLocation || '—'}</strong></div>
                      <div className="sc-detail"><span>Individual Registered Name</span><strong>{shop.individualRegisteredName || '—'}</strong></div>
                      <div className="sc-detail"><span>Business Name</span><strong>{shop.businessName || '—'}</strong></div>
                      <div className="sc-detail"><span>Registered Address</span><strong>{shop.registeredAddress || '—'}</strong></div>
                      <div className="sc-detail"><span>Zip Code</span><strong>{shop.zipCode || '—'}</strong></div>
                      <div className="sc-detail"><span>TIN</span><strong>{shop.tin || '—'}</strong></div>
                      <div className="sc-detail"><span>VAT Registration Status</span><strong>{shop.vatRegistrationStatus ? 'VAT Registered' : 'Non Registered'}</strong></div>
                    </div>

                    <div className="sc-shop-section-head">
                      <h4>Owner Details</h4>
                    </div>
                    <div className="sc-detail-grid">
                      <div className="sc-detail"><span>Owner</span><strong>{shop.ownerName || '—'}</strong></div>
                      <div className="sc-detail"><span>Owner Email</span><strong>{shop.ownerEmail || '—'}</strong></div>
                      <div className="sc-detail"><span>Member since</span><strong>{shop.createdAt ? new Date(shop.createdAt).toLocaleDateString() : '—'}</strong></div>
                    </div>

                    {shop.birCertificateUrl ? (
                      <div className="sc-detail-section">
                        <h5>BIR Certificate of Registration (Form 2303)</h5>
                        <div className="sc-bir-block">
                          <a href={shop.birCertificateUrl} target="_blank" rel="noreferrer" className="sc-bir-link">
                            <span className="sc-bir-icon" aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                                <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                            <span>View BIR Certificate</span>
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

          {!loading && !error && !shop && (
            <div className="sc-state">
              <h2>Shop Not Found</h2>
              <p>This funeral shop could not be found or has been removed.</p>
              <Link to="/admin/funeral-shops" className="sc-primary-btn">Back to Funeral Shops</Link>
            </div>
          )}
        </main>

      {selectedProduct && (
        <div className="sc-modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <h3>Product Details</h3>
              <button type="button" className="sc-modal-close" aria-label="Close" onClick={() => setSelectedProduct(null)}>×</button>
            </div>
            <div className="sc-modal-body">
              <div className="sc-product-detail-hero">
                <div className="sc-product-detail-gallery">
                  <button
                    type="button"
                    className="sc-gallery-main"
                    disabled={!mainImage}
                    aria-label={mainImage ? 'Open product image' : 'No product image available'}
                    onClick={() => mainImage && setLightboxOpen(true)}
                  >
                    {mainImage ? (
                      <img src={mainImage} alt={selectedProduct.name} />
                    ) : (
                      <div className="sc-gallery-main-ph">LC</div>
                    )}
                  </button>
                  {galleryImages.length > 1 && (
                    <div className="sc-gallery-thumbs">
                      {galleryImages.map((url, idx) => (
                        <button
                          type="button"
                          key={idx}
                          className={`sc-gallery-thumb ${idx === galleryIndex ? 'active' : ''}`}
                          aria-label={`Show product image ${idx + 1}`}
                          aria-pressed={idx === galleryIndex}
                          onClick={() => setGalleryIndex(idx)}
                        >
                          <img src={url} alt={`thumb ${idx + 1}`} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sc-product-detail-info">
                  <h4>{selectedProduct.name}</h4>
                  <span className={`sc-status ${getProductState(selectedProduct) === 'live' ? 'sc-status-live' : 'sc-status-soldout'}`}>
                    {getProductState(selectedProduct) === 'live' ? 'Live' : 'Sold Out'}
                  </span>
                  <div className="sc-product-detail-price">{formatPeso(selectedProduct.price)}</div>
                </div>
              </div>

              <div className="sc-detail-grid">
                <div className="sc-detail"><span>Stock</span><strong>{selectedProduct.stock}</strong></div>
                <div className="sc-detail"><span>Variants</span><strong>{selectedProduct.hasVariations ? selectedProduct.variationCount : 'None'}</strong></div>
                <div className="sc-detail"><span>Created</span><strong>{selectedProduct.createdAt ? new Date(selectedProduct.createdAt).toLocaleDateString() : '—'}</strong></div>
                <div className="sc-detail"><span>Status</span><strong>{getProductState(selectedProduct) === 'live' ? 'Live' : 'Sold Out'}</strong></div>
              </div>

              {selectedProduct.description ? (
                <div className="sc-detail-section">
                  <h5>Description</h5>
                  <p>{selectedProduct.description}</p>
                </div>
              ) : null}

              {detailLoading && (
                <div className="sc-empty">
                  <div className="sc-spinner" />
                  <p>Loading product details…</p>
                </div>
              )}

              {detailError && <p className="sc-rejection">{detailError}</p>}

              {detailData && detailData.variations.length > 0 && (
                <div className="sc-detail-section">
                  <h5>Variations ({detailData.variations.length})</h5>
                  <div className="sc-var-list">
                    {detailData.variations.map((v) => (
                      <div className="sc-var-item" key={v.id}>
                        {v.imageUrl ? <img src={v.imageUrl} alt={v.name} /> : <div className="sc-var-ph">LC</div>}
                        <span>{v.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailData && (
                <div className="sc-detail-section">
                  <h5>Ratings &amp; Feedback</h5>
                  <div className="sc-rating-summary">
                    <span className="sc-rating-score">
                      {detailData.ratingCount ? detailData.averageRating.toFixed(1) : '—'}
                    </span>
                    <div>
                      <Stars value={detailData.averageRating} />
                      <div className="sc-rating-meta">
                        {detailData.ratingCount} rating{detailData.ratingCount === 1 ? '' : 's'} · {detailData.feedbackCount} feedback
                      </div>
                    </div>
                  </div>

                  {detailData.feedbacks.length === 0 ? (
                    <p className="sc-modal-muted">No customer feedback for this product yet.</p>
                  ) : (
                    <div className="sc-feedback-list">
                      {detailData.feedbacks.map((fb) => (
                        <div className="sc-feedback-item" key={fb.id}>
                          <div className="sc-feedback-item-head">
                            <span className="sc-feedback-author">{fb.displayName || fb.userEmail || 'Anonymous'}</span>
                            <span className="sc-feedback-date">
                              {fb.createdAt ? new Date(fb.createdAt).toLocaleDateString() : ''}
                            </span>
                          </div>
                          {fb.ratingSnapshot ? (
                            <div className="sc-feedback-stars"><Stars value={fb.ratingSnapshot} /></div>
                          ) : null}
                          <p className="sc-feedback-text">{fb.feedback}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {lightboxOpen && mainImage && (
        <div className="sc-lightbox" onClick={() => setLightboxOpen(false)}>
          <button type="button" className="sc-lightbox-close" aria-label="Close image" onClick={() => setLightboxOpen(false)}>×</button>
          <button
            type="button"
            className="sc-lightbox-nav sc-lightbox-prev"
            aria-label="Previous image"
            onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev > 0 ? prev - 1 : galleryImages.length - 1)) }}
          >‹</button>
          <img src={mainImage} alt="Product" className="sc-lightbox-img" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="sc-lightbox-nav sc-lightbox-next"
            aria-label="Next image"
            onClick={(e) => { e.stopPropagation(); setGalleryIndex((prev) => (prev < galleryImages.length - 1 ? prev + 1 : 0)) }}
          >›</button>
          <span className="sc-lightbox-counter">{galleryIndex + 1} / {galleryImages.length}</span>
        </div>
      )}
    </section>
  )
}

export default AdminShopCentrePage
