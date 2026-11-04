import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import {
  approveShopCashBalancePayment, balanceChannelLabel, canPayRemainingBalance, getBalanceReceiptUrl,
  loadBalancePayments, reviewBalancePayment, submitBalancePayment, submitOnlineBalancePayment, syncOnlineBalancePayment,
  type BalancePayment, type BalanceReceiver, type BalanceRequest,
} from '@/utils/remainingBalancePayments'
import './ServiceXenditModal.css'
import './RemainingBalancePaymentCard.css'

type Props = { request: BalanceRequest; role?: 'customer' | 'shop' }

const SUBMITTED_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  wallet: 'Online · E-wallet',
  bank: 'Online · Bank transfer',
}

const peso = (value: number | string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value))
const message = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.'
const timestamp = (value: string) => new Date(value).toLocaleString('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export default function RemainingBalancePaymentCard(props: Props) {
  return canPayRemainingBalance(props.request) ? <BalancePanel key={props.request.id} {...props} /> : null
}

function BalancePanel({ request, role = 'customer' }: Props) {
  const headingId = useId()
  const [payments, setPayments] = useState<BalancePayment[]>([])
  const [receivers, setReceivers] = useState<BalanceReceiver[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [onlineModalOpen, setOnlineModalOpen] = useState(false)
  const [receiverId, setReceiverId] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const checkoutOpenedRef = useRef(false)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [viewerUrl, setViewerUrl] = useState('')
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [openingReceipt, setOpeningReceipt] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const { id: requestId, shopId } = request
  const checkoutStorageKey = `lifecycle-balance-checkout:${requestId}`

  useEffect(() => {
    let active = true
    let sequence = 0
    const load = async () => {
      if (busyRef.current) return
      const version = ++sequence
      setLoading(true)
      setLoadError('')
      try {
        const data = await loadBalancePayments({ id: requestId, shopId })
        if (active && sequence === version) { setPayments(data.payments); setReceivers(data.receivers) }
      } catch (error) { if (active && sequence === version) setLoadError(message(error)) }
      finally { if (active && sequence === version) setLoading(false) }
    }
    const synchronizeAfterCheckout = async () => {
      const checkoutWasOpened = checkoutOpenedRef.current
        || window.sessionStorage.getItem(checkoutStorageKey) === '1'
      if (!checkoutWasOpened) {
        await load()
        return
      }

      checkoutOpenedRef.current = false
      window.sessionStorage.removeItem(checkoutStorageKey)
      try {
        await syncOnlineBalancePayment(requestId)
      } catch (error) {
        console.warn('Unable to sync remaining balance checkout:', error)
      }
      await load()
    }
    const onFocus = () => { if (!document.hidden) void synchronizeAfterCheckout() }
    void synchronizeAfterCheckout()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [checkoutStorageKey, requestId, shopId, refreshKey])

  useEffect(() => {
    const dialog = dialogRef.current
    if ((viewerUrl || receiptOpen) && dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [viewerUrl, receiptOpen])

  const current = payments.find(payment => payment.status !== 'rejected')
  const latestRejection = !current ? payments[0] : undefined
  const paid = current?.status === 'verified'
  const providerBacked = Boolean(current?.provider_reference_id)
  const isShop = role === 'shop'
  const downpaymentAmount = Number(request.downpaymentAmountSnapshot ?? request.paymentAmount) || 0
  const remainingBalanceAmount = Number(request.remainingBalance) || 0
  const totalOrderAmount = Number(request.productFullPrice ?? request.productPrice) || (downpaymentAmount + remainingBalanceAmount)

  const formatPaymentType = (payment: BalancePayment) => {
    if (payment.method === 'cash') return 'Cash'
    if (payment.provider_reference_id) {
      return `Online · ${balanceChannelLabel(payment.provider_payment_method || payment.receiver_channel || '')}`
    }
    const base = SUBMITTED_METHOD_LABELS[payment.method] || payment.method
    return payment.receiver_channel ? `${base} (${balanceChannelLabel(payment.receiver_channel)})` : base
  }

  const activityEvents = useMemo(() => {
    const events: { key: string; label: string; value: string }[] = []
    const chronological = [...payments].reverse()
    chronological.forEach(payment => {
      const paymentTypeLabel = formatPaymentType(payment)
      const amountNum = Number(payment.amount) || 0
      events.push({
        key: `${payment.id}-submitted`,
        label: `Remaining balance submitted · ${paymentTypeLabel}`,
        value: `Amount: ${peso(amountNum)} · ${timestamp(payment.submitted_at)}`,
      })
      if (payment.status === 'verified' && payment.reviewed_at) {
        const cumulativeTotal = downpaymentAmount + amountNum
        events.push({
          key: `${payment.id}-verified`,
          label: `Balance payment approved · ${paymentTypeLabel}`,
          value: `Shop received ${peso(amountNum)} · Total received: ${peso(cumulativeTotal)} of ${peso(totalOrderAmount)} · ${timestamp(payment.reviewed_at)}`,
        })
      } else if (payment.status === 'rejected' && payment.reviewed_at) {
        events.push({
          key: `${payment.id}-rejected`,
          label: `Remaining balance rejected (${paymentTypeLabel})${payment.rejection_reason ? `: ${payment.rejection_reason}` : ''}`,
          value: timestamp(payment.reviewed_at),
        })
      }
    })
    return events
  }, [payments, downpaymentAmount, totalOrderAmount])

  const selectedReceiver = receivers.find(account => account.id === receiverId) || (receivers.length > 0 ? receivers[0] : undefined)

  const openOnlineModal = () => {
    if (!receiverId && receivers.length > 0) {
      setReceiverId(receivers[0].id)
    }
    setActionError('')
    setOnlineModalOpen(true)
  }

  const closeOnlineModal = () => {
    if (busyRef.current) return
    setOnlineModalOpen(false)
    setActionError('')
  }

  const openCheckout = (checkoutUrl: string, checkoutWindow: Window | null) => {
    checkoutOpenedRef.current = true
    window.sessionStorage.setItem(checkoutStorageKey, '1')
    if (checkoutWindow) {
      checkoutWindow.opener = null
      checkoutWindow.location.replace(checkoutUrl)
      return
    }
    window.location.assign(checkoutUrl)
  }

  const openReceipt = async (path?: string | null, showSummary = true) => {
    if (openingReceipt) return
    setActionError('')
    if (path) {
      setOpeningReceipt(true)
      try {
        setViewerUrl(await getBalanceReceiptUrl(path))
        setReceiptOpen(showSummary)
      } catch (error) {
        setActionError(message(error))
      } finally {
        setOpeningReceipt(false)
      }
    } else {
      setViewerUrl('')
      setReceiptOpen(true)
    }
  }

  const submitCash = async () => {
    if (busyRef.current || current) return
    busyRef.current = true; setBusy(true); setActionError('')
    try {
      const saved = await submitBalancePayment({ requestId, method: 'cash' })
      setPayments(previous => [saved, ...previous])
    } catch (error) { setActionError(message(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const submitOnline = async () => {
    if (receivers.length === 0 || busyRef.current || current) return
    const checkoutWindow = window.open('about:blank', '_blank')
    busyRef.current = true; setBusy(true); setActionError('')
    try {
      const saved = await submitOnlineBalancePayment({
        requestId,
        receiver: selectedReceiver,
      })
      if (saved.paymentMethod) {
        const savedReceiver = receivers.find(account => account.channelCode === saved.paymentMethod)
        if (savedReceiver) setReceiverId(savedReceiver.id)
      }
      setOnlineModalOpen(false)
      if (saved.paid) {
        checkoutWindow?.close()
        setRefreshKey(key => key + 1)
        return
      }
      if (!saved.checkoutUrl) throw new Error('Checkout link is unavailable.')
      openCheckout(saved.checkoutUrl, checkoutWindow)
    } catch (error) {
      checkoutWindow?.close()
      setActionError(message(error))
    }
    finally { busyRef.current = false; setBusy(false) }
  }

  const review = async (status: 'verified' | 'rejected') => {
    if (!isShop || !current || busyRef.current) return
    busyRef.current = true; setBusy(true); setActionError('')
    try {
      const saved = await reviewBalancePayment(current.id, status, reason)
      setPayments(previous => previous.map(payment => payment.id === saved.id ? saved : payment))
      setRejecting(false); setReason('')
    } catch (error) { setActionError(message(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const approveCashDirectly = async () => {
    if (!isShop || busyRef.current) return
    busyRef.current = true; setBusy(true); setActionError('')
    try {
      const saved = await approveShopCashBalancePayment(requestId)
      setPayments(previous => {
        const exists = previous.some(payment => payment.id === saved.id)
        return exists ? previous.map(payment => payment.id === saved.id ? saved : payment) : [saved, ...previous]
      })
    } catch (error) { setActionError(message(error)) }
    finally { busyRef.current = false; setBusy(false) }
  }

  const receiptRefText = current
    ? (current.reference_number || current.provider_reference_id || (current.method === 'cash' ? `#CASH-${current.id.slice(0, 8).toUpperCase()}` : `#BAL-${current.id.slice(0, 8).toUpperCase()}`))
    : ''

  return (
    <section className="rb-payment" aria-labelledby={headingId} aria-busy={loading || busy}>
      <header className="rbp-header">
        <div>
          <h2 id={headingId}>Remaining balance</h2>
        </div>
        <div className="rbp-header-right">
          <strong className={`rbp-amount${paid ? ' is-paid' : ''}`}>{peso(paid ? 0 : Number(request.remainingBalance))}</strong>
          <button type="button" className="rbp-refresh" aria-label="Refresh balance payment status" disabled={loading || busy} onClick={() => setRefreshKey(key => key + 1)}>↻</button>
        </div>
      </header>
      {loading ? <p className="rbp-muted" role="status">Loading…</p> : loadError ? <p className="rbp-error" role="alert">{loadError}</p> : current ? (
        <div className="rbp-stack">
          <dl className="rbp-details">
            <div><dt>Status</dt><dd className={paid ? 'is-paid' : 'is-pending'}>{paid ? 'Paid' : providerBacked ? 'Awaiting online payment confirmation' : 'Awaiting shop confirmation'}</dd></div>
            <div><dt>Payment type</dt><dd>{formatPaymentType(current)}</dd></div>
            <div><dt>{paid ? 'Amount received' : 'Amount submitted'}</dt><dd>{peso(current.amount)}</dd></div>
            <div><dt>Total received</dt><dd className={paid ? 'is-paid' : undefined}>{peso(downpaymentAmount + (paid ? Number(current.amount) : 0))} of {peso(totalOrderAmount)}</dd></div>
            <div><dt>Submitted</dt><dd>{timestamp(current.submitted_at)}</dd></div>
            {current.reviewed_at ? <div><dt>Confirmed</dt><dd>{timestamp(current.reviewed_at)}</dd></div> : null}
            {current.receiver_channel ? <div><dt>Account</dt><dd>{balanceChannelLabel(current.receiver_channel)} · {current.receiver_number}</dd></div> : null}
            {current.payer_name ? <div><dt>Sender</dt><dd>{current.payer_name}</dd></div> : null}
            <div><dt>Reference</dt><dd>{receiptRefText}</dd></div>
          </dl>
          <div className="rbp-actions">
            <button type="button" className="rbp-secondary" disabled={openingReceipt} onClick={() => void openReceipt(current.proof_image_path, true)}>
              {openingReceipt ? 'Opening…' : 'View balance receipt'}
            </button>
            {!isShop && !paid && providerBacked && current.provider_checkout_url ? (
              <button
                type="button"
                className="rbp-primary"
                disabled={busy}
                onClick={() => openCheckout(current.provider_checkout_url!, window.open('about:blank', '_blank'))}
              >
                Continue secure checkout
              </button>
            ) : null}
            {isShop && !paid && !providerBacked ? (
              <>
                <button type="button" className="rbp-primary" disabled={busy} onClick={() => openConfirm({
                  title: current.method === 'cash' ? 'Approve cash payment?' : 'Confirm payment?',
                  message: `Confirm receiving ${peso(current.amount)}${current.method === 'cash' ? ' in cash' : ''}?`,
                  confirmLabel: current.method === 'cash' ? 'Approve' : 'Confirm', tone: 'success', onConfirm: () => review('verified'),
                })}>{busy ? 'Saving…' : current.method === 'cash' ? 'Approve cash payment' : 'Confirm payment'}</button>
                <button type="button" className="rbp-secondary" disabled={busy} aria-expanded={rejecting} onClick={() => setRejecting(value => !value)}>Reject</button>
              </>
            ) : null}
          </div>
          {isShop && !paid && !providerBacked && rejecting ? (
            <div className="rbp-stack">
              <label className="rbp-label">Reason for rejection<textarea className="rbp-input" value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={500} rows={2} disabled={busy} placeholder="Reason for rejection" /></label>
              <div className="rbp-actions">
                <button type="button" className="rbp-primary" disabled={busy || reason.trim().length < 3} onClick={() => void review('rejected')}>Send rejection</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : isShop ? (
        <div className="rbp-stack">
          <dl className="rbp-details">
            <div><dt>Status</dt><dd>Unpaid</dd></div>
            <div><dt>Total received</dt><dd>{peso(downpaymentAmount)} of {peso(totalOrderAmount)}</dd></div>
          </dl>
          <div className="rbp-actions">
            <button type="button" className="rbp-primary" disabled={busy} onClick={() => openConfirm({
              title: 'Approve cash payment?',
              message: `Mark ${peso(Number(request.remainingBalance))} as paid in cash?`,
              confirmLabel: 'Approve', tone: 'success', onConfirm: approveCashDirectly,
            })}>{busy ? 'Saving…' : 'Approve cash payment'}</button>
          </div>
        </div>
      ) : (
        <div className="rbp-stack">
          {latestRejection?.status === 'rejected' ? <p className="rbp-error" role="status">Rejected: {latestRejection.rejection_reason}</p> : null}
          <div className="rbp-actions">
            <button
              type="button"
              className="rbp-secondary"
              disabled={busy}
              onClick={() => openConfirm({
                title: 'Pay in cash?',
                message: `Pay ${peso(remainingBalanceAmount)} in cash at the shop.`,
                confirmLabel: 'Confirm',
                onConfirm: submitCash,
              })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="12" cy="12" r="2.5" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
              <span>Cash</span>
            </button>
            <button
              type="button"
              className="rbp-primary"
              disabled={busy}
              onClick={openOnlineModal}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
                <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>Pay Online</span>
            </button>
          </div>
        </div>
      )}

      {!loading && activityEvents.length > 0 ? (
        <div className="rbp-activity">
          <h3 className="rbp-activity-title">Balance payment activity</h3>
          <div className="rbp-activity-list">
            {activityEvents.map(event => (
              <div key={event.key} className="rbp-activity-item">
                <strong>{event.label}</strong>
                <span>{event.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {actionError && !onlineModalOpen ? <p className="rbp-error" role="alert">{actionError}</p> : null}

      {/* Online Payment Modal — identical layout to ServiceXenditModal */}
      {onlineModalOpen ? (
        <div className="sxm-overlay" onClick={closeOnlineModal} role="dialog" aria-modal="true" aria-labelledby={`${headingId}-online-title`}>
          <div className="sxm-modal" onClick={event => event.stopPropagation()}>
            <div className="sxm-sheet-handle" aria-hidden="true" />

            <div className="sxm-header">
              <div className="sxm-header-copy">
                <h2 id={`${headingId}-online-title`} className="sxm-header-title">Online Payment</h2>
                <p className="sxm-header-subtitle">Review amount and continue to secure checkout</p>
              </div>
              <button
                type="button"
                className="sxm-close-btn"
                onClick={closeOnlineModal}
                disabled={busy}
                aria-label="Close payment"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="sxm-summary-banner">
              <div className="sxm-product-row">
                {request.productImageUrl ? (
                  <img
                    src={request.productImageUrl}
                    alt={request.productName || 'Service'}
                    className="sxm-product-img"
                  />
                ) : (
                  <div className="sxm-product-fallback" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
                      <path d="m12 12 8-4.5M12 12v9M12 12 4 7.5" />
                    </svg>
                  </div>
                )}
                <div className="sxm-product-info">
                  <h3 className="sxm-product-name">{request.productName || 'Funeral Service'}</h3>
                  <p className="sxm-product-shop">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 10v10h16V10M3 10l2-6h14l2 6" />
                      <path d="M9 20v-6h6v6" />
                    </svg>
                    <span>{request.shopName || 'Funeral Shop'}</span>
                  </p>
                  {request.variationName ? (
                    <span className="sxm-variation-pill">{request.variationName}</span>
                  ) : null}
                </div>
              </div>

              <div className="sxm-banner-divider" />

              <div className="sxm-breakdown">
                {totalOrderAmount > 0 ? (
                  <div className="sxm-breakdown-row">
                    <span>Total service price</span>
                    <strong>{peso(totalOrderAmount)}</strong>
                  </div>
                ) : null}
                {downpaymentAmount > 0 ? (
                  <div className="sxm-breakdown-row">
                    <span>Downpayment paid</span>
                    <strong>-{peso(downpaymentAmount)}</strong>
                  </div>
                ) : null}
                <div className="sxm-due-row">
                  <span>Remaining balance due</span>
                  <strong>{peso(remainingBalanceAmount)}</strong>
                </div>
              </div>
            </div>

            {receivers.length === 0 ? (
              <div className="sxm-banner-notice warning" role="status">
                Online checkout is unavailable for this shop right now.
              </div>
            ) : null}

            {actionError ? (
              <div className="sxm-banner-notice warning" role="alert">
                {actionError}
              </div>
            ) : null}

            <div className="sxm-actions">
              <button
                type="button"
                className="sxm-pay-btn"
                disabled={busy || receivers.length === 0}
                onClick={() => void submitOnline()}
              >
                {busy ? (
                  <>
                    <div className="sxm-spinner" />
                    <span>Opening secure checkout…</span>
                  </>
                ) : (
                  <span>
                    Pay {peso(remainingBalanceAmount)} online
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <dialog ref={dialogRef} className="rbp-viewer" aria-label="Balance payment receipt" onClose={() => { setViewerUrl(''); setReceiptOpen(false) }} onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
        <div className="rbp-viewer-inner">
          <div className="rbp-viewer-handle" aria-hidden="true" />
          <div className="rbp-viewer-head">
            <div>
              <h3 className="rbp-receipt-title">{current && receiptOpen ? 'Balance Payment Receipt' : 'Uploaded Receipt'}</h3>
              {current && receiptOpen ? <p className="rbp-receipt-sub">{receiptRefText}</p> : null}
            </div>
            <button type="button" className="rbp-viewer-close" aria-label="Close receipt" onClick={() => dialogRef.current?.close()}>×</button>
          </div>

          {current && receiptOpen ? (
            <div className="rbp-receipt-summary">
              <div className="rbp-receipt-hero">
                <div>
                  <span>{paid ? 'Amount paid' : 'Amount submitted'}</span>
                  <strong>{peso(current.amount)}</strong>
                </div>
                <b className={`rbp-receipt-pill ${paid ? 'is-paid' : 'is-pending'}`}>
                  {paid ? 'Paid' : 'Awaiting confirmation'}
                </b>
              </div>
              <dl className="rbp-receipt-rows">
                <div><dt>Payment type</dt><dd>{formatPaymentType(current)}</dd></div>
                {current.payer_name ? <div><dt>Sender</dt><dd>{current.payer_name}</dd></div> : null}
                {current.receiver_channel ? <div><dt>Shop account</dt><dd>{balanceChannelLabel(current.receiver_channel)} · {current.receiver_number}</dd></div> : null}
                <div><dt>Submitted</dt><dd>{timestamp(current.submitted_at)}</dd></div>
                {current.reviewed_at ? <div><dt>Confirmed</dt><dd>{timestamp(current.reviewed_at)}</dd></div> : null}
                <div><dt>Total service price</dt><dd>{peso(totalOrderAmount)}</dd></div>
                <div><dt>Downpayment paid</dt><dd>{peso(downpaymentAmount)}</dd></div>
                <div><dt>Remaining balance paid</dt><dd>{peso(current.amount)}</dd></div>
                <div><dt>Total received by shop</dt><dd className={paid ? 'is-paid' : undefined}>{peso(downpaymentAmount + (paid ? Number(current.amount) : 0))}</dd></div>
              </dl>
            </div>
          ) : null}

          {viewerUrl ? (
            <div className="rbp-viewer-image-wrap">
              <img src={viewerUrl} alt="Balance transfer receipt" />
            </div>
          ) : null}
        </div>
      </dialog>
      {confirmDialog}
    </section>
  )
}
