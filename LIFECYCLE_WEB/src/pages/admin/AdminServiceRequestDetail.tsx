import { useMemo, useState, type ReactNode } from 'react'
import type { ServiceRequest } from './AdminOrdersPage'
import '../SellerServiceRequestPage.css'
import './AdminOrdersPage.css'

type StatusMeta = {
  label: string
  detail: string
  tone: 'neutral' | 'warning' | 'success' | 'info' | 'danger'
}

const STATUS_META: Record<string, StatusMeta> = {
  pending_shop_acceptance: { label: 'Needs response', detail: 'The request is waiting for the funeral shop to respond.', tone: 'warning' },
  accepted_by_shop: { label: 'Accepted', detail: 'The funeral shop accepted this arrangement request.', tone: 'info' },
  awaiting_payment: { label: 'Awaiting payment', detail: 'The family can review the shop payment instructions.', tone: 'neutral' },
  payment_submitted: { label: 'Payment submitted', detail: 'A payment receipt has been submitted for shop review.', tone: 'warning' },
  payment_verified: { label: 'In service', detail: 'Payment is verified and the arrangement is in progress.', tone: 'success' },
  awaiting_customer_confirmation: { label: 'Family confirmation', detail: 'Completion proof was sent to the family for confirmation.', tone: 'info' },
  completed: { label: 'Completed', detail: 'This arrangement case has been completed.', tone: 'success' },
  declined_by_shop: { label: 'Declined', detail: 'The funeral shop declined this request.', tone: 'danger' },
  cancelled: { label: 'Cancelled', detail: 'This arrangement request was cancelled.', tone: 'danger' },
  cancelled_by_requester: { label: 'Cancelled', detail: 'The family cancelled this request.', tone: 'danger' },
}

function titleCase(value: string | null | undefined) {
  if (!value) return 'Standard service'
  return value.replace(/_/g, ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase())
}

function formatPeso(value: string | number | null | undefined) {
  const amount = Number(String(value ?? '').replace(/[^\\d.]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 }).format(amount)}`
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

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not provided'
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(value)
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not provided'
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTime(value: string | null | undefined) {
  if (!value) return 'Not provided'
  const match = /^(\\d{1,2}):(\\d{2})/.exec(value)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return value
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function DetailList({ children }: { children: ReactNode }) {
  return <dl className="sr-detail-list">{children}</dl>
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sr-detail-row">
      <dt>{label}</dt>
      <dd>{value || 'Not provided'}</dd>
    </div>
  )
}

type Props = {
  request: ServiceRequest
  onClose: () => void
}

function AdminServiceRequestDetail({ request, onClose }: Props) {
  const [paymentReceiptOpen, setPaymentReceiptOpen] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const normalizedStatus = String(request.status || '').toLowerCase()
  const meta = STATUS_META[normalizedStatus] || {
    label: titleCase(normalizedStatus || 'Unknown status'),
    detail: 'Review the recorded information for this arrangement request.',
    tone: 'neutral' as const,
  }
  const hasSchedule = Boolean(
    request.wakeAddress || request.churchName || request.cemeteryName
    || request.wakeStartDate || request.wakeEndDate || request.burialTime || request.pickupAddress,
  )
  const hasPayment = Boolean(
    request.paymentAmount
      || request.paymentPayerName
      || request.paymentGcashName
      || request.paymentGcashNumber
      || request.paymentReferenceNumber
      || request.paymentProofImageUrl
      || request.paymentSubmittedAt,
  )
  const receiptMeta = ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(normalizedStatus)
    ? {
        title: normalizedStatus === 'completed' ? 'Payment complete' : 'Payment verified',
        message: 'This family payment was reviewed and confirmed by the funeral shop.',
        tone: 'verified',
      }
    : normalizedStatus === 'payment_submitted'
      ? {
          title: 'Payment under review',
          message: 'The submitted payment is waiting for the funeral shop to review it.',
          tone: 'review',
        }
      : {
          title: 'Family payment',
          message: 'Available payment and receipt information for this request.',
          tone: 'default',
        }
  const timeline = useMemo(() => [
    { label: 'Request created', value: request.createdAt },
    { label: 'Shop responded', value: request.shopRespondedAt || request.acceptedAt || request.declinedAt },
    { label: 'Payment submitted', value: request.paymentSubmittedAt },
    { label: 'Payment verified', value: request.paymentVerifiedAt },
    { label: 'Sent for family confirmation', value: request.shopMarkedCompletedAt },
    { label: 'Request completed', value: request.completedAt },
    { label: 'Request cancelled', value: request.cancelledAt },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value)), [request])

  return (
    <>
      <div className="admin-order-detail-page">
        <section
          className="sr-page admin-order-detail-surface"
          aria-labelledby="admin-service-request-title"
        >
          <header className="admin-order-detail-toolbar">
            <button type="button" className="admin-order-back" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18 9 12l6-6" /></svg>
              Back to All Service Requests
            </button>
            <span>Arrangement case #{request.id.slice(0, 8).toUpperCase()}</span>
          </header>

          <main className="sr-main">
            <section className="sr-case-header">
              <div>
                <span className="sr-document-kicker">LifeCycle Funeral Services</span>
                <h1 id="admin-service-request-title">Service Request Record</h1>
                <p>Arrangement case #{request.id.slice(0, 8).toUpperCase()} · Filed {formatTimestamp(request.createdAt)}</p>
              </div>
              <div className={`sr-status sr-status-${meta.tone}`} role="status">
                <span aria-hidden="true" />
                <strong>{meta.label}</strong>
              </div>
            </section>

            <div className="sr-layout">
              <div className="sr-primary-column">
                <section className="sr-card sr-product-card">
                  <div className="sr-record-overview">
                    {request.memorialPhotoUrl ? (
                      <button
                        type="button"
                        className="sr-deceased-photo"
                        onClick={() => setLightboxUrl(request.memorialPhotoUrl as string)}
                        aria-label="View deceased photo"
                      >
                        <img src={request.memorialPhotoUrl} alt={request.deceasedFullName || 'Deceased'} />
                      </button>
                    ) : (
                      <div className="sr-deceased-photo sr-deceased-photo-empty"><span>No photo</span></div>
                    )}

                    <div className="sr-record-person">
                      <span>Deceased</span>
                      <h2>{request.deceasedFullName || 'Name not provided'}</h2>
                      <dl>
                        <div><dt>Date of passing</dt><dd>{formatDate(request.deceasedDateOfPassing)}</dd></div>
                        <div><dt>Age</dt><dd>{request.deceasedAge ?? 'Not provided'}</dd></div>
                        <div><dt>Requestor</dt><dd>{request.familyCoordinatorName || request.requesterName || 'Not provided'}</dd></div>
                      </dl>
                    </div>

                    <div className="sr-record-service">
                      <span>Requested service</span>
                      <div>
                        {request.productImageUrl ? (
                          <button type="button" onClick={() => setLightboxUrl(request.productImageUrl as string)} aria-label="View requested service image">
                            <img src={request.productImageUrl} alt="" />
                          </button>
                        ) : null}
                        <div>
                          <strong>{request.productName || 'Custom casket service'}</strong>
                          <small>{request.variationName || titleCase(request.requestType)}</small>
                          {request.packageItems?.length ? <small>Packages: {request.packageItems.join(', ')}</small> : null}
                          <b>{request.productPrice != null ? formatPeso(request.productPrice) : 'Custom pricing'}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                  {request.customDesignNotes ? (
                    <div className="sr-note"><span>Custom design notes</span><p>{request.customDesignNotes}</p></div>
                  ) : null}
                </section>

                <div className="sr-card-grid">
                  <section className="sr-card">
                    <div className="sr-section-heading"><h2>Family contact</h2></div>
                    <DetailList>
                      <DetailRow label="Requestor" value={request.familyCoordinatorName || request.requesterName || 'Not provided'} />
                      <DetailRow label="Email" value={request.requesterEmail || 'Not provided'} />
                      <DetailRow label="Contact number" value={request.contactNumber || 'Not provided'} />
                    </DetailList>
                  </section>
                  <section className="sr-card">
                    <div className="sr-section-heading"><h2>Deceased information</h2></div>
                    <DetailList>
                      <DetailRow label="Full name" value={request.deceasedFullName || 'Not provided'} />
                      <DetailRow label="Date of birth" value={formatDate(request.deceasedDateOfBirth)} />
                      <DetailRow label="Date of passing" value={formatDate(request.deceasedDateOfPassing)} />
                      <DetailRow label="Age" value={request.deceasedAge ?? 'Not provided'} />
                    </DetailList>
                  </section>
                </div>

                {hasSchedule ? (
                  <section className="sr-card">
                    <div className="sr-section-heading"><h2>Schedule and logistics</h2></div>
                    <DetailList>
                      <DetailRow label="Wake venue" value={request.wakeAddress || 'Not provided'} />
                      <DetailRow label="Church / chapel" value={request.churchName || 'Not provided'} />
                      <DetailRow label="Cemetery" value={request.cemeteryName || 'Not provided'} />
                      <DetailRow
                        label="Wake schedule"
                        value={request.wakeStartDate || request.wakeEndDate
                          ? `${formatDate(request.wakeStartDate)} to ${formatDate(request.wakeEndDate)}`
                          : 'Not provided'}
                      />
                      <DetailRow label="Burial time" value={formatTime(request.burialTime)} />
                      <DetailRow label="Pickup address" value={request.pickupAddress || 'Not provided'} />
                    </DetailList>
                  </section>
                ) : null}

                {request.tributeMessage ? (
                  <section className="sr-card sr-tribute"><span>Tribute message</span><blockquote>{request.tributeMessage}</blockquote></section>
                ) : null}

                {hasPayment ? (
                  <section className="sr-card sr-payment-summary">
                    <div className="sr-section-heading"><h2>Payment</h2></div>
                    <dl>
                      <div><dt>Status</dt><dd>{receiptMeta.title}</dd></div>
                      <div><dt>Amount</dt><dd>{formatPeso(request.paymentAmount)}</dd></div>
                      <div><dt>Reference number</dt><dd>{request.paymentReferenceNumber || 'Not provided'}</dd></div>
                      <div><dt>Submitted</dt><dd>{formatTimestamp(request.paymentSubmittedAt)}</dd></div>
                    </dl>
                    <button type="button" className="sr-view-receipt" onClick={() => setPaymentReceiptOpen(true)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>
                      View payment receipt
                    </button>
                  </section>
                ) : null}
              </div>

              <aside className="sr-side-column">
                <section className="sr-card sr-action-card">
                  <div className="sr-section-heading"><h2>Case status</h2></div>
                  <p className="sr-action-help">{meta.detail}</p>
                  <div className="sr-inline-alert">
                    <strong>Administrator view</strong>
                    <p>This record mirrors the request details available in the Shop Centre.</p>
                  </div>
                </section>

                <section className="sr-card">
                  <div className="sr-section-heading"><h2>Shop</h2></div>
                  <DetailList>
                    <DetailRow label="Funeral shop" value={request.shopName || request.shopId || 'Not provided'} />
                    <DetailRow label="Contact number" value={request.shopContactNumber || 'Not provided'} />
                    <DetailRow label="Address" value={request.shopAddress || 'Not provided'} />
                  </DetailList>
                </section>

                {request.completionProofImageUrl ? (
                  <section className="sr-card">
                    <div className="sr-section-heading"><h2>Completion proof</h2></div>
                    <button type="button" className="sr-completion-proof" onClick={() => setLightboxUrl(request.completionProofImageUrl as string)}>
                      <img src={request.completionProofImageUrl} alt="Completion proof" />
                      <span>Open full image</span>
                    </button>
                  </section>
                ) : null}

                <section className="sr-card">
                  <div className="sr-section-heading"><h2>Activity</h2></div>
                  {timeline.length ? (
                    <ol className="sr-timeline">
                      {timeline.map((item, index) => (
                        <li key={`${item.label}-${item.value}`} className={index === timeline.length - 1 ? 'current' : ''}>
                          <span aria-hidden="true" />
                          <div><strong>{item.label}</strong><time>{formatTimestamp(item.value)}</time></div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="sr-empty-copy">No case activity has been recorded yet.</p>
                  )}
                </section>
              </aside>
            </div>
          </main>
        </section>
      </div>

      {paymentReceiptOpen && hasPayment ? (
        <div className="sr-receipt-modal-overlay admin-receipt-overlay" role="presentation" onClick={() => setPaymentReceiptOpen(false)}>
          <div className="sr-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="admin-payment-receipt-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="sr-receipt-modal-close" aria-label="Close payment receipt" onClick={() => setPaymentReceiptOpen(false)}>×</button>
            <section className="sr-payment-receipt">
              <div className={`sr-receipt-hero sr-receipt-hero-${receiptMeta.tone}`}>
                <div className="sr-receipt-status-icon" aria-hidden="true">
                  {receiptMeta.tone === 'verified'
                    ? <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                    : <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>}
                </div>
                <div className="sr-receipt-hero-copy"><h2 id="admin-payment-receipt-title">{receiptMeta.title}</h2><p>{receiptMeta.message}</p></div>
                <div className="sr-receipt-amount"><span>{receiptMeta.tone === 'verified' ? 'Received' : 'Amount'}</span><strong>{formatPeso(request.paymentAmount)}</strong></div>
              </div>

              <div className="sr-receipt-body">
                <section className="sr-receipt-section">
                  <h3>Order details</h3>
                  <dl className="sr-receipt-order-grid">
                    <div><dt>Order date</dt><dd>{formatTimestamp(request.paymentSubmittedAt || request.createdAt)}</dd></div>
                    <div><dt>Order ID</dt><dd>#{request.id.slice(0, 10).toUpperCase()}</dd></div>
                    <div><dt>Service address</dt><dd>{request.wakeAddress || 'Not provided'}</dd></div>
                  </dl>
                </section>

                <section className="sr-receipt-service">
                  {request.productImageUrl ? (
                    <button type="button" className="sr-receipt-service-image" onClick={() => setLightboxUrl(request.productImageUrl as string)}>
                      <img src={request.productImageUrl} alt="" />
                    </button>
                  ) : <div className="sr-receipt-service-image sr-receipt-service-fallback" aria-hidden="true">LC</div>}
                  <div>
                    <strong>{request.productName || 'Funeral service'}</strong>
                    <span>{request.variationName || 'Service arrangement'}</span>
                    <span>{request.deceasedFullName || 'Family service'}</span>
                  </div>
                  <b>{formatPeso(request.paymentAmount)}</b>
                </section>

                <section className="sr-receipt-section sr-receipt-info">
                  <h3>Receipt information</h3>
                  <DetailList>
                    <DetailRow label="Payment method" value="GCash / E-wallet" />
                    <DetailRow label="Sender" value={request.paymentPayerName || request.familyCoordinatorName || 'Not provided'} />
                    <DetailRow label="GCash name" value={request.paymentGcashName || 'Not provided'} />
                    <DetailRow label="GCash number" value={request.paymentGcashNumber || 'Not provided'} />
                    <DetailRow label="Reference number" value={request.paymentReferenceNumber || 'Not provided'} />
                    <DetailRow label="Amount" value={formatPeso(request.paymentAmount)} />
                    {request.paymentVerifiedAt ? <DetailRow label="Verified" value={formatTimestamp(request.paymentVerifiedAt)} /> : null}
                  </DetailList>
                </section>

                {request.paymentRejectionReason ? (
                  <div className="sr-inline-alert sr-inline-alert-danger"><strong>Previous review note</strong><p>{request.paymentRejectionReason}</p></div>
                ) : null}

                <section className="sr-receipt-proof">
                  <div><h3>Submitted receipt</h3><span>{request.paymentProofImageUrl ? 'Select the image to view it full size.' : 'No receipt was attached.'}</span></div>
                  {request.paymentProofImageUrl ? (
                    <button type="button" onClick={() => setLightboxUrl(request.paymentProofImageUrl as string)}>
                      <img src={request.paymentProofImageUrl} alt="Submitted payment receipt" />
                    </button>
                  ) : (
                    <div className="sr-receipt-missing"><strong>Receipt unavailable</strong><span>No payment proof is attached to this request.</span></div>
                  )}
                </section>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {lightboxUrl ? (
        <div className="sr-lightbox admin-order-lightbox" role="presentation" onClick={() => setLightboxUrl(null)}>
          <button type="button" aria-label="Close image" onClick={() => setLightboxUrl(null)}>×</button>
          <img src={lightboxUrl} alt="Full-size case attachment" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  )
}

export default AdminServiceRequestDetail
