import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'

type ShopItem = {
  id: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  shopImageUrl: string | null
  individualRegisteredName: string
  businessName: string
  generalLocation: string
  registeredAddress: string
  zipCode: string
  tin: string
  vatRegistrationStatus: boolean
  birCertificateUrl: string | null
  status: string
  rejectionReason: string | null
  submittedAt: string | null
  ownerEmail: string
  ownerFullName: string
}

function normalize(value: string | undefined | null) {
  return String(value || '').trim().toLowerCase()
}

function AdminFuneralShopsPage() {
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [items, setItems] = useState<ShopItem[]>([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [queryText, setQueryText] = useState('')
  const [error, setError] = useState('')
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: fetchError } = await supabase
        .from('funeral_shops')
        .select(`
          *,
          users!funeral_shops_id_fkey ( email, "fullName" )
        `)
        .in('status', ['pending', 'verified', 'rejected', 'live', 'offline'])
        .order('submittedAt', { ascending: false })

      if (fetchError) throw fetchError

      const list: ShopItem[] = (data || []).map((row: any) => ({
        id: row.id,
        shopName: row.shopName || '',
        shopAddress: row.shopAddress || '',
        shopPhoneNumber: row.shopPhoneNumber || '',
        shopImageUrl: row.shopImageUrl || null,
        individualRegisteredName: row.individualRegisteredName || '',
        businessName: row.businessName || '',
        generalLocation: row.generalLocation || '',
        registeredAddress: row.registeredAddress || '',
        zipCode: row.zipCode || '',
        tin: row.tin || '',
        vatRegistrationStatus: Boolean(row.vatRegistrationStatus),
        birCertificateUrl: row.birCertificateUrl || null,
        status: row.status || 'pending',
        rejectionReason: row.rejectionReason || null,
        submittedAt: row.submittedAt || null,
        ownerEmail: row.users?.email || '',
        ownerFullName: row.users?.fullName || '',
      }))
      setItems(list)
    } catch {
      setError('Unable to load funeral shop records right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = useMemo(() => {
    const q = normalize(queryText)
    let list = items
    if (statusFilter !== 'all') {
      list = list.filter((item) => normalize(item.status) === statusFilter)
    }
    if (!q) return list
    return list.filter((item) =>
      [
        item.ownerFullName,
        item.ownerEmail,
        item.shopName,
        item.businessName,
        item.generalLocation,
      ].some((value) => normalize(value).includes(q)),
    )
  }, [items, statusFilter, queryText])

  const exportShops = () => {
    const csv = buildCsv(filtered, [
      { header: 'Shop ID', value: (row) => row.id },
      { header: 'Shop Name', value: (row) => row.shopName || '' },
      { header: 'Shop Address', value: (row) => row.shopAddress || '' },
      { header: 'Shop Phone Number', value: (row) => row.shopPhoneNumber || '' },
      { header: 'Owner Full Name', value: (row) => row.ownerFullName || '' },
      { header: 'Owner Email', value: (row) => row.ownerEmail || '' },
      { header: 'Individual Registered Name', value: (row) => row.individualRegisteredName || '' },
      { header: 'Business Name', value: (row) => row.businessName || '' },
      { header: 'General Location', value: (row) => row.generalLocation || '' },
      { header: 'Registered Address', value: (row) => row.registeredAddress || '' },
      { header: 'ZIP Code', value: (row) => row.zipCode || '' },
      { header: 'TIN', value: (row) => row.tin || '' },
      { header: 'VAT Registration', value: (row) => (row.vatRegistrationStatus ? 'Yes' : 'No') },
      { header: 'Status', value: (row) => row.status || '' },
      { header: 'Rejection Reason', value: (row) => row.rejectionReason || '' },
      { header: 'Submitted At', value: (row) => csvTimestamp(row.submittedAt || null) },
    ])
    downloadCsv(`funeral-shops-${dateStamp()}.csv`, csv)
  }

  const setShopStatus = async (itemId: string, nextStatus: 'verified' | 'rejected') => {
    const item = items.find((entry) => entry.id === itemId)
    openConfirm({
      title: nextStatus === 'verified' ? 'Approve this funeral shop?' : 'Reject this funeral shop?',
      message: `You are about to ${nextStatus === 'verified' ? 'approve' : 'reject'} ${item?.shopName || item?.ownerEmail || 'this shop'}.`,
      details:
        nextStatus === 'verified'
          ? ['The shop status will become verified.']
          : ['The shop status will become rejected.'],
      tone: nextStatus === 'verified' ? 'success' : 'danger',
      confirmLabel: nextStatus === 'verified' ? 'Approve Shop' : 'Reject Shop',
      onConfirm: async () => {
        setSavingId(itemId)
        try {
          const updateData: Record<string, any> = {
            status: nextStatus,
            rejectionReason: nextStatus === 'rejected' ? 'Rejected by admin' : null,
            updatedAt: new Date().toISOString(),
          }
          if (nextStatus === 'verified') {
            updateData.verifiedAt = new Date().toISOString()
          }
          const { error: updateError } = await supabase
            .from('funeral_shops')
            .update(updateData)
            .eq('id', itemId)
          if (updateError) throw updateError
          await load()
        } finally {
          setSavingId('')
        }
      },
    })
  }

  const deleteShop = async (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId)
    openConfirm({
      title: 'Delete this funeral shop?',
      message: `This will permanently remove the shop record for ${item?.shopName || item?.ownerEmail || 'this shop'}.`,
      details: [
        'The funeral shop record will be deleted.',
        'All associated products, variations, and images will be removed (cascade).',
        'The user account itself will remain.',
      ],
      tone: 'danger',
      confirmLabel: 'Delete Shop',
      onConfirm: async () => {
        setSavingId(itemId)
        try {
          const { error: deleteError } = await supabase
            .from('funeral_shops')
            .delete()
            .eq('id', itemId)
          if (deleteError) throw deleteError
          await load()
        } finally {
          setSavingId('')
        }
      },
    })
  }

  return (
    <>
      <section className="panel">
        <h2>Funeral Shop Management</h2>
        <p className="panel-sub">Review funeral shop registrations and approve or reject submitted shop records.</p>

        <div className="admin-filters admin-filters-advanced">
          <div>
            <label htmlFor="admin-funeral-search">Search</label>
            <input
              id="admin-funeral-search"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Shop, owner, email, business, location"
            />
          </div>
          <div>
            <label htmlFor="admin-funeral-status">Shop Status</label>
            <select id="admin-funeral-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="live">Live</option>
              <option value="offline">Offline</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label>&nbsp;</label>
            <button type="button" className="ghost-btn admin-export-btn" onClick={exportShops}>
              Export CSV
            </button>
          </div>
        </div>

        {loading ? <p className="panel-sub">Loading funeral shops...</p> : null}
        {error ? <p className="auth-message auth-message-error">{error}</p> : null}
        {!loading && filtered.length === 0 ? <p className="panel-sub">No funeral shops found.</p> : null}

        <div className="table-wrap">
          <table className="request-table">
            <thead>
              <tr>
                <th>Shop</th>
                <th>Owner</th>
                <th>Email</th>
                <th>Business</th>
                <th>Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const status = normalize(item.status) || 'none'
                const busy = savingId === item.id
                return (
                  <tr key={item.id}>
                    <td>{item.shopName || '-'}</td>
                    <td>{item.ownerFullName || '-'}</td>
                    <td>{item.ownerEmail || '-'}</td>
                    <td>{item.businessName || '-'}</td>
                    <td>{item.generalLocation || '-'}</td>
                    <td>
                      <span className={`status-pill ${status}`}>{status}</span>
                      {item.rejectionReason ? <div>{item.rejectionReason}</div> : null}
                    </td>
                    <td>
                      <div className="request-actions">
                        <Link to={`/admin/funeral-shops/${item.id}/details`} className="ghost-btn btn-link table-action">
                          View Details
                        </Link>
                        <Link to={`/admin/funeral-shops/${item.id}`} className="ghost-btn btn-link table-action">
                          View Shop
                        </Link>
                        <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void deleteShop(item.id)}>
                          Delete Shop
                        </button>
                        {status === 'pending' ? (
                          <>
                            <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void setShopStatus(item.id, 'verified')}>
                              Approve
                            </button>
                            <button type="button" className="ghost-btn table-action" disabled={busy} onClick={() => void setShopStatus(item.id, 'rejected')}>
                              Reject
                            </button>
                          </>
                        ) : null}
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

export default AdminFuneralShopsPage
