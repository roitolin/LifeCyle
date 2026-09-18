import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { logWebAdminActivity } from '@/utils/adminActivity'
import { createNotification } from '@/utils/supabaseNotifications'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'
import './AdminPayoutAccountsPage.css'

export type PayoutChannel = {
  code: string
  label: string
  type: 'wallet' | 'bank'
  shortName: string
}

export const PAYOUT_CHANNELS: PayoutChannel[] = [
  { code: 'PH_GCASH', label: 'GCash', type: 'wallet', shortName: 'GCash' },
  { code: 'PH_MAYA', label: 'Maya', type: 'wallet', shortName: 'Maya' },
  { code: 'PH_BDO', label: 'BDO Unibank', type: 'bank', shortName: 'BDO' },
  { code: 'PH_BPI', label: 'Bank of the Philippine Islands (BPI)', type: 'bank', shortName: 'BPI' },
  { code: 'PH_UBP', label: 'UnionBank of the Philippines', type: 'bank', shortName: 'UnionBank' },
  { code: 'PH_METROBANK', label: 'Metrobank', type: 'bank', shortName: 'Metrobank' },
  { code: 'PH_LANDBANK', label: 'Landbank of the Philippines', type: 'bank', shortName: 'Landbank' },
  { code: 'PH_PNB', label: 'Philippine National Bank (PNB)', type: 'bank', shortName: 'PNB' },
  { code: 'PH_RCBC', label: 'Rizal Commercial Banking Corp (RCBC)', type: 'bank', shortName: 'RCBC' },
  { code: 'PH_CHINABANK', label: 'China Banking Corporation', type: 'bank', shortName: 'Chinabank' },
  { code: 'PH_SECURITYBANK', label: 'Security Bank', type: 'bank', shortName: 'Security Bank' },
  { code: 'PH_EASTWESTBANK', label: 'EastWest Bank', type: 'bank', shortName: 'EastWest' },
]

export function getChannelInfo(code?: string | null): PayoutChannel | null {
  if (!code) return null
  return PAYOUT_CHANNELS.find((c) => c.code === code) || null
}

export type ShopPayoutRecord = {
  id: string
  shopName: string
  shopImageUrl: string | null
  status: string
  payoutChannelCode: string | null
  payoutAccountName: string | null
  payoutAccountNumber: string | null
  payoutVerifiedByAdmin: boolean
  payoutVerifiedAt: string | null
  ownerId: string | null
  ownerEmail: string
  ownerFullName: string
}

type FilterTab = 'pending' | 'verified' | 'missing' | 'all'

export default function AdminPayoutAccountsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const [shops, setShops] = useState<ShopPayoutRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Modal State
  const [modalShop, setModalShop] = useState<ShopPayoutRecord | null>(null)
  const [formChannel, setFormChannel] = useState('')
  const [formName, setFormName] = useState('')
  const [formNumber, setFormNumber] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)

  const loadShops = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('funeral_shops')
        .select(`
          id,
          shopName,
          shopImageUrl,
          status,
          payoutChannelCode,
          payoutAccountName,
          payoutAccountNumber,
          payoutVerifiedByAdmin,
          payoutVerifiedAt,
          users!funeral_shops_id_fkey ( id, email, "fullName" )
        `)
        .in('status', ['pending', 'verified', 'rejected', 'live', 'offline'])
        .order('shopName', { ascending: true })

      if (error) throw error

      const parsed: ShopPayoutRecord[] = (data || []).map((row: any) => ({
        id: row.id,
        shopName: row.shopName || 'Unnamed Shop',
        shopImageUrl: row.shopImageUrl || null,
        status: row.status || 'pending',
        payoutChannelCode: row.payoutChannelCode || null,
        payoutAccountName: row.payoutAccountName || null,
        payoutAccountNumber: row.payoutAccountNumber || null,
        payoutVerifiedByAdmin: Boolean(row.payoutVerifiedByAdmin),
        payoutVerifiedAt: row.payoutVerifiedAt || null,
        ownerId: row.users?.id || null,
        ownerEmail: row.users?.email || '',
        ownerFullName: row.users?.fullName || '',
      }))

      setShops(parsed)
    } catch (err: any) {
      openAlert({
        title: 'Load Failed',
        message: err?.message || 'Unable to load funeral shop payout records.',
        tone: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }, [openAlert])

  useEffect(() => {
    void loadShops()
  }, [loadShops])

  // Count summaries
  const pendingCount = useMemo(
    () => shops.filter((s) => !s.payoutVerifiedByAdmin && Boolean(s.payoutChannelCode)).length,
    [shops],
  )
  const verifiedCount = useMemo(
    () => shops.filter((s) => s.payoutVerifiedByAdmin).length,
    [shops],
  )
  const missingCount = useMemo(
    () => shops.filter((s) => !s.payoutChannelCode).length,
    [shops],
  )
  const totalCount = shops.length

  // Filtered shops
  const filteredShops = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return shops.filter((s) => {
      if (activeFilter === 'pending') {
        if (s.payoutVerifiedByAdmin || !s.payoutChannelCode) return false
      } else if (activeFilter === 'verified') {
        if (!s.payoutVerifiedByAdmin) return false
      } else if (activeFilter === 'missing') {
        if (s.payoutChannelCode) return false
      }

      if (!q) return true
      const channelObj = getChannelInfo(s.payoutChannelCode)
      return (
        s.shopName.toLowerCase().includes(q) ||
        s.ownerEmail.toLowerCase().includes(q) ||
        s.ownerFullName.toLowerCase().includes(q) ||
        (s.payoutAccountName && s.payoutAccountName.toLowerCase().includes(q)) ||
        (s.payoutAccountNumber && s.payoutAccountNumber.toLowerCase().includes(q)) ||
        (channelObj && channelObj.label.toLowerCase().includes(q))
      )
    })
  }, [shops, activeFilter, searchQuery])

  // Open modal
  const handleOpenReview = (shop: ShopPayoutRecord) => {
    setModalShop(shop)
    setFormChannel(shop.payoutChannelCode || 'PH_GCASH')
    setFormName(shop.payoutAccountName || '')
    setFormNumber(shop.payoutAccountNumber || '')
  }

  const handleCloseModal = () => {
    setModalShop(null)
    setIsVerifying(false)
  }

  // Copy account number
  const handleCopyNumber = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  // Verify / Save Payout
  const handleSaveAndVerify = async () => {
    if (!modalShop) return
    const channel = formChannel.trim()
    const name = formName.trim()
    const number = formNumber.trim()

    if (!channel) {
      openAlert({ title: 'Validation Error', message: 'Please select a payout channel.', tone: 'warning' })
      return
    }
    if (!name) {
      openAlert({ title: 'Validation Error', message: 'Please enter the registered account name.', tone: 'warning' })
      return
    }
    if (!number || number.length < 5) {
      openAlert({ title: 'Validation Error', message: 'Please enter a valid account or mobile number.', tone: 'warning' })
      return
    }

    setIsVerifying(true)
    const nowIso = new Date().toISOString()
    const updatePayload = {
      payoutChannelCode: channel,
      payoutAccountName: name,
      payoutAccountNumber: number,
      payoutVerifiedByAdmin: true,
      payoutVerifiedAt: nowIso,
      updatedAt: nowIso,
    }

    try {
      // 1. Direct update in Supabase (allowed for admins by protect_shop_payout_fields)
      const { error: directErr } = await supabase
        .from('funeral_shops')
        .update(updatePayload)
        .eq('id', modalShop.id)

      if (directErr) {
        console.warn('Direct update failed, falling back to provision-xendit-shop:', directErr)
        // Fallback to provision-xendit-shop edge function
        const { error: fnErr } = await supabase.functions.invoke('provision-xendit-shop', {
          body: {
            shopId: modalShop.id,
            action: 'verify',
            payoutChannelCode: channel,
            payoutAccountName: name,
            payoutAccountNumber: number,
          },
        })
        if (fnErr) {
          let errorMsg = fnErr.message || 'Unable to verify payout account.'
          const context = (fnErr as any)?.context
          if (context && typeof context.json === 'function') {
            try {
              const body = await context.json()
              if (typeof body?.error === 'string') errorMsg = body.error
            } catch {
              // keep fallback message
            }
          }
          throw new Error(errorMsg)
        }
      }

      // Log admin activity
      const channelObj = getChannelInfo(channel)
      void logWebAdminActivity({
        action: 'payout_account_verified',
        targetType: 'funeral_shop',
        targetId: modalShop.id,
        summary: `Verified payout account for ${modalShop.shopName} (${channelObj?.label || channel}: ${number}).`,
        metadata: {
          shopId: modalShop.id,
          payoutChannelCode: channel,
          payoutAccountName: name,
        },
      })

      // Send notification to shop owner if known
      if (modalShop.ownerId) {
        void createNotification({
          userId: modalShop.ownerId,
          type: 'payout_account_verified',
          title: 'Payout Account Approved',
          body: `Your payout account (${channelObj?.label || channel}) for ${modalShop.shopName} has been verified by the administrator. 70% of customer order payments will now be transferred directly to this account.`,
          data: { shopId: modalShop.id },
        })
      }

      handleCloseModal()
      await loadShops()

      openAlert({
        title: 'Payout Account Verified',
        message: `${modalShop.shopName} is now fully verified to receive direct payouts via Xendit.`,
        tone: 'info',
      })
    } catch (err: any) {
      openAlert({
        title: 'Verification Failed',
        message: err?.message || 'Unable to verify payout account. Please try again.',
        tone: 'danger',
      })
    } finally {
      setIsVerifying(false)
    }
  }

  // Revoke / Unverify
  const handleUnverify = (shop: ShopPayoutRecord) => {
    openConfirm({
      title: 'Revoke Payout Verification?',
      message: `Are you sure you want to revoke the verified payout status for ${shop.shopName}?`,
      details: [
        'The shop will no longer receive automated 70% direct payouts until re-verified.',
        'Existing orders will not be affected.',
      ],
      tone: 'danger',
      confirmLabel: 'Revoke Verification',
      onConfirm: async () => {
        setSavingId(shop.id)
        try {
          const { error } = await supabase
            .from('funeral_shops')
            .update({
              payoutVerifiedByAdmin: false,
              payoutVerifiedAt: null,
              updatedAt: new Date().toISOString(),
            })
            .eq('id', shop.id)

          if (error) throw error

          void logWebAdminActivity({
            action: 'payout_account_unverified',
            targetType: 'funeral_shop',
            targetId: shop.id,
            summary: `Revoked payout account verification for ${shop.shopName}.`,
            metadata: { shopId: shop.id },
          })

          if (modalShop) handleCloseModal()
          await loadShops()
        } catch (err: any) {
          openAlert({
            title: 'Action Failed',
            message: err?.message || 'Unable to revoke payout verification.',
            tone: 'danger',
          })
        } finally {
          setSavingId(null)
        }
      },
    })
  }

  // Export CSV
  const handleExportCsv = () => {
    const csv = buildCsv(filteredShops, [
      { header: 'Shop ID', value: (row) => row.id },
      { header: 'Shop Name', value: (row) => row.shopName },
      { header: 'Owner Email', value: (row) => row.ownerEmail },
      { header: 'Owner Name', value: (row) => row.ownerFullName },
      { header: 'Shop Status', value: (row) => row.status },
      {
        header: 'Payout Channel',
        value: (row) => getChannelInfo(row.payoutChannelCode)?.label || row.payoutChannelCode || 'Not Set',
      },
      { header: 'Account Name', value: (row) => row.payoutAccountName || 'Not Set' },
      { header: 'Account Number', value: (row) => row.payoutAccountNumber || 'Not Set' },
      { header: 'Verified by Admin', value: (row) => (row.payoutVerifiedByAdmin ? 'YES' : 'NO') },
      { header: 'Verified At', value: (row) => csvTimestamp(row.payoutVerifiedAt) },
    ])
    downloadCsv(`shop-payout-accounts-${dateStamp()}.csv`, csv)
  }

  return (
    <div className="payout-page-container">
      {/* Header */}
      <header className="payout-header">
        <div className="payout-header-main">
          <h2>Shop Payout Accounts</h2>
          <p className="payout-header-sub">
            Verify and manage GCash, Maya, and bank payout details for partner funeral shops.
            Verified accounts receive direct payouts for completed customer service orders.
          </p>
        </div>
        <div className="payout-header-actions">
          <button type="button" className="operations-secondary-btn" onClick={loadShops} disabled={loading}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Refresh
          </button>
          <button type="button" className="operations-secondary-btn" onClick={handleExportCsv} disabled={shops.length === 0}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export CSV
          </button>
        </div>
      </header>

      {/* Metrics Summary */}
      <section className="payout-metrics" aria-label="Payout accounts statistics">
        <article className="payout-metric-card needs-review">
          <div className="payout-metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="payout-metric-content">
            <span className="payout-metric-label">Needs Verification</span>
            <strong className="payout-metric-value">{pendingCount}</strong>
          </div>
        </article>

        <article className="payout-metric-card verified">
          <div className="payout-metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="payout-metric-content">
            <span className="payout-metric-label">Verified Accounts</span>
            <strong className="payout-metric-value">{verifiedCount}</strong>
          </div>
        </article>

        <article className="payout-metric-card missing">
          <div className="payout-metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <div className="payout-metric-content">
            <span className="payout-metric-label">Not Submitted</span>
            <strong className="payout-metric-value">{missingCount}</strong>
          </div>
        </article>

        <article className="payout-metric-card total">
          <div className="payout-metric-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div className="payout-metric-content">
            <span className="payout-metric-label">Total Partner Shops</span>
            <strong className="payout-metric-value">{totalCount}</strong>
          </div>
        </article>
      </section>

      {/* Toolbar & Filter Tabs */}
      <section className="payout-toolbar">
        <div className="payout-tabs">
          <button
            type="button"
            className={`payout-tab-btn ${activeFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setActiveFilter('pending')}
          >
            Needs Verification
            {pendingCount > 0 && <span className="payout-tab-badge urgent">{pendingCount}</span>}
          </button>
          <button
            type="button"
            className={`payout-tab-btn ${activeFilter === 'verified' ? 'active' : ''}`}
            onClick={() => setActiveFilter('verified')}
          >
            Verified
            <span className="payout-tab-badge">{verifiedCount}</span>
          </button>
          <button
            type="button"
            className={`payout-tab-btn ${activeFilter === 'missing' ? 'active' : ''}`}
            onClick={() => setActiveFilter('missing')}
          >
            Not Submitted
            <span className="payout-tab-badge">{missingCount}</span>
          </button>
          <button
            type="button"
            className={`payout-tab-btn ${activeFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveFilter('all')}
          >
            All Shops
            <span className="payout-tab-badge">{totalCount}</span>
          </button>
        </div>

        <div className="payout-search-box">
          <span className="payout-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="Search by shop, account, number…"
            className="payout-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </section>

      {/* Table Card */}
      <div className="payout-table-card">
        {loading ? (
          <div className="payout-empty-state">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" className="rotating">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <h4>Loading Payout Accounts…</h4>
            <p>Fetching partner shops and direct payout channels.</p>
          </div>
        ) : filteredShops.length === 0 ? (
          <div className="payout-empty-state">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
            <h4>No Payout Accounts Found</h4>
            <p>
              {activeFilter === 'pending'
                ? 'No partner shops are currently awaiting payout account verification.'
                : 'No shop records matched your current filter criteria.'}
            </p>
          </div>
        ) : (
          <table className="payout-table">
            <thead>
              <tr>
                <th>Funeral Shop</th>
                <th>Payout Channel</th>
                <th>Account Name</th>
                <th>Account Number</th>
                <th>Verification Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredShops.map((shop) => {
                const channel = getChannelInfo(shop.payoutChannelCode)
                const isVerified = shop.payoutVerifiedByAdmin
                const hasChannel = Boolean(shop.payoutChannelCode)

                return (
                  <tr key={shop.id}>
                    <td>
                      <div className="payout-shop-cell">
                        <div className="payout-shop-avatar">
                          {shop.shopImageUrl ? (
                            <img src={shop.shopImageUrl} alt={shop.shopName} />
                          ) : (
                            <span>{shop.shopName.slice(0, 2).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="payout-shop-info">
                          <span className="payout-shop-name">{shop.shopName}</span>
                          <span className="payout-shop-owner">{shop.ownerEmail || shop.ownerFullName || 'No owner email'}</span>
                        </div>
                      </div>
                    </td>

                    <td>
                      {channel ? (
                        <span className={`payout-channel-pill ${channel.type}`}>
                          {channel.label}
                        </span>
                      ) : (
                        <span className="payout-channel-pill not-set">Not Configured</span>
                      )}
                    </td>

                    <td>
                      {shop.payoutAccountName ? (
                        <strong style={{ color: '#1e293b' }}>{shop.payoutAccountName}</strong>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>

                    <td>
                      {shop.payoutAccountNumber ? (
                        <div className="payout-acc-number">
                          <span>{shop.payoutAccountNumber}</span>
                          <button
                            type="button"
                            className="payout-copy-btn"
                            title="Copy account number"
                            onClick={() => handleCopyNumber(shop.id, shop.payoutAccountNumber!)}
                          >
                            {copiedId === shop.id ? (
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#16a34a" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>

                    <td>
                      {isVerified ? (
                        <div>
                          <span className="payout-status-badge verified">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Verified
                          </span>
                          {shop.payoutVerifiedAt && (
                            <span className="payout-status-date">
                              {new Date(shop.payoutVerifiedAt).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          )}
                        </div>
                      ) : hasChannel ? (
                        <span className="payout-status-badge pending">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                          Needs Review
                        </span>
                      ) : (
                        <span className="payout-status-badge unsubmitted">Not Set</span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <div className="payout-btn-group" style={{ justifyContent: 'flex-end' }}>
                        {!isVerified && hasChannel ? (
                          <button
                            type="button"
                            className="payout-btn verify"
                            onClick={() => handleOpenReview(shop)}
                            disabled={savingId === shop.id}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Verify Account
                          </button>
                        ) : isVerified ? (
                          <>
                            <button
                              type="button"
                              className="payout-btn edit"
                              onClick={() => handleOpenReview(shop)}
                              disabled={savingId === shop.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="payout-btn unverify"
                              onClick={() => handleUnverify(shop)}
                              disabled={savingId === shop.id}
                            >
                              Revoke
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="payout-btn edit"
                            onClick={() => handleOpenReview(shop)}
                            disabled={savingId === shop.id}
                          >
                            Configure
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Review / Verification Modal */}
      {modalShop && (
        <div className="payout-modal-overlay" onClick={handleCloseModal}>
          <div className="payout-modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="payout-modal-header">
              <h3>Verify Payout Account</h3>
              <button type="button" className="payout-modal-close" onClick={handleCloseModal} aria-label="Close modal">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="payout-modal-body">
              <div className="payout-modal-notice">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p>
                  <strong>Payout Rule:</strong> Once verified, <strong>70%</strong> of customer order
                  payments are routed to this account, and <strong>30%</strong> platform
                  commission is retained by LifeCycle.
                </p>
              </div>

              <div className="payout-modal-field">
                <label>Funeral Shop</label>
                <input type="text" value={modalShop.shopName} disabled style={{ background: '#f8fafc', fontWeight: 600 }} />
                <small>Owner: {modalShop.ownerEmail || modalShop.ownerFullName || 'Unknown'}</small>
              </div>

              <div className="payout-modal-field">
                <label htmlFor="payout-channel-select">Payout Channel (E-Wallet or Bank)</label>
                <select
                  id="payout-channel-select"
                  value={formChannel}
                  onChange={(e) => setFormChannel(e.target.value)}
                >
                  <optgroup label="E-Wallets">
                    {PAYOUT_CHANNELS.filter((c) => c.type === 'wallet').map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Supported Commercial Banks">
                    {PAYOUT_CHANNELS.filter((c) => c.type === 'bank').map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="payout-modal-field">
                <label htmlFor="payout-name-input">Registered Account Holder Name</label>
                <input
                  id="payout-name-input"
                  type="text"
                  placeholder="e.g. Juan Dela Cruz"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
                <small>Ensure the spelling strictly matches the official GCash or bank account name.</small>
              </div>

              <div className="payout-modal-field">
                <label htmlFor="payout-number-input">Account Number or Mobile Number</label>
                <input
                  id="payout-number-input"
                  type="text"
                  placeholder="e.g. 09171234567 or 1234567890"
                  value={formNumber}
                  onChange={(e) => setFormNumber(e.target.value)}
                />
                <small>For GCash and Maya, enter the 11-digit mobile number (e.g., 0917xxxxxxx).</small>
              </div>
            </div>

            <footer className="payout-modal-footer">
              <button type="button" className="operations-secondary-btn" onClick={handleCloseModal} disabled={isVerifying}>
                Cancel
              </button>
              <button
                type="button"
                className="payout-btn verify"
                style={{ padding: '8px 18px', fontSize: '12px' }}
                onClick={handleSaveAndVerify}
                disabled={isVerifying}
              >
                {isVerifying ? (
                  'Verifying…'
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Confirm &amp; Verify Account
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      )}

      {alertDialog}
      {confirmDialog}
    </div>
  )
}
