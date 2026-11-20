import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { createXenditShopCheckout, syncXenditShopPayment } from '@/utils/xenditShop'
import { getPaymentSetting } from '@/utils/paymentSettings'
import HistoryPagination from './HistoryPagination'
import './XenditShopPaymentCard.css'

type Props = {
  className?: string
  onSuccess?: () => void
}

type Payment = {
  id: string
  status: 'pending' | 'verified' | 'rejected'
  amount: number
  referenceNumber: string
  createdAt: string
  verifiedAt: string | null
  expiresAt: string | null
  rejectionReason: string | null
  payerName: string | null
  paymentProvider: 'manual' | 'legacy' | 'xendit'
  providerCheckoutUrl: string | null
  providerPaymentId: string | null
  providerPaymentMethod: string | null
}

const peso = (value: number) => new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
}).format(value || 0)

const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
  : '-'

const dateOnly = (value?: string | null) => value
  ? new Date(value).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
  : 'Not set'

const historyDate = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' })
const historyTime = new Intl.DateTimeFormat('en-PH', { timeStyle: 'short' })

function remainingDays(value?: string | null) {
  if (!value) return 0
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.ceil((time - Date.now()) / 86_400_000))
}

function statusText(payment: Payment) {
  if (payment.status === 'verified') return 'Paid'
  if (payment.status === 'rejected') return 'Not completed'
  if (payment.paymentProvider === 'xendit') return 'Awaiting checkout'
  if (payment.paymentProvider === 'legacy') return 'Legacy checkout'
  return 'Admin review'
}

function receiptNumber(payment: Payment) {
  return `LC-${payment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

function receiptMessage(payment: Payment) {
  if (payment.status === 'verified') return 'LifeCycle confirmed this registration payment automatically.'
  if (payment.status === 'rejected') return 'This registration payment was not completed. Review the reason below before trying again.'
  return 'Your checkout is waiting for completion or confirmation.'
}

function customerFacingError(error: unknown) {
  if (!(error instanceof Error) || !error.message) return 'Please try again.'
  return error.message
    .replace(/xendit/gi, 'payment provider')
    .replace(/test mode/gi, 'payment')
}

export default function XenditShopPaymentCard({
  className,
  onSuccess,
}: Props) {
  const { openAlert, alertDialog } = useAlertDialog()
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [fee, setFee] = useState(0)
  const [payments, setPayments] = useState<Payment[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [shopName, setShopName] = useState('Funeral shop')
  const [paidUntil, setPaidUntil] = useState<string | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [purchaseConfirmOpen, setPurchaseConfirmOpen] = useState(false)
  const onSuccessRef = useRef(onSuccess)
  const paymentCompleteRef = useRef(false)
  const paymentStateReadyRef = useRef(false)

  useEffect(() => {
    onSuccessRef.current = onSuccess
  }, [onSuccess])

  const load = useCallback(async () => {
    const [{ data: { user } }, setting] = await Promise.all([
      supabase.auth.getUser(),
      getPaymentSetting(),
    ])
    setFee(setting.feeAmount)
    if (!user) {
      setPayments([])
      setPaidUntil(null)
      return false
    }
    await syncXenditShopPayment().catch(() => undefined)
    const [paymentResult, shopResult] = await Promise.all([
      supabase
        .from('shop_payments')
        .select('id, status, amount, \x22referenceNumber\x22, \x22createdAt\x22, \x22verifiedAt\x22, \x22expiresAt\x22, \x22rejectionReason\x22, \x22payerName\x22, \x22paymentProvider\x22, \x22providerCheckoutUrl\x22, \x22providerPaymentId\x22, \x22providerPaymentMethod\x22')
        .eq('shopId', user.id)
        .order('createdAt', { ascending: false }),
      supabase
        .from('funeral_shops')
        .select('shopName, shopPhoneNumber, paidUntil')
        .eq('id', user.id)
        .maybeSingle(),
    ])
    if (paymentResult.error) throw paymentResult.error
    if (shopResult.error) throw shopResult.error
    const resolvedShopName = shopResult.data?.shopName || 'Funeral shop'
    setShopName(resolvedShopName)
    setPaidUntil(shopResult.data?.paidUntil || null)
    const nextPayments: Payment[] = (paymentResult.data || []).map((row: any) => ({
      id: row.id,
      status: row.status || 'pending',
      amount: Number(row.amount) || 0,
      referenceNumber: row.referenceNumber || '',
      createdAt: row.createdAt || '',
      verifiedAt: row.verifiedAt || null,
      expiresAt: row.expiresAt || null,
      rejectionReason: row.rejectionReason || null,
      payerName: row.payerName || null,
      paymentProvider: row.paymentProvider === 'xendit'
        ? 'xendit'
        : row.paymentProvider === 'manual'
          ? 'manual'
          : 'legacy',
      providerCheckoutUrl: row.providerCheckoutUrl || null,
      providerPaymentId: row.providerPaymentId || null,
      providerPaymentMethod: row.providerPaymentMethod || null,
    }))
    setPayments(nextPayments)

    const paidUntilTime = shopResult.data?.paidUntil
      ? new Date(shopResult.data.paidUntil).getTime()
      : Number.NaN
    const subscriptionActive = Number.isFinite(paidUntilTime) && paidUntilTime > Date.now()
    const latestVerified = nextPayments.find((payment) => payment.status === 'verified') || null
    const verifiedAtTime = latestVerified?.verifiedAt
      ? new Date(latestVerified.verifiedAt).getTime()
      : Number.NaN
    const renewalPaymentReady = Boolean(
      latestVerified
      && !subscriptionActive
      && (!Number.isFinite(paidUntilTime) || (Number.isFinite(verifiedAtTime) && verifiedAtTime > paidUntilTime)),
    )
    return subscriptionActive || renewalPaymentReady
  }, [])

  useEffect(() => {
    let active = true
    const refreshPaymentState = async (notifyOnPaid = true) => {
      const paymentComplete = await load()
      if (!active) return

      const becamePaid = paymentStateReadyRef.current
        && !paymentCompleteRef.current
        && paymentComplete
      paymentCompleteRef.current = paymentComplete
      paymentStateReadyRef.current = true
      if (notifyOnPaid && becamePaid) onSuccessRef.current?.()
    }

    void refreshPaymentState(false).catch(() => undefined).finally(() => active && setReady(true))
    const channel = supabase.channel('shop-xendit-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void refreshPaymentState().catch(() => undefined)
      }).subscribe()
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshPaymentState().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', refresh)
      void supabase.removeChannel(channel)
    }
  }, [load])

  const latestPending = useMemo(
    () => payments.find((payment) => payment.status === 'pending') || null,
    [payments],
  )
  const latestVerified = useMemo(
    () => payments.find((payment) => payment.status === 'verified') || null,
    [payments],
  )

  const paidUntilTime = paidUntil ? new Date(paidUntil).getTime() : Number.NaN
  const subscriptionActive = Number.isFinite(paidUntilTime) && paidUntilTime > Date.now()
  const verifiedAtTime = latestVerified?.verifiedAt ? new Date(latestVerified.verifiedAt).getTime() : Number.NaN
  const renewalPaymentReady = Boolean(
    latestVerified
    && !subscriptionActive
    && (!Number.isFinite(paidUntilTime) || (Number.isFinite(verifiedAtTime) && verifiedAtTime > paidUntilTime)),
  )
  const paymentComplete = subscriptionActive || renewalPaymentReady
  const subscriptionDaysLeft = remainingDays(paidUntil)
  const subscriptionState = subscriptionActive
    ? 'active'
    : renewalPaymentReady
      ? 'paid'
      : latestPending
        ? 'pending'
        : Number.isFinite(paidUntilTime)
          ? 'expired'
          : 'unpaid'

  const startCheckout = async () => {
    if (starting) return
    if (paymentComplete) {
      openAlert({
        title: subscriptionActive ? 'Subscription already paid' : 'Payment already confirmed',
        message: subscriptionActive
          ? `Your subscription is active through ${dateOnly(paidUntil)}. Renewal becomes available after it expires.`
          : 'Your registration or renewal payment is already confirmed. You do not need to pay again.',
        tone: 'info',
        okLabel: 'Done',
      })
      return
    }
    if (fee <= 0) {
      openAlert({ title: 'Payment unavailable', message: 'The registration fee has not been configured yet.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    setStarting(true)
    try {
      const result = await createXenditShopCheckout('all')
      if (result.paid) {
        setPurchaseConfirmOpen(false)
        await load()
        paymentCompleteRef.current = true
        paymentStateReadyRef.current = true
        onSuccessRef.current?.()
        openAlert({ title: 'Payment received', message: 'Your payment has been confirmed.', tone: 'info', okLabel: 'Done' })
        return
      }
      if (result.livemode !== false) throw new Error('This checkout is currently unavailable.')
      if (!result.checkoutUrl) throw new Error('The payment provider did not return a checkout page.')
      window.location.assign(result.checkoutUrl)
    } catch (error) {
      openAlert({
        title: 'Unable to start payment',
        message: customerFacingError(error),
        tone: 'danger',
        okLabel: 'Close',
      })
      setStarting(false)
    }
  }

  if (!ready) {
    return (
      <div className={'lp-layout' + (className ? ` ${className}` : '')}>
        <h2 className="lp-page-title">LifeCycle Payments</h2>
        <div className="lp-loading-card">Loading subscription details…</div>
      </div>
    )
  }

  const historyPageCount = Math.max(1, Math.ceil(payments.length / historyPageSize))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const historyStart = (currentHistoryPage - 1) * historyPageSize
  const visiblePayments = payments.slice(historyStart, historyStart + historyPageSize)
  const manualPending = latestPending?.paymentProvider === 'manual'
  const returned = new URLSearchParams(window.location.search).get('xendit')
  const statusPillLabel = subscriptionActive
    ? 'Active'
    : renewalPaymentReady
      ? 'Paid'
      : latestPending
        ? 'Pending'
        : Number.isFinite(paidUntilTime)
          ? 'Expired'
          : 'Unpaid'

  return (
    <section className={'lp-layout' + (className ? ` ${className}` : '')}>
      <h2 className="lp-page-title">LifeCycle Payments</h2>

      {returned === 'success' && <div className="lp-banner is-success">Checkout finished. Confirming your payment now.</div>}
      {returned === 'cancelled' && <div className="lp-banner">Checkout was cancelled. You can continue whenever you are ready.</div>}
      {manualPending && (
        <div className="lp-banner is-warning">Your previous manual payment is awaiting admin review. It must be resolved before starting another checkout.</div>
      )}

      <div className="lp-card">
        <div className="lp-card-header">
          <div>
            <h3 className="lp-card-title">Shop subscription</h3>
            <p className="lp-card-subtitle">{shopName}</p>
          </div>
          <span className={`lp-status-pill is-${subscriptionState}`}>{statusPillLabel}</span>
        </div>

        <div className="lp-summary-band">
          <div>
            <span className="lp-price-label">Subscription fee</span>
            <strong className="lp-price-amount">{peso(fee)}</strong>
            <p className="lp-status-note">
              {subscriptionActive
                ? `${subscriptionDaysLeft} day${subscriptionDaysLeft === 1 ? '' : 's'} left on your subscription`
                : renewalPaymentReady
                  ? 'Payment confirmed · ready to activate'
                  : latestPending
                    ? 'Waiting for payment confirmation'
                    : Number.isFinite(paidUntilTime)
                      ? `Expired on ${dateOnly(paidUntil)}`
                      : 'Payment required to go live'}
            </p>
          </div>

          {paymentComplete ? (
            latestVerified && (
              <button
                type="button"
                className="lp-secondary-btn"
                onClick={() => setSelectedPayment(latestVerified)}
              >
                View receipt
              </button>
            )
          ) : (
            <button
              type="button"
              className="lp-primary-btn"
              disabled={starting || fee <= 0 || manualPending}
              onClick={() => setPurchaseConfirmOpen(true)}
            >
              {starting
                ? 'Opening…'
                : latestPending?.paymentProvider === 'xendit'
                  ? 'Continue checkout'
                  : Number.isFinite(paidUntilTime)
                    ? `Renew ${peso(fee)}`
                    : `Pay ${peso(fee)}`}
            </button>
          )}
        </div>

        <dl className="lp-details-list">
          {paidUntil && (
            <div className="lp-detail-row">
              <dt>{subscriptionActive ? 'Valid through' : 'Previous expiry'}</dt>
              <dd>{dateOnly(paidUntil)}</dd>
            </div>
          )}
          {latestVerified && (
            <div className="lp-detail-row">
              <dt>Last payment</dt>
              <dd>
                {dateOnly(latestVerified.verifiedAt || latestVerified.createdAt)}
                <span className="lp-detail-receipt">#{receiptNumber(latestVerified)}</span>
              </dd>
            </div>
          )}
          <div className="lp-detail-row">
            <dt>Payment methods</dt>
            <dd>GCash, Maya, cards, online banking</dd>
          </div>
        </dl>
      </div>

      {/* Payment History table card */}
      <section className="lp-history-card" aria-label="Payment history">
        <div className="lp-history-head">
          <h3>Payment history</h3>
          <span>{payments.length} {payments.length === 1 ? 'record' : 'records'}</span>
        </div>

        <div className="sc-history-table-wrap">
          <table className="sc-history-table lp-history-table">
            <thead>
              <tr>
                <th scope="col" className="col-time">Time</th>
                <th scope="col" className="col-amount">Amount</th>
                <th scope="col" className="col-status">Status</th>
                <th scope="col" className="col-ref">Reference No.</th>
              </tr>
            </thead>
            <tbody>
              {visiblePayments.length === 0 ? (
                <tr><td colSpan={4} className="sc-history-empty-cell">No subscription payments yet.</td></tr>
              ) : visiblePayments.map(payment => {
                const reference = payment.referenceNumber || receiptNumber(payment)
                const createdAt = new Date(payment.createdAt)

                return (
                  <tr key={payment.id} className="sc-history-clickable-row" onClick={() => setSelectedPayment(payment)}>
                    <td className="col-time">
                      {Number.isFinite(createdAt.getTime()) ? (
                        <time dateTime={createdAt.toISOString()} className="lp-history-time">
                          <span>{historyDate.format(createdAt)}</span>
                          <span>{historyTime.format(createdAt)}</span>
                        </time>
                      ) : '—'}
                    </td>
                    <td className="col-amount">{peso(payment.amount)}</td>
                    <td className="col-status">
                      <span className={`lp-tx-status is-${payment.status}`}>{statusText(payment)}</span>
                    </td>
                    <td className="col-ref">
                      <div className="lp-history-reference">
                        <span>{reference}</span>
                        <button
                          type="button"
                          className="lp-view-receipt-btn"
                          aria-label={`View receipt ${reference}`}
                          aria-haspopup="dialog"
                          onClick={event => {
                            event.stopPropagation()
                            setSelectedPayment(payment)
                          }}
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <HistoryPagination
          label="Payment history pages"
          page={currentHistoryPage}
          pageCount={historyPageCount}
          pageSize={historyPageSize}
          onPageChange={setHistoryPage}
          onPageSizeChange={setHistoryPageSize}
        />
      </section>

      {purchaseConfirmOpen && !paymentComplete && (
        <div className="lp-modal-overlay" role="presentation" onMouseDown={() => !starting && setPurchaseConfirmOpen(false)}>
          <section className="lp-confirm-modal" role="dialog" aria-modal="true" aria-label="Confirm payment" onMouseDown={event => event.stopPropagation()}>
            <header className="lp-modal-header">
              <div>
                <h3>Confirm payment</h3>
                <p>LifeCycle shop registration &amp; renewal</p>
              </div>
              <button
                type="button"
                className="lp-modal-close"
                onClick={() => setPurchaseConfirmOpen(false)}
                aria-label="Close checkout"
              >
                ×
              </button>
            </header>
            <div className="lp-confirm-summary">
              <div>
                <strong>{shopName}</strong>
                <span>GCash, Maya, cards &amp; online banking</span>
              </div>
              <b>{peso(fee)}</b>
            </div>
            <footer className="lp-confirm-actions">
              <button
                type="button"
                className="lp-secondary-btn"
                disabled={starting}
                onClick={() => setPurchaseConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lp-primary-btn"
                aria-busy={starting}
                disabled={starting}
                onClick={() => void startCheckout()}
              >
                {starting ? 'Opening checkout…' : 'Continue to payment'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {selectedPayment && (
        <div className='pm-receipt-overlay' role='presentation' onMouseDown={() => setSelectedPayment(null)}>
          <section
            className='pm-receipt-modal lp-receipt-modal'
            role='dialog'
            aria-modal='true'
            aria-label='Registration payment receipt'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className='lp-receipt-header'>
              <div>
                <span className={`lp-tx-status is-${selectedPayment.status}`}>{statusText(selectedPayment)}</span>
                <h3>
                  {selectedPayment.status === 'verified'
                    ? 'Payment Verified'
                    : selectedPayment.status === 'rejected'
                      ? 'Payment Not Completed'
                      : 'Payment Pending'}
                </h3>
                <p>{receiptMessage(selectedPayment)}</p>
              </div>
              <button className='lp-modal-close' type='button' onClick={() => setSelectedPayment(null)} aria-label='Close receipt'>×</button>
            </header>

            <div className='pm-receipt-body'>
              <h4>Payment Details</h4>
              <div className='pm-receipt-lines'>
                <ReceiptLine label='Payment Date' value={dateTime(selectedPayment.verifiedAt || selectedPayment.createdAt)} />
                <ReceiptLine label='Receipt No.' value={receiptNumber(selectedPayment)} />
                <ReceiptLine label='Shop' value={shopName} />
                {selectedPayment.expiresAt && <ReceiptLine label='Access Valid Until' value={dateTime(selectedPayment.expiresAt)} />}
              </div>

              <div className='pm-receipt-divider' />

              <div className='pm-receipt-service'>
                <img className='pm-receipt-logo' src={APP_ICON_TRANSPARENT_URL} alt='LifeCycle' />
                <div>
                  <strong>LifeCycle registration</strong>
                  <small>Funeral shop subscription payment</small>
                </div>
                <b>{peso(selectedPayment.amount)}</b>
              </div>

              <div className='pm-receipt-divider' />

              <h4>Receipt Information</h4>
              <div className='pm-receipt-info'>
                <ReceiptLine label='Payment Method' value={selectedPayment.paymentProvider === 'xendit' ? `Online payment${selectedPayment.providerPaymentMethod ? ` - ${selectedPayment.providerPaymentMethod.replace(/_/g, ' ')}` : ''}` : selectedPayment.paymentProvider === 'legacy' ? 'Legacy online payment' : 'Legacy manual'} />
                <ReceiptLine label='Paid By' value={selectedPayment.payerName || shopName} />
                <ReceiptLine label='Reference Number' value={selectedPayment.referenceNumber || 'Not provided'} />
                <ReceiptLine label='Provider Payment ID' value={selectedPayment.providerPaymentId || 'Pending'} />
                <ReceiptLine label='Status' value={statusText(selectedPayment)} />
                <ReceiptLine label='Amount' value={peso(selectedPayment.amount)} />
                {selectedPayment.verifiedAt && <ReceiptLine label='Confirmed At' value={dateTime(selectedPayment.verifiedAt)} />}
              </div>

              {selectedPayment.paymentProvider === 'xendit' && (
                <div className={'pm-receipt-provider-note ' + (selectedPayment.status === 'verified' ? 'verified' : 'pending')}>
                  <strong>{selectedPayment.status === 'verified' ? 'Payment verified' : 'Confirmation pending'}</strong>
                  <span>{selectedPayment.status === 'verified' ? 'Confirmed automatically upon checkout.' : 'This receipt will update automatically after the payment is confirmed.'}</span>
                </div>
              )}

              {selectedPayment.rejectionReason && <div className='pm-receipt-error'>{selectedPayment.rejectionReason}</div>}

              {selectedPayment.status === 'pending' && selectedPayment.paymentProvider === 'xendit' && selectedPayment.providerCheckoutUrl && (
                <button className='pm-receipt-primary' type='button' onClick={() => window.location.assign(selectedPayment.providerCheckoutUrl!)}>Continue Checkout</button>
              )}
              <button className='pm-receipt-secondary' type='button' onClick={() => setSelectedPayment(null)}>Close Receipt</button>
            </div>
          </section>
        </div>
      )}
      {alertDialog}
    </section>
  )
}

function ReceiptLine({ label, value }: { label: string; value: string }) {
  return <div className='pm-receipt-line'><span>{label}</span><strong>{value}</strong></div>
}
