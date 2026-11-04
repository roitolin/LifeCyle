import { useState, type ReactNode } from 'react'
import { formatSubscriptionDate } from '@/utils/subscription'
import { PAYOUT_CHANNEL_LOGOS } from '@/assets/paymentLogoAssets'
import type { PaymentSubmission } from './AdminPaymentsPage'
import '../SellerServiceRequestPage.css'

function formatPeso(value: number | string | null | undefined) {
  const amount = Number(String(value ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return '—'
  return `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not provided'
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sr-detail-row">
      <dt>{label}</dt>
      <dd>{value || 'Not provided'}</dd>
    </div>
  )
}

function getPaymentMethodInfo(payment: PaymentSubmission) {
  const rawMethod = payment.providerPaymentMethod?.trim().toUpperCase() || ''
  const logo = (rawMethod && PAYOUT_CHANNEL_LOGOS[rawMethod])
    || (payment.gcashNumber || payment.gcashName ? PAYOUT_CHANNEL_LOGOS['PH_GCASH'] : null)

  let label = 'Online payment'
  if (rawMethod === 'PH_GCASH') label = 'GCash'
  else if (rawMethod === 'PH_MAYA') label = 'Maya'
  else if (rawMethod === 'PH_BDO') label = 'BDO'
  else if (rawMethod === 'PH_BPI') label = 'BPI'
  else if (rawMethod === 'PH_METROBANK') label = 'Metrobank'
  else if (rawMethod) label = rawMethod.replace(/^PH_/i, '').replace(/_/g, ' ')
  else if (payment.gcashNumber || payment.gcashName) label = 'GCash'
  else if (payment.paymentProvider === 'manual') label = 'Manual transfer'

  return { label, logo }
}

type Props = {
  payment: PaymentSubmission
  busy: boolean
  onClose: () => void
  onVerify: () => void
  onReject: () => void
}

function AdminShopPaymentReceipt({ payment, busy, onClose, onVerify, onReject }: Props) {
  const [proofOpen, setProofOpen] = useState(false)
  const normalizedStatus = String(payment.status || 'pending').toLowerCase()
  const isHostedCheckout = payment.paymentProvider === 'xendit' || payment.paymentProvider === 'legacy'
  const methodInfo = getPaymentMethodInfo(payment)

  const receiptMeta = normalizedStatus === 'verified'
    ? {
        title: 'Payment Confirmed',
        message: 'This shop registration payment has been confirmed.',
        tone: 'verified',
        amountLabel: 'Received',
      }
    : normalizedStatus === 'rejected'
      ? {
          title: 'Payment Needs Correction',
          message: 'The submission was returned to the seller with a review note.',
          tone: 'review',
          amountLabel: 'Amount',
        }
      : {
          title: isHostedCheckout ? 'Checkout Pending' : 'Payment Under Review',
          message: isHostedCheckout
            ? 'The payment will be confirmed automatically once checkout is completed.'
            : 'Check the seller information and submitted proof before verifying.',
          tone: 'review',
          amountLabel: 'Amount',
        }

  return (
    <>
      <div className="sr-receipt-modal-overlay admin-shop-receipt-overlay" role="presentation" onClick={onClose}>
        <div
          className="sr-receipt-modal admin-shop-receipt-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-shop-receipt-title"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="sr-receipt-modal-close" aria-label="Close payment receipt" onClick={onClose}>×</button>

          <section className="sr-payment-receipt">
            <div className={`sr-receipt-hero sr-receipt-hero-${receiptMeta.tone}`}>
              <div className="sr-receipt-status-icon" aria-hidden="true">
                {normalizedStatus === 'verified'
                  ? <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                  : <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>}
              </div>
              <div className="sr-receipt-hero-copy">
                <h2 id="admin-shop-receipt-title">{receiptMeta.title}</h2>
                <p>{receiptMeta.message}</p>
              </div>
              <div className="sr-receipt-amount">
                <span>{receiptMeta.amountLabel}</span>
                <strong>{formatPeso(payment.amount)}</strong>
              </div>
            </div>

            <div className="sr-receipt-body">
              <section className="sr-receipt-section">
                <h3>Submission details</h3>
                <dl className="sr-receipt-order-grid">
                  <div>
                    <dt>Submitted</dt>
                    <dd>{formatTimestamp(payment.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Payment ID</dt>
                    <dd>#{payment.id.slice(0, 10).toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Funeral shop</dt>
                    <dd>{payment.shopName || 'Not provided'}</dd>
                  </div>
                </dl>
              </section>

              <section className="sr-receipt-service admin-shop-receipt-service">
                <div className="sr-receipt-service-image sr-receipt-service-fallback" aria-hidden="true">LC</div>
                <div>
                  <strong>{payment.shopName || 'Funeral shop registration'}</strong>
                  <span>Shop registration payment</span>
                  <span>{payment.ownerFullName || payment.ownerEmail || 'Seller account'}</span>
                </div>
                <b>{formatPeso(payment.amount)}</b>
              </section>

              <section className="sr-receipt-section sr-receipt-info">
                <h3>Receipt information</h3>
                <dl className="sr-detail-list">
                  <DetailRow
                    label="Payment method"
                    value={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {methodInfo.logo ? (
                          <img
                            src={methodInfo.logo}
                            alt=""
                            style={{ height: 18, width: 'auto', objectFit: 'contain' }}
                          />
                        ) : null}
                        <span>{methodInfo.label}</span>
                      </span>
                    }
                  />
                  <DetailRow label="Payer" value={payment.payerName || payment.ownerFullName || 'Not provided'} />
                  {payment.gcashName ? <DetailRow label="Account name" value={payment.gcashName} /> : null}
                  {payment.gcashNumber ? <DetailRow label="Account number" value={payment.gcashNumber} /> : null}
                  <DetailRow label="Reference number" value={payment.referenceNumber || payment.providerPaymentId || `#PAY-${payment.id.slice(0, 8).toUpperCase()}`} />
                  <DetailRow label="Seller email" value={payment.ownerEmail || 'Not provided'} />
                  <DetailRow label="Status" value={receiptMeta.title} />
                  {payment.verifiedAt ? <DetailRow label="Verified" value={formatTimestamp(payment.verifiedAt)} /> : null}
                  {normalizedStatus === 'verified' ? (
                    <DetailRow label="Live access valid until" value={formatSubscriptionDate(payment.expiresAt)} />
                  ) : null}
                </dl>
              </section>

              {payment.rejectionReason ? (
                <div className="sr-inline-alert sr-inline-alert-danger">
                  <strong>Review note</strong>
                  <p>{payment.rejectionReason}</p>
                </div>
              ) : null}

              {!isHostedCheckout ? (
                <section className="sr-receipt-proof">
                  <div>
                    <h3>Submitted receipt</h3>
                    <span>{payment.proofImageUrl ? 'Select the image to view it full size.' : 'No receipt was attached.'}</span>
                  </div>
                  {payment.proofImageUrl ? (
                    <button type="button" onClick={() => setProofOpen(true)} aria-label="View submitted receipt full size">
                      <img src={payment.proofImageUrl} alt="Submitted shop payment receipt" />
                    </button>
                  ) : (
                    <div className="sr-receipt-missing">
                      <strong>Receipt unavailable</strong>
                      <span>No payment proof is attached to this submission.</span>
                    </div>
                  )}
                </section>
              ) : null}

              <footer className="admin-shop-receipt-actions">
                <button type="button" className="ghost-btn" onClick={onClose}>Close</button>
                {normalizedStatus === 'pending' && !isHostedCheckout ? (
                  <>
                    <button type="button" className="ghost-btn admin-shop-receipt-reject" disabled={busy} onClick={onReject}>Reject</button>
                    <button type="button" className="solid-btn" disabled={busy} onClick={onVerify}>
                      {busy ? 'Verifying...' : 'Verify payment'}
                    </button>
                  </>
                ) : null}
              </footer>
            </div>
          </section>
        </div>
      </div>

      {proofOpen && payment.proofImageUrl ? (
        <div className="sr-lightbox admin-shop-receipt-lightbox" role="presentation" onClick={() => setProofOpen(false)}>
          <button type="button" aria-label="Close receipt image" onClick={() => setProofOpen(false)}>×</button>
          <img src={payment.proofImageUrl} alt="Full-size submitted receipt" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  )
}

export default AdminShopPaymentReceipt
