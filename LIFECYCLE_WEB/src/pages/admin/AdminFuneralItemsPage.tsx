import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import './AdminFuneralItemsPage.css'

type ProductRow = {
  id: string
  shopId: string
  shopName: string
  ownerName: string
  ownerEmail: string
  name: string
  description: string
  price: string
  stock: number
  imageUrl: string | null
  active: boolean
  updatedAt: string
}

function normalize(value: string | undefined | null) {
  return String(value || '').trim().toLowerCase()
}

function formatPeso(value: string | number | null | undefined) {
  const num = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return value ? String(value) : '-'
  return `PHP ${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(num)}`
}

function AdminFuneralItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [items, setItems] = useState<ProductRow[]>([])
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [savingKey, setSavingKey] = useState('')
  const shopFilter = searchParams.get('shop') || ''
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      let query = supabase
        .from('funeral_products')
        .select(`
          *,
          funeral_shops!inner (
            "shopName",
            users!funeral_shops_id_fkey ( email, "fullName" )
          )
        `)
        .order('createdAt', { ascending: false })

      if (shopFilter) {
        query = query.eq('shopId', shopFilter)
      }

      const { data, error: fetchError } = await query

      if (fetchError) throw fetchError

      const rows: ProductRow[] = (data || []).map((row: any) => ({
        id: row.id,
        shopId: row.shopId,
        shopName: row.funeral_shops?.shopName || 'Unnamed Shop',
        ownerName: row.funeral_shops?.users?.fullName || '-',
        ownerEmail: row.funeral_shops?.users?.email || '-',
        name: row.name || 'Untitled Item',
        description: row.description || '',
        price: row.price != null ? String(row.price) : '-',
        stock: Number(row.stock) || 0,
        imageUrl: row.imageUrl ?? null,
        active: Boolean(row.active),
        updatedAt: row.updatedAt || '',
      }))
      setItems(rows)
    } catch {
      setError('Unable to load funeral items right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopFilter])

  const filtered = useMemo(() => {
    const q = normalize(queryText)
    let list = items

    if (statusFilter === 'available') {
      list = list.filter((item) => item.active && item.stock > 0)
    } else if (statusFilter === 'soldout') {
      list = list.filter((item) => item.stock <= 0)
    } else if (statusFilter === 'hidden') {
      list = list.filter((item) => !item.active)
    }

    if (!q) return list

    return list.filter((item) =>
      [item.name, item.shopName, item.ownerName, item.ownerEmail].some((value) => normalize(value).includes(q)),
    )
  }, [items, queryText, statusFilter])

  const activeShopName = useMemo(() => {
    if (!shopFilter) return ''
    return items.find((item) => item.shopId === shopFilter)?.shopName || ''
  }, [items, shopFilter])

  const deleteItem = async (item: ProductRow) => {
    openConfirm({
      title: 'Delete this funeral item?',
      message: `This will remove ${item.name} from ${item.shopName}.`,
      details: ['The product and its variations/images will be permanently deleted.'],
      tone: 'danger',
      confirmLabel: 'Delete Item',
      onConfirm: async () => {
        setSavingKey(`${item.shopId}_${item.id}`)
        try {
          const { error: deleteError } = await supabase
            .from('funeral_products')
            .delete()
            .eq('id', item.id)
          if (deleteError) throw deleteError
          await load()
        } finally {
          setSavingKey('')
        }
      },
    })
  }

  return (
    <>
      <section className="panel">
        <h2>Products</h2>
        <p className="panel-sub">
          Review published shop products from funeral accounts.
          {activeShopName ? ` Showing items for ${activeShopName}.` : ''}
        </p>

      <div className="admin-filters admin-filters-advanced">
        <div>
          <label htmlFor="admin-funeral-item-search">Search</label>
          <input
            id="admin-funeral-item-search"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="Item, shop, owner, email"
          />
        </div>
        <div>
          <label htmlFor="admin-funeral-item-status">Item State</label>
          <select id="admin-funeral-item-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="soldout">Sold Out</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>
        {shopFilter ? (
          <div>
            <label>&nbsp;</label>
            <button type="button" className="ghost-btn table-action" onClick={() => setSearchParams({})}>
              Clear Shop Filter
            </button>
          </div>
        ) : null}
      </div>

      {loading ? <p className="panel-sub">Loading funeral items...</p> : null}
      {error ? <p className="auth-message auth-message-error">{error}</p> : null}
      {!loading && filtered.length === 0 ? <p className="panel-sub">No funeral items found.</p> : null}

        <div className="table-wrap">
          <table className="request-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Shop</th>
                <th>Owner</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const busy = savingKey === `${item.shopId}_${item.id}`
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="admin-product-list-cell">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} />
                        ) : (
                          <span className="admin-product-list-placeholder">LC</span>
                        )}
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.description || 'No description provided'}</span>
                        </div>
                      </div>
                    </td>
                    <td>{item.shopName}</td>
                    <td>
                      <strong>{item.ownerName}</strong>
                      <div>{item.ownerEmail}</div>
                    </td>
                    <td>{formatPeso(item.price)}</td>
                    <td>{item.stock}</td>
                    <td>
                      <span className={`status-pill ${item.active ? (item.stock > 0 ? 'verified' : 'pending') : 'rejected'}`}>
                        {item.active ? (item.stock > 0 ? 'available' : 'sold out') : 'hidden'}
                      </span>
                    </td>
                    <td>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '-'}</td>
                    <td>
                      <div className="request-actions">
                        <Link to={`/admin/funeral-items/${item.id}`} className="ghost-btn btn-link table-action">
                          View
                        </Link>
                        <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void deleteItem(item)}>
                          Delete Item
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      {confirmDialog}
    </>
  )
}

export default AdminFuneralItemsPage
