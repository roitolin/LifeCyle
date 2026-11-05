import { useState, type ReactNode } from 'react'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { PAYOUT_CHANNEL_LOGOS } from '@/assets/paymentLogoAssets'
import { formatSubscriptionDate } from '@/utils/subscription'
import type { PaymentSubmission } from './AdminPaymentsPage'
import '../../components/XenditShopPaymentCard.css'

function peso(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value || 0)
}
function dateTime(value?: string | null) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not provided' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}
function Line({ label, value }: { label: string; value: ReactNode }) {
  return <div className="pm-receipt-line"><span>{label}</span><strong>{value || 'Not provided'}</strong></div>
}
function methodInfo(payment: PaymentSubmission) {
  const code = payment.providerPaymentMethod?.trim().toUpperCase() || ''
  const logo = PAYOUT_CHANNEL_LOGOS[code] || (payment.gcashNumber ? PAYOUT_CHANNEL_LOGOS.PH_GCASH : null)
  const labels: Record<string, string> = { PH_GCASH: 'GCash', PH_MAYA: 'Maya', PH_BDO: 'BDO', PH_BPI: 'BPI', PH_METROBANK: 'Metrobank' }
  return {
    logo,
    label: labels[code] || (code ? code.replace(/^PH_/, '').replace(/_/g, ' ') : payment.paymentProvider === 'manual' ? 'Manual transfer' : 'Online payment'),
  }
}

type Props = {
  payment: PaymentSubmission
  busy: boolean
  onClose: () => void
  onVerify: () => void
  onReject: () => void
}

export default function AdminShopPaymentReceipt({ payment, busy, onClose, onVerify, onReject }: Props) {
  const [proofOpen, setProofOpen] = useState(false)
  const status = String(payment.status || 'pending').toLowerCase()
  const hosted = payment.paymentProvider === 'xendit' || payment.paymentProvider === 'legacy'
  const method = methodInfo(payment)
  const title = status === 'verified' ? 'Payment Verified' : status === 'rejected' ? 'Payment Not Completed' : hosted ? 'Checkout Pending' : 'Payment Under Review'
  const message = status === 'verified'
    ? 'LifeCycle confirmed this shop registration payment.'
    : status === 'rejected'
      ? 'This submission was returned to the shop for correction.'
      : hosted
        ? 'The payment will be confirmed automatically once checkout is completed.'
        : 'Review the submitted proof before confirming this payment.'

  return <>
    <div className="pm-receipt-overlay" role="presentation" onMouseDown={onClose}>
      <section className="pm-receipt-modal admin-payment-receipt" role="dialog" aria-modal="true" aria-labelledby="admin-payment-receipt-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="pm-receipt-hero">
          <button type="button" className="pm-receipt-x" onClick={onClose} aria-label="Close payment receipt">×</button>
          <div className={`pm-receipt-status-icon ${status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : ''}`} aria-hidden="true">{status === 'verified' ? '✓' : status === 'rejected' ? '!' : '…'}</div>
          <h3 id="admin-payment-receipt-title">{title}</h3>
          <p>{message}</p>
          <div className="admin-receipt-hero-amount"><span>{status === 'verified' ? 'AMOUNT PAID' : 'AMOUNT'}</span><strong>{peso(payment.amount)}</strong></div>
        </header>

        <div className="pm-receipt-body">
          <h4>Payment Details</h4>
          <div className="pm-receipt-lines">
            <Line label={status === 'verified' ? 'Payment Date' : 'Submitted'} value={dateTime(payment.verifiedAt || payment.createdAt)} />
            <Line label="Receipt No." value={`LC-${payment.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`} />
            <Line label="Funeral Shop" value={payment.shopName || 'Funeral shop'} />
            {status === 'verified' && payment.expiresAt ? <Line label="Access Valid Until" value={formatSubscriptionDate(payment.expiresAt)} /> : null}
          </div>
          <div className="pm-receipt-divider" />
          <div className="pm-receipt-service">
            <img className="pm-receipt-logo" src={APP_ICON_TRANSPARENT_URL} alt="LifeCycle" />
            <div><strong>LifeCycle registration</strong><small>Funeral shop subscription payment</small><small>{payment.ownerFullName || payment.ownerEmail || 'Shop account'}</small></div>
            <b>{peso(payment.amount)}</b>
          </div>
          <div className="pm-receipt-divider" />
          <h4>Receipt Information</h4>
          <div className="pm-receipt-info">
            <Line label="Payment Method" value={<span className="admin-receipt-method">{method.logo ? <img src={method.logo} alt="" /> : null}{method.label}</span>} />
            <Line label="Paid By" value={payment.payerName || payment.ownerFullName || payment.shopName} />
            {payment.gcashName ? <Line label="Account Name" value={payment.gcashName} /> : null}
            {payment.gcashNumber ? <Line label="Account Number" value={payment.gcashNumber} /> : null}
            <Line label="Reference Number" value={payment.referenceNumber || payment.providerPaymentId || `#PAY-${payment.id.slice(0, 8).toUpperCase()}`} />
            <Line label="Seller Email" value={payment.ownerEmail} />
            <Line label="Status" value={title} />
            <Line label="Amount" value={peso(payment.amount)} />
            {payment.verifiedAt ? <Line label="Confirmed At" value={dateTime(payment.verifiedAt)} /> : null}
          </div>
          {hosted && status !== 'rejected' ? <div className={`pm-receipt-provider-note ${status === 'verified' ? 'verified' : 'pending'}`}><strong>{status === 'verified' ? 'Payment verified' : 'Confirmation pending'}</strong><span>{status === 'verified' ? 'Confirmed automatically after checkout.' : 'This receipt updates after the payment is confirmed.'}</span></div> : null}
          {payment.rejectionReason ? <div className="pm-receipt-error"><strong>Review note</strong><p>{payment.rejectionReason}</p></div> : null}
          {!hosted ? <div className="admin-receipt-proof"><h4>Submitted Proof</h4>{payment.proofImageUrl ? <button type="button" onClick={() => setProofOpen(true)} aria-label="View submitted payment proof"><img src={payment.proofImageUrl} alt="Submitted payment proof" /><span>View full image</span></button> : <p>No payment proof is attached.</p>}</div> : null}
          {status === 'pending' && !hosted ? <div className="admin-receipt-review-actions"><button type="button" className="ghost-btn" disabled={busy} onClick={onReject}>Reject</button><button type="button" className="solid-btn" disabled={busy} onClick={onVerify}>{busy ? 'Verifying...' : 'Verify Payment'}</button></div> : null}
          <button type="button" className="pm-receipt-secondary" onClick={onClose}>Close Receipt</button>
        </div>
      </section>
    </div>
    {proofOpen && payment.proofImageUrl ? <div className="admin-receipt-lightbox" role="presentation" onClick={() => setProofOpen(false)}><button type="button" onClick={() => setProofOpen(false)} aria-label="Close payment proof">×</button><img src={payment.proofImageUrl} alt="Full-size submitted payment proof" onClick={(event) => event.stopPropagation()} /></div> : null}
  </>
}
