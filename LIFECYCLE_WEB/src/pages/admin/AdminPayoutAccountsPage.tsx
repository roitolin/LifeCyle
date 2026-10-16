import { useCallback, useEffect, useMemo, useState } from 'react'
import { PAYOUT_CHANNELS, getChannelInfo } from './adminPayoutChannels'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { logWebAdminActivity } from '@/utils/adminActivity'
import { createNotification } from '@/utils/supabaseNotifications'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'
import './AdminPaymentsPage.css'
import './AdminOperations.css'
import './AdminPayoutAccountsPage.css'

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
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')

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
    setFormNumber(shop.payoutAccountNumber || 'Not provided')
  }

  const handleCloseModal = () => {
    setModalShop(null)
    setIsVerifying(false)
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
    <section className="panel payments-panel payout-page-container">
      <header className="payments-header">
        <div className="payments-header-text">
          <h2>Shop Payout Accounts</h2>
          <p className="panel-sub">Review and verify the accounts partner shops use for their 70% order payout.</p>
        </div>
        <div className="payout-header-actions">
          <button type="button" className="ghost-btn" onClick={loadShops} disabled={loading}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="ghost-btn admin-export-btn" onClick={handleExportCsv} disabled={filteredShops.length === 0}>Export CSV</button>
        </div>
      </header>

      <div className="payments-submission-summary four-up" aria-label="Payout account summary">
        <article><span>Needs Review</span><strong>{pendingCount}</strong></article>
        <article><span>Verified</span><strong>{verifiedCount}</strong></article>
        <article><span>Not Submitted</span><strong>{missingCount}</strong></article>
        <article><span>Partner Shops</span><strong>{totalCount}</strong></article>
      </div>

      <div className="operations-toolbar payout-toolbar">
        <div className="operations-filter-tabs" role="tablist" aria-label="Payout account status">
          <button type="button" className={activeFilter === 'all' ? 'is-active' : ''} onClick={() => setActiveFilter('all')}>All <span>{totalCount}</span></button>
          <button type="button" className={activeFilter === 'pending' ? 'is-active' : ''} onClick={() => setActiveFilter('pending')}>Needs Review <span>{pendingCount}</span></button>
          <button type="button" className={activeFilter === 'verified' ? 'is-active' : ''} onClick={() => setActiveFilter('verified')}>Verified <span>{verifiedCount}</span></button>
          <button type="button" className={activeFilter === 'missing' ? 'is-active' : ''} onClick={() => setActiveFilter('missing')}>Not Submitted <span>{missingCount}</span></button>
        </div>
        <label className="operations-search"><span className="sr-only">Search payout accounts</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search shop or account" /></label>
      </div>

      {loading ? <p className="panel-sub payments-loading">Loading payout accounts...</p> : null}
      {!loading && filteredShops.length === 0 ? <div className="payout-empty"><h3>No payout accounts found</h3><p>{activeFilter === 'pending' ? 'Every submitted payout account has been reviewed.' : 'No shops match this view.'}</p></div> : null}

      {!loading && filteredShops.length > 0 ? (
        <div className="table-wrap">
          <table className="request-table">
            <thead><tr><th>Funeral Shop</th><th>Payout Account</th><th>Account Number</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filteredShops.map((shop) => {
                const channel = getChannelInfo(shop.payoutChannelCode)
                const hasAccount = Boolean(shop.payoutChannelCode)
                return (
                  <tr key={shop.id}>
                    <td><div className="payout-shop-cell"><div className="payout-shop-avatar">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" /> : <span>{shop.shopName.slice(0, 2).toUpperCase()}</span>}</div><div><span className="payout-primary">{shop.shopName}</span><span className="payout-secondary">{shop.ownerEmail || shop.ownerFullName || 'Owner details unavailable'}</span></div></div></td>
                    <td>{channel ? <div className="payout-account-cell"><span className={`payout-channel-mark ${channel.type}`}>{channel.shortName.slice(0, 2).toUpperCase()}</span><div><span className="payout-primary">{channel.shortName}</span><span className="payout-secondary">{shop.payoutAccountName || 'Account name not provided'}</span></div></div> : <span className="row-muted">Not submitted</span>}</td>
                    <td><span className="payout-account-number">{shop.payoutAccountNumber || 'Not provided'}</span></td>
                    <td>{shop.payoutVerifiedByAdmin ? <div><span className="payout-status verified">Verified</span>{shop.payoutVerifiedAt ? <div className="payout-verified-date">{new Date(shop.payoutVerifiedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</div> : null}</div> : hasAccount ? <span className="payout-status pending">Needs review</span> : <span className="payout-status">Not submitted</span>}</td>
                    <td><div className="payout-row-actions"><button type="button" className="ghost-btn table-action" onClick={() => handleOpenReview(shop)} disabled={savingId === shop.id}>{shop.payoutVerifiedByAdmin ? 'Edit' : hasAccount ? 'Review' : 'Configure'}</button>{shop.payoutVerifiedByAdmin ? <button type="button" className="ghost-btn table-action payout-danger-action" onClick={() => handleUnverify(shop)} disabled={savingId === shop.id}>Revoke</button> : null}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalShop ? (
        <div className="payments-modal-overlay" role="presentation" onClick={handleCloseModal}>
          <div className="payments-modal" role="dialog" aria-modal="true" aria-labelledby="payout-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="payments-modal-header"><div className="payments-modal-heading"><h3 id="payout-modal-title">{modalShop.payoutVerifiedByAdmin ? 'Edit Payout Account' : 'Review Payout Account'}</h3><p>Confirm the account details before enabling direct payouts.</p></div><button type="button" className="payments-modal-close" aria-label="Close" onClick={handleCloseModal}>X</button></div>
            <div className="payments-modal-body payout-modal-form">
              <div className="payout-modal-summary"><strong>{modalShop.shopName}</strong><span>{modalShop.ownerEmail || modalShop.ownerFullName || 'Owner details unavailable'}</span></div>
              <div className="payout-modal-field"><label htmlFor="payout-channel-select">Payout channel</label><select id="payout-channel-select" value={formChannel} onChange={(event) => setFormChannel(event.target.value)}><optgroup label="E-wallets">{PAYOUT_CHANNELS.filter((channel) => channel.type === 'wallet').map((channel) => <option key={channel.code} value={channel.code}>{channel.label}</option>)}</optgroup><optgroup label="Banks">{PAYOUT_CHANNELS.filter((channel) => channel.type === 'bank').map((channel) => <option key={channel.code} value={channel.code}>{channel.label}</option>)}</optgroup></select></div>
              <div className="payout-modal-field"><label htmlFor="payout-name-input">Account holder name</label><input id="payout-name-input" type="text" value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="Name registered on the account" /></div>
              <div className="payout-modal-field"><label htmlFor="payout-number-input">Account or mobile number</label><input id="payout-number-input" type="text" value={formNumber} onChange={(event) => setFormNumber(event.target.value)} placeholder="Account number or 11-digit mobile number" /><small>Use the mobile number registered with GCash or Maya.</small></div>
            </div>
            <div className="payments-modal-footer"><button type="button" className="ghost-btn" onClick={handleCloseModal} disabled={isVerifying}>Cancel</button><button type="button" className="solid-btn" onClick={handleSaveAndVerify} disabled={isVerifying}>{isVerifying ? 'Saving...' : modalShop.payoutVerifiedByAdmin ? 'Save Changes' : 'Verify Account'}</button></div>
          </div>
        </div>
      ) : null}
      {alertDialog}
      {confirmDialog}
    </section>
  )
}
