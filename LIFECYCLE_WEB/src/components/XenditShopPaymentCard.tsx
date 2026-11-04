import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import BrandLogo from '@/components/BrandLogo'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { createXenditShopCheckout, syncXenditShopPayment } from '@/utils/xenditShop'
import { getPaymentSetting } from '@/utils/paymentSettings'
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
  const [shopName, setShopName] = useState('Funeral shop')
  const [paidUntil, setPaidUntil] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null)
  const [purchaseConfirmOpen, setPurchaseConfirmOpen] = useState(false)

  const load = useCallback(async () => {
    const [{ data: { user } }, setting] = await Promise.all([
      supabase.auth.getUser(),
      getPaymentSetting(),
    ])
    setFee(setting.feeAmount)
    if (!user) {
      setPayments([])
      setPaidUntil(null)
      return
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
    setPayments((paymentResult.data || []).map((row: any) => ({
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
    })))
  }, [])

  useEffect(() => {
    let active = true
    load().catch(() => undefined).finally(() => active && setReady(true))
    const channel = supabase.channel('shop-xendit-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void load().then(onSuccess).catch(() => undefined)
      }).subscribe()
    const refresh = () => {
      if (document.visibilityState === 'visible') void load().then(onSuccess).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', refresh)
      void supabase.removeChannel(channel)
    }
  }, [load, onSuccess])

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
  const subscriptionDetail = subscriptionActive
    ? `Active through ${dateOnly(paidUntil)}`
    : renewalPaymentReady
      ? 'Payment confirmed - ready to activate'
      : latestPending
        ? 'Payment confirmation pending'
        : Number.isFinite(paidUntilTime)
          ? `Expired on ${dateOnly(paidUntil)}`
          : 'No active subscription'

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
        onSuccess?.()
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

  if (!ready) return <div className='pm-card pm-loading'>Loading subscription details…</div>

  const manualPending = latestPending?.paymentProvider === 'manual'
  const returned = new URLSearchParams(window.location.search).get('xendit')

  return (
    <section className={'pm-card' + (className ? ` ${className}` : '')}>
      <div className='pm-hero'>
        <BrandLogo to='/funeral' compact className='pm-payment-brand' />
      </div>

      {returned === 'success' && <div className='pm-banner success'>Checkout finished. Confirming your payment now.</div>}
      {returned === 'cancelled' && <div className='pm-banner'>Checkout was cancelled. You can continue whenever you are ready.</div>}

      <div className='pm-product-row'>
        <span className='pm-product-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24'><path d='M3 10h18M5 10v10h14V10M4 10l2-6h12l2 6M9 20v-6h6v6'/></svg>
        </span>
        <div className='pm-product-info'>
          <strong>Shop registration &amp; renewal</strong>
          <small>{shopName}</small>
          <span className={`pm-product-status ${subscriptionState}`}>{subscriptionDetail}</span>
        </div>
      </div>

      <div className='pm-order-summary'>
        <div className='pm-summary-row'>
          <span>{paymentComplete ? 'Current subscription' : 'Registration / renewal fee'}</span>
          <strong>{peso(fee)}</strong>
        </div>
        <div className='pm-summary-total'>
          <div>
            <strong>{paymentComplete ? 'Subscription status' : 'Amount due'}</strong>
            <small>{subscriptionActive
              ? `Active until ${dateOnly(paidUntil)} · ${subscriptionDaysLeft} day${subscriptionDaysLeft === 1 ? '' : 's'} left`
              : renewalPaymentReady
                ? 'Payment confirmed · starts when your shop goes live'
                : latestPending
                  ? 'Waiting for payment confirmation'
                  : 'Includes shop listing and service request management'}</small>
          </div>
          <b className={paymentComplete ? 'paid' : ''}>{paymentComplete ? 'Paid' : peso(fee)}</b>
        </div>
      </div>

      <div className='pm-method-summary'>
        <span className='pm-method-summary-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24'><rect x='3' y='5' width='18' height='14' rx='2'/><path d='M3 10h18'/></svg>
        </span>
        <div>
          <strong>Payment methods</strong>
          <small>GCash, Maya, cards and online banking</small>
        </div>
        <span className='pm-method-check' aria-hidden='true'>&#10003;</span>
      </div>

      {manualPending && (
        <div className='pm-banner warning'>Your previous manual payment is awaiting admin review. It must be resolved before starting another checkout.</div>
      )}

      {paymentComplete ? (
        <div className='pm-paid-actions-wrap'>
          <div className='pm-paid-actions'>
            <div className='pm-paid-confirmation' aria-label='Payment complete'>
              <span aria-hidden='true'>&#10003;</span>
              <strong>{subscriptionActive ? `Already paid - renews after ${dateOnly(paidUntil)}` : 'Payment confirmed - ready to activate'}</strong>
            </div>
            {latestVerified && (
              <button type='button' className='pm-receipt-link' onClick={() => setSelectedPayment(latestVerified)}>View payment receipt</button>
            )}
          </div>
        </div>
      ) : (
        <button type='button' className='pm-pay' disabled={starting || fee <= 0 || manualPending} onClick={() => setPurchaseConfirmOpen(true)}>
          {starting
            ? 'Opening payment...'
            : latestPending?.paymentProvider === 'xendit'
              ? 'Continue checkout'
              : Number.isFinite(paidUntilTime)
                ? `Renew for ${peso(fee)}`
                : `Pay ${peso(fee)}`}
        </button>
      )}

      {payments.length > 0 && (
        <>
          <button type='button' className='pm-history-toggle' onClick={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen}>
            <span aria-hidden='true'>&#9783;</span>
            <strong>View payment history ({payments.length})</strong>
            <b aria-hidden='true'>{historyOpen ? '^' : '>'}</b>
          </button>
          {historyOpen && (
            <div className='pm-history'>
              <div className='pm-history-head'>
                <h4>Payment history</h4>
                <span>{payments.length} {payments.length === 1 ? 'payment' : 'payments'}</span>
              </div>
              {payments.map((payment) => (
                <button
                  type='button'
                  className='pm-row pm-row-button'
                  key={payment.id}
                  onClick={() => setSelectedPayment(payment)}
                  aria-label={`Open receipt for ${peso(payment.amount)} payment`}
                >
                  <div>
                    <strong>{peso(payment.amount)}</strong>
                    <small>{payment.paymentProvider === 'xendit' ? 'Online payment' : payment.paymentProvider === 'legacy' ? 'Legacy online payment' : 'Legacy manual'}{payment.providerPaymentMethod ? ` - ${payment.providerPaymentMethod.replace(/_/g, ' ')}` : ''} - {dateTime(payment.createdAt)}</small>
                    {payment.rejectionReason && <small className='pm-reason'>{payment.rejectionReason}</small>}
                  </div>
                  <span className='pm-row-end'>
                    <span className={'pm-status ' + payment.status}>{statusText(payment)}</span>
                    <span className='pm-view-receipt'>View receipt</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {purchaseConfirmOpen && !paymentComplete && (
        <div className='pm-purchase-overlay' role='presentation' onMouseDown={() => !starting && setPurchaseConfirmOpen(false)}>
          <section className='pm-purchase-sheet' role='dialog' aria-modal='true' aria-label='Confirm payment' onMouseDown={event => event.stopPropagation()}>
            <div className='pm-purchase-handle' />
            <div className='pm-purchase-brand-row'>
              <div>
                <BrandLogo to='/funeral' compact className='pm-payment-brand pm-purchase-brand-logo' />
              </div>
              <button
                type='button'
                className='pm-purchase-close'
                onClick={() => setPurchaseConfirmOpen(false)}
                aria-label='Close checkout'
              >
                <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M18 6 6 18M6 6l12 12' /></svg>
              </button>
            </div>
            <div className='pm-purchase-product-row'>
              <div>
                <strong>Shop registration and renewal</strong>
                <small>LifeCycle billing</small>
              </div>
              <b>{peso(fee)}</b>
            </div>
            <div className='pm-purchase-divider' />
            <button type='button' className='pm-purchase-buy' aria-busy={starting} disabled={starting} onClick={() => void startCheckout()}>
              {starting ? 'Opening checkout...' : 'Continue to payment'}
            </button>
          </section>
        </div>
      )}

      {selectedPayment && (
        <div className='pm-receipt-overlay' role='presentation' onMouseDown={() => setSelectedPayment(null)}>
          <section
            className='pm-receipt-modal'
            role='dialog'
            aria-modal='true'
            aria-label='Registration payment receipt'
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className='pm-receipt-hero'>
              <button className='pm-receipt-x' type='button' onClick={() => setSelectedPayment(null)} aria-label='Close receipt'>×</button>
              <div className={'pm-receipt-status-icon ' + selectedPayment.status} aria-hidden='true'>
                {selectedPayment.status === 'verified' ? '✓' : selectedPayment.status === 'rejected' ? '!' : '…'}
              </div>
              <h3>{selectedPayment.status === 'verified' ? 'Payment Verified' : selectedPayment.status === 'rejected' ? 'Payment Not Completed' : 'Payment Pending'}</h3>
              <p>{receiptMessage(selectedPayment)}</p>
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
