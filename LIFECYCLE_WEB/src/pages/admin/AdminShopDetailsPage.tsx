import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import '../SellerCentrePage.css'

type ShopDetail = {
  id: string
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  shopImageUrl: string | null
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
  ownerName: string
  ownerEmail: string
  createdAt: string
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

export default function AdminShopDetailsPage() {
  const { id = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shop, setShop] = useState<ShopDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const load = useCallback(async () => {
    if (!id) {
      setError('No shop selected.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error: fetchError } = await supabase
        .from('funeral_shops')
        .select(`
          *,
          users!funeral_shops_id_fkey ( email, "fullName" )
        `)
        .eq('id', id)
        .maybeSingle()
      if (fetchError) throw fetchError

      if (!data) {
        setError('Funeral shop not found.')
        setLoading(false)
        return
      }

      const row: any = data
      setShop({
        id: row.id,
        shopName: row.shopName || '',
        shopAddress: row.shopAddress || '',
        shopPhoneNumber: row.shopPhoneNumber || '',
        shopImageUrl: row.shopImageUrl || null,
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
        ownerName: row.users?.fullName || '',
        ownerEmail: row.users?.email || '',
        createdAt: row.createdAt || '',
      })
    } catch (e: any) {
      setError(e?.message ?? 'Unable to load shop details.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const setShopStatus = (nextStatus: 'verified' | 'rejected') => {
    if (!shop || saving) return
    openConfirm({
      title: nextStatus === 'verified' ? 'Approve this funeral shop?' : 'Reject this funeral shop?',
      message: `You are about to ${nextStatus === 'verified' ? 'approve' : 'reject'} ${shop.shopName || shop.ownerEmail || 'this shop'} based on its registration details.`,
      details:
        nextStatus === 'verified'
          ? ['The shop status will become verified.']
          : ['The shop status will become rejected.'],
      tone: nextStatus === 'verified' ? 'success' : 'danger',
      confirmLabel: nextStatus === 'verified' ? 'Approve Shop' : 'Reject Shop',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setSaving(true)
        try {
          const updateData: Record<string, any> = {
            status: nextStatus,
            rejectionReason: nextStatus === 'rejected' ? 'Rejected by admin' : null,
            updatedAt: new Date().toISOString(),
          }
          if (nextStatus === 'verified') updateData.verifiedAt = new Date().toISOString()
          const { error: updateError } = await supabase
            .from('funeral_shops')
            .update(updateData)
            .eq('id', shop.id)
          if (updateError) throw updateError
          await load()
        } catch (e: any) {
          setError(e?.message ?? 'Unable to update shop status.')
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return (
    <section className="panel sc-page admin-shop-detail-page">
      <header className="admin-detail-page-head">
        <div>
          <h2>Registration details</h2>
          <p className="panel-sub">Verify the submitted shop, owner, and business information before making a decision.</p>
        </div>
        <Link to="/admin/funeral-shops" className="ghost-btn btn-link">Back to funeral shops</Link>
      </header>

      <div className="sc-workspace">
        <main className="sc-content-area">
          {loading && (
            <div className="sc-state">
              <div className="sc-spinner" />
              <p>Loading shop details…</p>
            </div>
          )}

          {error && !loading && (
            <div className="sc-state sc-state-error">
              <p>{error}</p>
              <button className="sc-primary-btn" onClick={() => void load()}>Retry</button>
            </div>
          )}

          {!loading && !error && shop && (
            <div className="sc-shop-layout">
              <div className="sc-details-summary">
                <div className="sc-details-summary-icon">
                  {shop.shopImageUrl ? (
                    <img src={shop.shopImageUrl} alt={shop.shopName} />
                  ) : (
                    <span>LC</span>
                  )}
                </div>
                <div className="sc-details-summary-main">
                  <h3 className="sc-details-summary-title">{shop.shopName || 'Unnamed Shop'}</h3>
                  <div className="sc-details-summary-status">{statusBadge(shop.status)}</div>
                  <div className="sc-details-summary-meta">
                    <div className="sc-details-summary-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <span>Owner: <strong>{shop.ownerName || 'Not provided'}</strong></span>
                    </div>
                    <div className="sc-details-summary-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <polyline points="22,6 12,13 2,6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{shop.ownerEmail || 'No email on file'}</span>
                    </div>
                    <div className="sc-details-summary-meta-item">
                      <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                        <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="2" />
                        <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="2" />
                        <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <span>Submitted: <strong>{shop.createdAt ? new Date(shop.createdAt).toLocaleDateString() : 'Not provided'}</strong></span>
                    </div>
                  </div>
                </div>
              </div>

              {shop.rejectionReason ? (
                <div className="sc-details-note sc-details-note-danger">
                  <strong>Rejection reason:</strong> {shop.rejectionReason}
                </div>
              ) : null}

              <div className="sc-details-card">
                <h4 className="sc-details-head">Shop &amp; Contact</h4>
                <p className="sc-details-head-sub">Contact and location details the seller provided for the shop.</p>
                <div className="sc-details-grid">
                  <div className="sc-detail"><span>Shop Name</span><strong>{shop.shopName || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Shop Address</span><strong>{shop.shopAddress || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Phone Number</span><strong>{shop.shopPhoneNumber || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>General Location</span><strong>{shop.generalLocation || <em className="sc-detail-none">Not provided</em>}</strong></div>
                </div>
              </div>

              <div className="sc-details-card">
                <h4 className="sc-details-head">Business &amp; Legal</h4>
                <p className="sc-details-head-sub">Legal and registration details used to verify the business.</p>
                <div className="sc-details-grid">
                  <div className="sc-detail"><span>Individual Registered Name</span><strong>{shop.individualRegisteredName || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Business Name</span><strong>{shop.businessName || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Registered Address</span><strong>{shop.registeredAddress || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Zip Code</span><strong>{shop.zipCode || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>TIN</span><strong>{shop.tin || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>VAT Registration Status</span><strong>{shop.vatRegistrationStatus ? 'VAT Registered' : 'Non Registered'}</strong></div>
                </div>
              </div>

              <div className="sc-details-card">
                <h4 className="sc-details-head">Owner Details</h4>
                <p className="sc-details-head-sub">The account holder who owns and operates this shop.</p>
                <div className="sc-details-grid">
                  <div className="sc-detail"><span>Owner</span><strong>{shop.ownerName || <em className="sc-detail-none">Not provided</em>}</strong></div>
                  <div className="sc-detail"><span>Owner Email</span><strong>{shop.ownerEmail || <em className="sc-detail-none">Not provided</em>}</strong></div>
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
                ) : (
                  <div className="sc-detail-section">
                    <h5>BIR Certificate of Registration (Form 2303)</h5>
                    <p className="sc-details-head-sub">No BIR certificate was uploaded by the seller.</p>
                  </div>
                )}
              </div>

              <div className="sc-details-decision">
                <h4 className="sc-details-head">Review &amp; Decision</h4>
                <p className="sc-details-head-sub">
                  Compare the information above against the requirements. Approving makes the shop <strong>verified</strong> so it can proceed to payment and go live.
                </p>
                <div className="sc-shop-decision-actions">
                  <button
                    type="button"
                    className="sc-btn sc-btn-secondary"
                    disabled={saving || shop.status === 'verified' || shop.status === 'live' || shop.status === 'offline'}
                    onClick={() => void setShopStatus('verified')}
                  >
                    {saving ? 'Saving...' : shop.status === 'verified' ? 'Shop Already Verified' : shop.status === 'live' ? 'Shop is Live' : shop.status === 'offline' ? 'Shop is Offline' : 'Approve / Verify'}
                  </button>
                  <button
                    type="button"
                    className="sc-btn sc-btn-danger"
                    disabled={saving || shop.status === 'rejected'}
                    onClick={() => void setShopStatus('rejected')}
                  >
                    {saving ? 'Saving...' : shop.status === 'rejected' ? 'Shop Already Rejected' : 'Reject Shop'}
                  </button>
                </div>
              </div>
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
      </div>

      {confirmDialog}
    </section>
  )
}
