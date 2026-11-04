import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  chooseServicePaymentOption,
  createServiceXenditCheckout,
  getServicePaymentMethods,
  prepareServicePaymentOption,
  syncServiceXenditCheckout,
  type ServicePaymentOption,
  type ServicePaymentMethod,
} from '@/utils/serviceXendit'
import './ServiceXenditModal.css'

export type ServiceXenditRequest = {
  id: string
  productName?: string | null
  productImageUrl?: string | null
  shopName?: string | null
  variationName?: string | null
  productPrice?: number | string | null
  paymentAmount?: number | string | null
  paymentOption?: 'pending' | ServicePaymentOption | null
  productFullPrice?: number | string | null
  downpaymentAmountSnapshot?: number | string | null
  downpaymentPercentageSnapshot?: number | string | null
  remainingBalance?: number | string | null
  providerCheckoutId?: string | null
  status?: string | null
}

type Props = {
  isOpen: boolean
  request: ServiceXenditRequest | null
  onClose: () => void
  onSuccess?: () => void
}

function formatPhilippinePeso(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value || 0)
}

export default function ServiceXenditModal({ isOpen, request, onClose, onSuccess }: Props) {
  const [starting, setStarting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paidConfirmed, setPaidConfirmed] = useState(false)
  // Only used to confirm the shop has an active receiver before checkout.
  const [paymentMethods, setPaymentMethods] = useState<ServicePaymentMethod[]>([])
  const [loadingMethods, setLoadingMethods] = useState(false)
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<ServicePaymentOption | ''>('')

  useEffect(() => {
    if (isOpen) {
      setStarting(false)
      setSyncing(false)
      setCheckoutUrl(null)
      setError(null)
      setPaymentMethods([])
      setPaidConfirmed(request?.status === 'payment_verified')
      if (request) {
        const fullPrice = Number(request.productFullPrice ?? request.productPrice) || 0
        const downpaymentAmount = Number(request.downpaymentAmountSnapshot) || 0
        const hasDownpayment = downpaymentAmount > 0 && downpaymentAmount <= fullPrice
        const savedOption = request.paymentOption === 'full' || request.paymentOption === 'downpayment'
          ? request.paymentOption
          : ''
        setSelectedPaymentOption(request.providerCheckoutId ? savedOption : hasDownpayment ? '' : 'full')
      }
    }
  }, [isOpen, request])

  useEffect(() => {
    if (!isOpen || !request?.id || request.status === 'payment_verified') return
    let active = true
    setLoadingMethods(true)
    void getServicePaymentMethods(request.id)
      .then(result => {
        if (!active) return
        setPaymentMethods(result.methods)
      })
      .catch(err => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Unable to load payment channels.')
      })
      .finally(() => {
        if (active) setLoadingMethods(false)
      })
    return () => { active = false }
  }, [isOpen, request?.id, request?.status])

  const totalAmount = useMemo(() => {
    const raw = request?.productFullPrice ?? request?.productPrice ?? 0
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''))
    return Number.isFinite(num) && num > 0 ? num : 0
  }, [request?.productFullPrice, request?.productPrice])

  const downpaymentAmount = Number(request?.downpaymentAmountSnapshot) || 0
  const downpaymentPercentage = Number(request?.downpaymentPercentageSnapshot) || 0
  const hasDownpayment = downpaymentAmount > 0 && downpaymentAmount <= totalAmount && downpaymentPercentage > 0
  const remainingAfterDownpayment = Math.max(0, totalAmount - downpaymentAmount)
  const amountToCharge = selectedPaymentOption === 'downpayment' ? downpaymentAmount : totalAmount
  const hasReceiver = paymentMethods.length > 0

  const checkStatus = useCallback(async (silent = false) => {
    if (!request?.id || syncing) return
    if (!silent) setSyncing(true)
    setError(null)
    try {
      const result = await syncServiceXenditCheckout(request.id)
      if (result.paid || result.status === 'payment_verified') {
        setPaidConfirmed(true)
        onSuccess?.()
      } else if (['expired', 'canceled'].includes(String(result.status || '').toLowerCase())) {
        setCheckoutUrl(null)
        if (!silent) {
          setError('That checkout session expired. Start a new payment below to continue.')
        }
      } else if (!silent) {
        setError('Payment has not been confirmed yet. If you just completed checkout, wait a few seconds and try again.')
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unable to check payment status.')
      }
    } finally {
      if (!silent) setSyncing(false)
    }
  }, [request?.id, syncing, onSuccess])

  useEffect(() => {
    if (!isOpen || !request || paidConfirmed) return

    const onFocus = () => {
      if (checkoutUrl) {
        void checkStatus(true)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && checkoutUrl) {
        void checkStatus(true)
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isOpen, request, checkoutUrl, paidConfirmed, checkStatus])

  const handleStartPay = async () => {
    if (!request?.id || !hasReceiver || !selectedPaymentOption || starting) return
    setStarting(true)
    setError(null)

    try {
      const prepared = await prepareServicePaymentOption(request.id, selectedPaymentOption)
      if (prepared.paid) {
        setPaidConfirmed(true)
        onSuccess?.()
        return
      }
      if (!prepared.checkoutActive || prepared.paymentOption !== selectedPaymentOption) {
        await chooseServicePaymentOption(request.id, selectedPaymentOption)
      }
      const result = await createServiceXenditCheckout(request.id)
      if (result.paid || result.status === 'payment_verified') {
        setPaidConfirmed(true)
        onSuccess?.()
        return
      }

      if (!result.checkoutUrl) {
        throw new Error('Checkout link is unavailable.')
      }

      setCheckoutUrl(result.checkoutUrl)
      window.open(result.checkoutUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start online payment.')
    } finally {
      setStarting(false)
    }
  }

  if (!isOpen || !request) return null

  return (
    <div className="sxm-overlay" onClick={() => !starting && onClose()} role="dialog" aria-modal="true" aria-labelledby="sxm-dialog-title">
      <div className="sxm-modal" onClick={e => e.stopPropagation()}>
        <div className="sxm-sheet-handle" aria-hidden="true" />

        <div className="sxm-header">
          <div className="sxm-header-copy">
            <h2 id="sxm-dialog-title" className="sxm-header-title">Online Payment</h2>
            <p className="sxm-header-subtitle">
              {hasDownpayment ? 'Choose your payment option to continue' : 'Review the amount and continue to checkout'}
            </p>
          </div>
          <button
            type="button"
            className="sxm-close-btn"
            onClick={onClose}
            disabled={starting}
            aria-label="Close payment"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {paidConfirmed ? (
          <div className="sxm-success-box">
            <div className="sxm-success-badge" aria-hidden="true">✓</div>
            <h3 className="sxm-success-title">
              {selectedPaymentOption === 'downpayment' ? 'Downpayment Confirmed' : 'Payment Confirmed'}
            </h3>
            <p className="sxm-success-desc">
              Your payment for <strong>{request.productName || 'this service request'}</strong> has been confirmed. The funeral shop has been notified.
            </p>
            <button
              type="button"
              className="sxm-pay-btn"
              style={{ marginTop: 12 }}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        ) : (
          <>
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
                <div className="sxm-breakdown-row">
                  <span>Total service price</span>
                  <strong>{formatPhilippinePeso(totalAmount)}</strong>
                </div>
                {selectedPaymentOption === 'downpayment' ? (
                  <>
                    <div className="sxm-breakdown-row">
                      <span>Downpayment ({downpaymentPercentage}%)</span>
                      <strong>{formatPhilippinePeso(downpaymentAmount)}</strong>
                    </div>
                    <div className="sxm-breakdown-row">
                      <span>Remaining balance</span>
                      <strong>{formatPhilippinePeso(remainingAfterDownpayment)}</strong>
                    </div>
                  </>
                ) : null}
                <div className="sxm-due-row">
                  <span>{selectedPaymentOption === 'downpayment' ? 'Downpayment due now' : 'Amount due now'}</span>
                  <strong>{selectedPaymentOption ? formatPhilippinePeso(amountToCharge) : formatPhilippinePeso(totalAmount)}</strong>
                </div>
              </div>
            </div>

            {hasDownpayment ? (
              <section className="sxm-section-block" aria-labelledby="sxm-payment-option-title">
                <div className="sxm-section-header">
                  <h3 id="sxm-payment-option-title" className="sxm-section-label">PAYMENT OPTION</h3>
                </div>
                <div className="sxm-option-group" role="radiogroup" aria-label="Payment option">
                  <button
                    type="button"
                    className={`sxm-option-item${selectedPaymentOption === 'full' ? ' is-selected' : ''}`}
                    onClick={() => setSelectedPaymentOption('full')}
                    role="radio"
                    aria-checked={selectedPaymentOption === 'full'}
                  >
                    <span className="sxm-option-copy">
                      <span className="sxm-option-title-row">
                        <strong>Full payment</strong>
                        <b>{formatPhilippinePeso(totalAmount)}</b>
                      </span>
                      <small>Settle the entire service price now</small>
                    </span>
                    <i className="sxm-radio-indicator" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    className={`sxm-option-item${selectedPaymentOption === 'downpayment' ? ' is-selected' : ''}`}
                    onClick={() => setSelectedPaymentOption('downpayment')}
                    role="radio"
                    aria-checked={selectedPaymentOption === 'downpayment'}
                  >
                    <span className="sxm-option-copy">
                      <span className="sxm-option-title-row">
                        <strong>Downpayment ({downpaymentPercentage}%)</strong>
                        <b>{formatPhilippinePeso(downpaymentAmount)}</b>
                      </span>
                      <small>Remaining balance: {formatPhilippinePeso(remainingAfterDownpayment)}</small>
                    </span>
                    <i className="sxm-radio-indicator" aria-hidden="true" />
                  </button>
                </div>
              </section>
            ) : null}

            {!loadingMethods && paymentMethods.length === 0 && !error ? (
              <div className="sxm-banner-notice warning" role="status">
                Online checkout is unavailable for this shop right now.
              </div>
            ) : null}

            {error ? (
              <div className="sxm-banner-notice warning" role="alert">
                {error}
              </div>
            ) : null}

            {checkoutUrl && !error ? (
              <div className="sxm-banner-notice info">
                Checkout is open. Complete your payment there, then return here to confirm.
              </div>
            ) : null}

            <div className="sxm-actions">
              {!checkoutUrl ? (
                <button
                  type="button"
                  className="sxm-pay-btn"
                  disabled={starting || loadingMethods || !hasReceiver || !selectedPaymentOption || amountToCharge <= 0}
                  onClick={() => void handleStartPay()}
                >
                  {starting ? (
                    <>
                      <div className="sxm-spinner" />
                      <span>Opening checkout…</span>
                    </>
                  ) : (
                    <span>
                      {!selectedPaymentOption
                        ? 'Select payment option'
                        : `Pay ${formatPhilippinePeso(amountToCharge)} online`}
                    </span>
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="sxm-pay-btn"
                    disabled={syncing}
                    onClick={() => void checkStatus(false)}
                  >
                    {syncing ? (
                      <>
                        <div className="sxm-spinner" />
                        <span>Checking payment status…</span>
                      </>
                    ) : (
                      <span>Confirm payment status</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="sxm-reopen-link"
                    disabled={starting}
                    onClick={() => void handleStartPay()}
                  >
                    {starting ? 'Opening checkout…' : 'Open checkout tab again'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
