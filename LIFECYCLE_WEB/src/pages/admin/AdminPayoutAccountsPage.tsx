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

type PayoutReceiver = {
  id: string
  shopId: string
  channelCode: string
  accountName: string
  accountNumber: string
  active: boolean
  verifiedByAdmin: boolean
  verifiedAt: string | null
}

type FilterTab = 'attention' | 'ready' | 'disabled' | 'missing' | 'all'
type PayoutRow = { shop: ShopPayoutRecord; receiver: PayoutReceiver | null }

function receiverStatus(receiver: PayoutReceiver | null): Exclude<FilterTab, 'all'> {
  if (!receiver) return 'missing'
  if (!receiver.verifiedByAdmin) return 'attention'
  return receiver.active ? 'ready' : 'disabled'
}

export default function AdminPayoutAccountsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const [shops, setShops] = useState<ShopPayoutRecord[]>([])
  const [receivers, setReceivers] = useState<PayoutReceiver[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal State
  const [modalShop, setModalShop] = useState<ShopPayoutRecord | null>(null)
  const [formChannel, setFormChannel] = useState('')
  const [formName, setFormName] = useState('')
  const [formNumber, setFormNumber] = useState('')
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null)
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
        .order('shopName', { ascending: true })

      if (error) throw error

      const { data: receiverData, error: receiverError } = await supabase.functions.invoke('provision-xendit-shop', {
        body: { action: 'list-all' },
      })
      if (receiverError) throw receiverError
      setReceivers((receiverData?.accounts || []) as PayoutReceiver[])

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

  const rows = useMemo<PayoutRow[]>(() => {
    const byShop = new Map<string, PayoutReceiver[]>()
    receivers.forEach((receiver) => {
      const accounts = byShop.get(receiver.shopId) || []
      accounts.push(receiver)
      byShop.set(receiver.shopId, accounts)
    })
    return shops.flatMap<PayoutRow>((shop) => {
      const accounts = byShop.get(shop.id) || []
      return accounts.length ? accounts.map((receiver) => ({ shop, receiver })) : [{ shop, receiver: null }]
    })
  }, [shops, receivers])
  const attentionCount = rows.filter((row) => receiverStatus(row.receiver) === 'attention').length
  const readyCount = rows.filter((row) => receiverStatus(row.receiver) === 'ready').length
  const disabledCount = rows.filter((row) => receiverStatus(row.receiver) === 'disabled').length
  const missingCount = rows.filter((row) => receiverStatus(row.receiver) === 'missing').length
  const totalCount = rows.length
  const selectedReceiver = receivers.find((account) => account.id === selectedReceiverId)

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter(({ shop, receiver }) => {
      if (activeFilter !== 'all' && receiverStatus(receiver) !== activeFilter) return false
      if (shopFilter !== 'all' && shop.id !== shopFilter) return false
      if (channelFilter !== 'all' && receiver?.channelCode !== channelFilter) return false
      if (!q) return true
      const channelObj = getChannelInfo(receiver?.channelCode)
      return (
        shop.shopName.toLowerCase().includes(q) ||
        shop.ownerEmail.toLowerCase().includes(q) ||
        shop.ownerFullName.toLowerCase().includes(q) ||
        receiver?.accountName.toLowerCase().includes(q) ||
        receiver?.accountNumber.toLowerCase().includes(q) ||
        (channelObj && channelObj.label.toLowerCase().includes(q))
      )
    })
  }, [rows, activeFilter, shopFilter, channelFilter, searchQuery])

  const handleOpenManage = (shop: ShopPayoutRecord, account: PayoutReceiver | null) => {
    setModalShop(shop)
    setSelectedReceiverId(account?.id || null)
    setFormChannel(account?.channelCode || '')
    setFormName(account?.accountName || '')
    setFormNumber(account?.accountNumber || '')
  }

  const handleCloseModal = () => {
    setModalShop(null)
    setIsSaving(false)
  }


  const handleSave = async () => {
    if (!modalShop || !selectedReceiver || selectedReceiver.verifiedByAdmin) return

    setIsSaving(true)
    try {
      // The server updates both the legacy shop fields and the per-channel
      // receiver row that customer checkout actually reads.
      const { data, error: fnErr } = await supabase.functions.invoke('provision-xendit-shop', {
        body: {
          shopId: modalShop.id,
          action: 'save',
          payoutAccountId: selectedReceiver.id,
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
      const channelObj = getChannelInfo(selectedReceiver.channelCode)
      void logWebAdminActivity({
        action: 'payout_receiver_approved',
        targetType: 'funeral_shop',
        targetId: modalShop.id,
        summary: `Approved payout receiver for ${modalShop.shopName} (${channelObj?.label || selectedReceiver.channelCode}).`,
        metadata: {
          shopId: modalShop.id,
          payoutChannelCode: selectedReceiver.channelCode,
        },
      })

      handleCloseModal()
      await loadShops()

      openAlert({
        title: 'Payout Account Saved',
        message: `${modalShop.shopName}'s ${channelObj?.shortName || selectedReceiver.channelCode} receiver is approved for checkout.`,
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

  const handleDisable = (shop: ShopPayoutRecord, receiver: PayoutReceiver) => {
    const channelName = getChannelInfo(receiver.channelCode)?.shortName || receiver.channelCode
    openConfirm({
      title: 'Disable Payout Account?',
      message: `Disable ${shop.shopName}'s ${channelName} receiver?`,
      details: [
        'Customers will not see this method until the shop enables it again.',
        'Existing orders will not be affected.',
      ],
      tone: 'danger',
      confirmLabel: 'Disable Account',
      onConfirm: async () => {
        setSavingId(receiver.id)
        try {
          const { data, error } = await supabase.functions.invoke('provision-xendit-shop', {
            body: { shopId: shop.id, action: 'set-active', payoutChannelCode: receiver.channelCode, active: false },
          })
          if (error) throw error
          if (!data || data.shopId !== shop.id || data.channelCode !== receiver.channelCode || data.active !== false) {
            throw new Error('The payout account could not be disabled.')
          }

          void logWebAdminActivity({
            action: 'payout_account_disabled',
            targetType: 'funeral_shop',
            targetId: shop.id,
            summary: `Disabled ${channelName} payout receiver for ${shop.shopName}.`,
            metadata: { shopId: shop.id, payoutChannelCode: receiver.channelCode },
          })

          if (modalShop) handleCloseModal()
          await loadShops()
        } catch (err: any) {
          openAlert({
            title: 'Action Failed',
            message: err?.message || 'Unable to disable the payout account.',
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
    const csv = buildCsv(filteredRows, [
      { header: 'Shop ID', value: (row) => row.shop.id },
      { header: 'Shop Name', value: (row) => row.shop.shopName },
      { header: 'Owner Email', value: (row) => row.shop.ownerEmail },
      { header: 'Owner Name', value: (row) => row.shop.ownerFullName },
      { header: 'Shop Status', value: (row) => row.shop.status },
      {
        header: 'Payout Channel',
        value: (row) => getChannelInfo(row.receiver?.channelCode)?.label || row.receiver?.channelCode || 'Not submitted',
      },
      { header: 'Account Name', value: (row) => row.receiver?.accountName || 'Not submitted' },
      { header: 'Account Number', value: (row) => row.receiver?.accountNumber || 'Not submitted' },
      { header: 'Status', value: (row) => receiverStatus(row.receiver) },
      { header: 'Approved At', value: (row) => csvTimestamp(row.receiver?.verifiedAt) },
    ])
    downloadCsv(`shop-payout-accounts-${dateStamp()}.csv`, csv)
  }

  return (
    <section className="panel payments-panel payout-page-container">
      <header className="payments-header">
        <div className="payments-header-text">
          <h2>Shop Payout Accounts</h2>
          <p className="panel-sub">Review each bank and wallet account submitted by partner shops.</p>
        </div>
        <div className="payout-header-actions">
          <button type="button" className="ghost-btn" onClick={loadShops} disabled={loading}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button type="button" className="ghost-btn admin-export-btn" onClick={handleExportCsv} disabled={filteredRows.length === 0}>Export CSV</button>
        </div>
      </header>

      <div className="payments-submission-summary four-up" aria-label="Payout account summary">
        <article><span>Needs Review</span><strong>{attentionCount}</strong></article>
        <article><span>Ready</span><strong>{readyCount}</strong></article>
        <article><span>Disabled</span><strong>{disabledCount}</strong></article>
        <article><span>Not Submitted</span><strong>{missingCount}</strong></article>
      </div>

      <div className="operations-toolbar payout-toolbar">
        <div className="operations-filter-tabs" role="group" aria-label="Payout account status">
          <button type="button" aria-pressed={activeFilter === 'all'} className={activeFilter === 'all' ? 'is-active' : ''} onClick={() => setActiveFilter('all')}>All <span>{totalCount}</span></button>
          <button type="button" aria-pressed={activeFilter === 'attention'} className={activeFilter === 'attention' ? 'is-active' : ''} onClick={() => setActiveFilter('attention')}>Needs Review <span>{attentionCount}</span></button>
          <button type="button" aria-pressed={activeFilter === 'ready'} className={activeFilter === 'ready' ? 'is-active' : ''} onClick={() => setActiveFilter('ready')}>Ready <span>{readyCount}</span></button>
          <button type="button" aria-pressed={activeFilter === 'disabled'} className={activeFilter === 'disabled' ? 'is-active' : ''} onClick={() => setActiveFilter('disabled')}>Disabled <span>{disabledCount}</span></button>
          <button type="button" aria-pressed={activeFilter === 'missing'} className={activeFilter === 'missing' ? 'is-active' : ''} onClick={() => setActiveFilter('missing')}>Not Submitted <span>{missingCount}</span></button>
        </div>
        <div className="payout-filter-fields">
          <label><span className="sr-only">Filter by shop</span><select value={shopFilter} onChange={(event) => setShopFilter(event.target.value)}><option value="all">All shops</option>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.shopName}</option>)}</select></label>
          <label><span className="sr-only">Filter by payout channel</span><select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="all">All channels</option>{PAYOUT_CHANNELS.map((channel) => <option key={channel.code} value={channel.code}>{channel.shortName}</option>)}</select></label>
          <label className="operations-search"><span className="sr-only">Search payout accounts</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search shop or account" /></label>
        </div>
      </div>

      {loading ? <p className="panel-sub payments-loading">Loading payout accounts...</p> : null}
      {!loading && filteredRows.length === 0 ? <div className="payout-empty"><h3>No payout accounts found</h3><p>No accounts match these filters.</p></div> : null}

      {!loading && filteredRows.length > 0 ? (
        <div className="table-wrap payout-table-wrap">
          <table className="request-table admin-responsive-table">
            <thead><tr><th>Funeral Shop</th><th>Payout Account</th><th>Account Number</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {filteredRows.map(({ shop, receiver }) => {
                const channel = getChannelInfo(receiver?.channelCode)
                const status = receiverStatus(receiver)
                return (
                  <tr key={receiver?.id || `missing-${shop.id}`}>
                    <td data-label="Funeral Shop"><div className="payout-shop-cell"><div className="payout-shop-avatar">{shop.shopImageUrl ? <img src={shop.shopImageUrl} alt="" /> : <span>{shop.shopName.slice(0, 2).toUpperCase()}</span>}</div><div><span className="payout-primary">{shop.shopName}</span><span className="payout-secondary">{shop.ownerEmail || shop.ownerFullName || 'Owner details unavailable'}</span></div></div></td>
                    <td data-label="Payout Account">{receiver ? <div className="payout-account-cell">{channel ? <span className={`payout-channel-mark ${channel.type}`}><img className={channel.code === 'PH_MAYA' ? 'is-maya' : undefined} src={channel.logoUrl} alt="" /></span> : null}<div><span className="payout-primary">{channel?.shortName || receiver.channelCode}</span><span className="payout-secondary">{receiver.accountName}</span></div></div> : <span className="row-muted">Not submitted</span>}</td>
                    <td data-label="Account Number"><span className="payout-account-number">{receiver?.accountNumber || 'Not provided'}</span></td>
                    <td data-label="Status"><span className={`payout-status ${status === 'ready' ? 'verified' : status === 'attention' ? 'pending' : ''}`}>{status === 'attention' ? 'Needs review' : status === 'ready' ? 'Ready' : status === 'disabled' ? 'Disabled' : 'Not submitted'}</span>{receiver?.verifiedAt ? <div className="payout-verified-date">Approved {new Date(receiver.verifiedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</div> : null}</td>
                    <td data-label="Actions"><div className="payout-row-actions"><button type="button" className="ghost-btn table-action" onClick={() => handleOpenManage(shop, receiver)} disabled={savingId === receiver?.id}>{status === 'attention' ? 'Review' : 'View'}</button>{receiver && status === 'ready' ? <button type="button" className="ghost-btn table-action payout-danger-action" onClick={() => handleDisable(shop, receiver)} disabled={savingId === receiver.id}>Disable</button> : null}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalShop ? (
        <div className="payments-modal-overlay" role="presentation" onClick={handleCloseModal}>
          <div className="payments-modal payout-review-modal" role="dialog" aria-modal="true" aria-labelledby="payout-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="payments-modal-header"><div className="payments-modal-heading"><h3 id="payout-modal-title">Payout Account Review</h3><p>Check the account submitted by this shop before approval.</p></div><button type="button" className="payments-modal-close" aria-label="Close" onClick={handleCloseModal}>X</button></div>
            <div className="payments-modal-body payout-modal-form">
              <div className="payout-modal-summary"><strong>{modalShop.shopName}</strong><span>{modalShop.ownerEmail || modalShop.ownerFullName || 'Owner details unavailable'}</span></div>
              {!selectedReceiver && <p className="panel-sub">This shop has not submitted a payout account.</p>}
              {selectedReceiver && <>
                <span className={`payout-status ${receiverStatus(selectedReceiver) === 'ready' ? 'verified' : receiverStatus(selectedReceiver) === 'attention' ? 'pending' : ''}`}>{receiverStatus(selectedReceiver) === 'attention' ? 'Needs review' : receiverStatus(selectedReceiver) === 'ready' ? 'Ready' : 'Disabled'}</span>
                <div className="payout-modal-field"><label htmlFor="payout-channel-input">Payout destination</label><input id="payout-channel-input" type="text" value={getChannelInfo(formChannel)?.label || formChannel} readOnly /></div>
                <div className="payout-modal-field"><label htmlFor="payout-name-input">Account holder name</label><input id="payout-name-input" type="text" value={formName} readOnly /></div>
                <div className="payout-modal-field"><label htmlFor="payout-number-input">Account or mobile number</label><input id="payout-number-input" type="text" value={formNumber} readOnly /><small>Ask the owner to correct any details that do not match their registered account.</small></div>
              </>}
            </div>
            <div className="payments-modal-footer"><button type="button" className="ghost-btn" onClick={handleCloseModal} disabled={isSaving}>Close</button>{selectedReceiver && !selectedReceiver.verifiedByAdmin ? <button type="button" className="solid-btn" onClick={handleSave} disabled={isSaving}>{isSaving ? 'Approving...' : 'Approve Account'}</button> : null}</div>
          </div>
        </div>
      ) : null}
      {alertDialog}
      {confirmDialog}
    </section>
  )
}
