import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createServiceXenditCheckout,
  getServicePaymentMethods,
  syncServiceXenditCheckout,
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
  const [paymentMethods, setPaymentMethods] = useState<ServicePaymentMethod[]>([])
  const [selectedMethod, setSelectedMethod] = useState('')
  const [loadingMethods, setLoadingMethods] = useState(false)

  // Reset state on modal open/close
  useEffect(() => {
    if (isOpen) {
      setStarting(false)
      setSyncing(false)
      setCheckoutUrl(null)
      setError(null)
      setPaymentMethods([])
      setSelectedMethod('')
      setPaidConfirmed(request?.status === 'payment_verified')
    }
  }, [isOpen, request?.id, request?.status])

  useEffect(() => {
    if (!isOpen || !request?.id || request.status === 'payment_verified') return
    let active = true
    setLoadingMethods(true)
    void getServicePaymentMethods(request.id)
      .then(result => {
        if (!active) return
        setPaymentMethods(result.methods)
        const savedMethod = result.methods.some(method => method.code === result.selectedMethod)
          ? result.selectedMethod || ''
          : ''
        setSelectedMethod(savedMethod || (result.methods.length === 1 ? result.methods[0].code : ''))
      })
      .catch(err => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Unable to load the shop payment methods.')
      })
      .finally(() => {
        if (active) setLoadingMethods(false)
      })
    return () => { active = false }
  }, [isOpen, request?.id, request?.status])

  // Total numeric amount
  const totalAmount = useMemo(() => {
    const raw = request?.paymentAmount ?? request?.productPrice ?? 0
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.]/g, ''))
    return Number.isFinite(num) && num > 0 ? num : 0
  }, [request?.paymentAmount, request?.productPrice])

  // Sync status with edge function & backend
  const checkStatus = useCallback(async (silent = false) => {
    if (!request?.id || syncing) return
    if (!silent) setSyncing(true)
    setError(null)
    try {
      const result = await syncServiceXenditCheckout(request.id)
      if (result.paid || result.status === 'payment_verified') {
        setPaidConfirmed(true)
        onSuccess?.()
      } else if (!silent) {
        setError('Payment has not been confirmed yet. If you just completed checkout, please wait a few seconds and try again.')
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Unable to check payment status.')
      }
    } finally {
      if (!silent) setSyncing(false)
    }
  }, [request?.id, syncing, onSuccess])

  // Auto-sync when window gains focus (user returns from Xendit tab)
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

  // Start 1-Click Pay flow
  const handleStartPay = async () => {
    if (!request?.id || !selectedMethod || starting) return
    setStarting(true)
    setError(null)

    try {
      const result = await createServiceXenditCheckout(request.id, selectedMethod)
      if (result.paid || result.status === 'payment_verified') {
        setPaidConfirmed(true)
        onSuccess?.()
        return
      }

      if (!result.checkoutUrl) {
        throw new Error('Xendit checkout URL was not returned.')
      }

      setCheckoutUrl(result.checkoutUrl)
      // Open Xendit hosted checkout in a new browser tab
      window.open(result.checkoutUrl, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch Xendit checkout.')
    } finally {
      setStarting(false)
    }
  }

  if (!isOpen || !request) return null

  return (
    <div className="sxm-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sxm-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sxm-header">
          <div className="sxm-brand-row">
            <div>
              <span className="sxm-brand-title">LifeCycle</span>
              <span className="sxm-header-title">Secure payment</span>
            </div>
            <span className="sxm-secure-badge">Protected by Xendit</span>
          </div>
          <button
            type="button"
            className="sxm-close-btn"
            onClick={onClose}
            aria-label="Close checkout modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {paidConfirmed ? (
          /* Payment confirmed state */
          <div className="sxm-success-box">
            <div className="sxm-success-badge">✓</div>
            <h3 className="sxm-success-title">Payment Confirmed!</h3>
            <p className="sxm-success-desc">
              Your payment for <strong>{request.productName || 'this service request'}</strong> was verified directly with Xendit. The funeral shop has been notified to proceed.
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
          /* Checkout view */
          <>
            {/* Product card */}
            <div className="sxm-product-card">
              {request.productImageUrl ? (
                <img
                  src={request.productImageUrl}
                  alt={request.productName || 'Casket'}
                  className="sxm-product-img"
                />
              ) : (
                <div className="sxm-product-fallback">LC</div>
              )}
              <div className="sxm-product-info">
                <h4 className="sxm-product-name">{request.productName || 'Funeral Service / Casket'}</h4>
                <p className="sxm-product-shop">
                  <span>{request.shopName || 'Funeral Shop'}</span>
                </p>
                {request.variationName && (
                  <span className="sxm-variation-pill">Variation: {request.variationName}</span>
                )}
              </div>
            </div>

            {/* Order total */}
            <div className="sxm-summary-card">
              <div className="sxm-summary-row">
                <span>Order subtotal</span>
                <strong>{formatPhilippinePeso(totalAmount)}</strong>
              </div>
              <div className="sxm-summary-row">
                <span>Packages and services</span>
                <strong className="sxm-included">Included</strong>
              </div>
              <div className="sxm-summary-divider" />
              <div className="sxm-total-row">
                <div className="sxm-total-label-wrap">
                  <span>Total amount</span>
                  <small>Authorized and encrypted</small>
                </div>
                <strong className="sxm-total-amount">{formatPhilippinePeso(totalAmount)}</strong>
              </div>
            </div>

            <section className="sxm-method-section" aria-labelledby="sxm-method-title">
              <div className="sxm-method-heading">
                <div>
                  <p id="sxm-method-title">Xendit payment gateway</p>
                  <span>Choose a payment method configured by the shop.</span>
                </div>
                <span>Secure checkout</span>
              </div>

              {loadingMethods ? (
                <div className="sxm-method-loading"><div className="sxm-spinner dark" /> Loading payment methods…</div>
              ) : paymentMethods.length > 0 ? (
                <div className="sxm-method-options">
                  {paymentMethods.map(method => (
                    <button
                      type="button"
                      key={method.code}
                      className={`sxm-method-option${selectedMethod === method.code ? ' is-selected' : ''}`}
                      onClick={() => setSelectedMethod(method.code)}
                      aria-pressed={selectedMethod === method.code}
                    >
                      <span className="sxm-method-option-icon">{method.type === 'wallet' ? 'W' : 'B'}</span>
                      <span><strong>{method.label}</strong><small>{method.type === 'wallet' ? 'E-wallet' : 'Online bank transfer'}</small></span>
                      <i aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="sxm-no-methods">
                  This shop has no verified payment receiver account yet. Please contact the shop before paying.
                </div>
              )}
            </section>

            {/* Error or notice banner */}
            {error && (
              <div className="sxm-banner-notice warning">
                {error}
              </div>
            )}

            {checkoutUrl && !error && (
              <div className="sxm-banner-notice info">
                A secure Xendit checkout tab was opened. Complete your payment there, then return here to confirm.
              </div>
            )}

            {/* Action buttons */}
            <div className="sxm-actions">
              {!checkoutUrl ? (
                <button
                  type="button"
                  className="sxm-pay-btn"
                  disabled={starting || loadingMethods || !selectedMethod || totalAmount <= 0}
                  onClick={handleStartPay}
                >
                  {starting ? (
                    <>
                      <div className="sxm-spinner" />
                      <span>Connecting to Xendit...</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="11" width="14" height="10" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      <span>
                        {selectedMethod
                          ? 'Pay ' + formatPhilippinePeso(totalAmount) + ' with ' + (paymentMethods.find(method => method.code === selectedMethod)?.label || 'selected method')
                          : 'Select a payment method'}
                      </span>
                    </>
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
                        <span>Verifying with Xendit...</span>
                      </>
                    ) : (
                      <span>Confirm payment status</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="sxm-reopen-link"
                    onClick={() => window.open(checkoutUrl, '_blank', 'noopener,noreferrer')}
                  >
                    Reopen Xendit checkout tab
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
