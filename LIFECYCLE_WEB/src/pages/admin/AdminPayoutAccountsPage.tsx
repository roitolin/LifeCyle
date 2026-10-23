import { useCallback, useEffect, useMemo, useState } from 'react'
import { PAYOUT_CHANNELS, getChannelInfo } from './adminPayoutChannels'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { logWebAdminActivity } from '@/utils/adminActivity'
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

type FilterTab = 'attention' | 'ready' | 'missing' | 'all'

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
  const [isSaving, setIsSaving] = useState(false)

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
  const attentionCount = useMemo(
    () => shops.filter((s) => !s.payoutVerifiedByAdmin && Boolean(s.payoutChannelCode)).length,
    [shops],
  )
  const readyCount = useMemo(
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
      if (activeFilter === 'attention') {
        if (s.payoutVerifiedByAdmin || !s.payoutChannelCode) return false
      } else if (activeFilter === 'ready') {
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
  const handleOpenManage = (shop: ShopPayoutRecord) => {
    setModalShop(shop)
    setFormChannel(shop.payoutChannelCode || 'PH_GCASH')
    setFormName(shop.payoutAccountName || '')
    setFormNumber(shop.payoutAccountNumber || '')
  }

  const handleCloseModal = () => {
    setModalShop(null)
    setIsSaving(false)
  }


  const handleSave = async () => {
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

    setIsSaving(true)
    try {
      // The server updates both the legacy shop fields and the per-channel
      // receiver row that customer checkout actually reads.
      const { data, error: fnErr } = await supabase.functions.invoke('provision-xendit-shop', {
        body: {
          shopId: modalShop.id,
          action: 'save',
          payoutChannelCode: channel,
          payoutAccountName: name,
          payoutAccountNumber: number,
        },
      })
      if (fnErr) {
        let errorMsg = fnErr.message || 'Unable to save payout account.'
        const context = (fnErr as { context?: Response } | null)?.context
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json()
            if (typeof body?.error === 'string') errorMsg = body.error
          } catch {
            // Keep the safe fallback message.
          }
        }
        throw new Error(errorMsg)
      }
      if (!data || data.shopId !== modalShop.id || data.payoutVerified !== true) {
        throw new Error('The payout account could not be activated.')
      }

      // Log admin activity
      const channelObj = getChannelInfo(channel)
      void logWebAdminActivity({
        action: 'payout_account_updated',
        targetType: 'funeral_shop',
        targetId: modalShop.id,
        summary: `Updated payout account for ${modalShop.shopName} (${channelObj?.label || channel}: ${number}).`,
        metadata: {
          shopId: modalShop.id,
          payoutChannelCode: channel,
          payoutAccountName: name,
        },
      })

      handleCloseModal()
      await loadShops()

      openAlert({
        title: 'Payout Account Saved',
        message: `${modalShop.shopName} can now receive direct payouts through this active account.`,
        tone: 'info',
      })
    } catch (err: any) {
      openAlert({
        title: 'Save Failed',
        message: err?.message || 'Unable to save payout account. Please try again.',
        tone: 'danger',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDisable = (shop: ShopPayoutRecord) => {
    openConfirm({
      title: 'Disable All Payout Methods?',
      message: `Are you sure you want to disable every customer payment method for ${shop.shopName}?`,
      details: [
        'Customers will not see these methods until the shop enables one again.',
        'Existing orders will not be affected.',
      ],
      tone: 'danger',
      confirmLabel: 'Disable Methods',
      onConfirm: async () => {
        setSavingId(shop.id)
        try {
          const { data, error } = await supabase.functions.invoke('provision-xendit-shop', {
            body: { shopId: shop.id, action: 'disable-all' },
          })
          if (error) throw error
          if (!data || data.shopId !== shop.id || data.disabled !== true) {
            throw new Error('The payout methods could not be disabled.')
          }

          void logWebAdminActivity({
            action: 'payout_accounts_disabled',
            targetType: 'funeral_shop',
            targetId: shop.id,
            summary: `Disabled all payout methods for ${shop.shopName}.`,
            metadata: { shopId: shop.id },
          })

          if (modalShop) handleCloseModal()
          await loadShops()
        } catch (err: any) {
          openAlert({
            title: 'Action Failed',
            message: err?.message || 'Unable to disable the payout methods.',
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
      { header: 'Checkout Ready', value: (row) => (row.payoutVerifiedByAdmin ? 'YES' : 'NO') },
      { header: 'Ready At', value: (row) => csvTimestamp(row.payoutVerifiedAt) },
    ])
    downloadCsv(`shop-payout-accounts-${dateStamp()}.csv`, csv)
  }

  return (
    <section className="panel payments-panel payout-page-container">
      <header className="payments-header">
        <div className="payments-header-text">
          <h2>Shop Payout Accounts</h2>
          <p className="panel-sub">View and manage the accounts partner shops use for their 70% order payout.</p>
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
        <article><span>Needs Attention</span><strong>{attentionCount}</strong></article>
        <article><span>Ready</span><strong>{readyCount}</strong></article>
        <article><span>Not Submitted</span><strong>{missingCount}</strong></article>
        <article><span>Partner Shops</span><strong>{totalCount}</strong></article>
      </div>

      <div className="operations-toolbar payout-toolbar">
        <div className="operations-filter-tabs" role="tablist" aria-label="Payout account status">
          <button type="button" className={activeFilter === 'all' ? 'is-active' : ''} onClick={() => setActiveFilter('all')}>All <span>{totalCount}</span></button>
          <button type="button" className={activeFilter === 'attention' ? 'is-active' : ''} onClick={() => setActiveFilter('attention')}>Needs Attention <span>{attentionCount}</span></button>
          <button type="button" className={activeFilter === 'ready' ? 'is-active' : ''} onClick={() => setActiveFilter('ready')}>Ready <span>{readyCount}</span></button>
          <button type="button" className={activeFilter === 'missing' ? 'is-active' : ''} onClick={() => setActiveFilter('missing')}>Not Submitted <span>{missingCount}</span></button>
        </div>
        <label className="operations-search"><span className="sr-only">Search payout accounts</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search shop or account" /></label>
      </div>

      {loading ? <p className="panel-sub payments-loading">Loading payout accounts...</p> : null}
      {!loading && filteredShops.length === 0 ? <div className="payout-empty"><h3>No payout accounts found</h3><p>{activeFilter === 'attention' ? 'Every submitted payout account is ready.' : 'No shops match this view.'}</p></div> : null}

      {!loading && filteredShops.length > 0 ? (
        <div className="table-wrap">
          <table className="request-table admin-responsive-table">
            <thead><tr><th>Funeral Shop</th><th>Payout Account</th><th>Account Number</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filteredShops.map((shop) => {
                const channel = getChannelInfo(shop.payoutChannelCode)
                const hasAccount = Boolean(shop.payoutChannelCode)
                return (
                  <tr key={shop.id}>
                    <td data-label="Funeral Shop"><div className="payout-shop-cell"><div className="payout-shop-avatar">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" /> : <span>{shop.shopName.slice(0, 2).toUpperCase()}</span>}</div><div><span className="payout-primary">{shop.shopName}</span><span className="payout-secondary">{shop.ownerEmail || shop.ownerFullName || 'Owner details unavailable'}</span></div></div></td>
                    <td data-label="Payout Account">{channel ? <div className="payout-account-cell"><span className={`payout-channel-mark ${channel.type}`}><img className={channel.code === 'PH_MAYA' ? 'is-maya' : undefined} src={channel.logoUrl} alt={`${channel.shortName} logo`} /></span><div><span className="payout-primary">{channel.shortName}</span><span className="payout-secondary">{shop.payoutAccountName || 'Account name not provided'}</span></div></div> : <span className="row-muted">Not submitted</span>}</td>
                    <td data-label="Account Number"><span className="payout-account-number">{shop.payoutAccountNumber || 'Not provided'}</span></td>
                    <td data-label="Status">{shop.payoutVerifiedByAdmin ? <div><span className="payout-status verified">Ready</span>{shop.payoutVerifiedAt ? <div className="payout-verified-date">{new Date(shop.payoutVerifiedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</div> : null}</div> : hasAccount ? <span className="payout-status pending">Needs attention</span> : <span className="payout-status">Not submitted</span>}</td>
                    <td data-label="Actions"><div className="payout-row-actions"><button type="button" className="ghost-btn table-action" onClick={() => handleOpenManage(shop)} disabled={savingId === shop.id}>{shop.payoutVerifiedByAdmin ? 'Edit' : 'Configure'}</button>{shop.payoutVerifiedByAdmin ? <button type="button" className="ghost-btn table-action payout-danger-action" onClick={() => handleDisable(shop)} disabled={savingId === shop.id}>Disable</button> : null}</div></td>
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
            <div className="payments-modal-header"><div className="payments-modal-heading"><h3 id="payout-modal-title">{modalShop.payoutVerifiedByAdmin ? 'Edit Payout Account' : 'Configure Payout Account'}</h3><p>Saving valid details makes the account available immediately for an approved shop.</p></div><button type="button" className="payments-modal-close" aria-label="Close" onClick={handleCloseModal}>X</button></div>
            <div className="payments-modal-body payout-modal-form">
              <div className="payout-modal-summary"><strong>{modalShop.shopName}</strong><span>{modalShop.ownerEmail || modalShop.ownerFullName || 'Owner details unavailable'}</span></div>
              <div className="payout-modal-field"><label htmlFor="payout-channel-select">Payout channel</label><select id="payout-channel-select" value={formChannel} onChange={(event) => setFormChannel(event.target.value)}><optgroup label="E-wallets">{PAYOUT_CHANNELS.filter((channel) => channel.type === 'wallet').map((channel) => <option key={channel.code} value={channel.code}>{channel.label}</option>)}</optgroup><optgroup label="Banks">{PAYOUT_CHANNELS.filter((channel) => channel.type === 'bank').map((channel) => <option key={channel.code} value={channel.code}>{channel.label}</option>)}</optgroup></select></div>
              <div className="payout-modal-field"><label htmlFor="payout-name-input">Account holder name</label><input id="payout-name-input" type="text" value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="Name registered on the account" /></div>
              <div className="payout-modal-field"><label htmlFor="payout-number-input">Account or mobile number</label><input id="payout-number-input" type="text" value={formNumber} onChange={(event) => setFormNumber(event.target.value)} placeholder="Account number or 11-digit mobile number" /><small>Use the mobile number registered with GCash or Maya.</small></div>
            </div>
            <div className="payments-modal-footer"><button type="button" className="ghost-btn" onClick={handleCloseModal} disabled={isSaving}>Cancel</button><button type="button" className="solid-btn" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Account'}</button></div>
          </div>
        </div>
      ) : null}
      {alertDialog}
      {confirmDialog}
    </section>
  )
}
