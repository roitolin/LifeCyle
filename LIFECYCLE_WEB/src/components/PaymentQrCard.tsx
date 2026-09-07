import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getPaymentQrSetting, type PaymentQrSetting } from '@/utils/paymentQrSettings'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { createAdminNotification } from '@/utils/createAdminNotification'
import './PaymentQrCard.css'

function formatPeso(value: number): string {
  return `₱${(value || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

type PaymentQrCardProps = {
  title?: string
  description?: string
  className?: string
  onSuccess?: () => void
}

function formatPaymentDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

type ShopPayment = {
  id: string
  status: 'pending' | 'verified' | 'rejected'
  amount: number
  payerName: string
  gcashName: string
  gcashNumber: string
  referenceNumber: string
  proofImageUrl: string | null
  rejectionReason: string | null
  createdAt: string
  verifiedAt: string | null
  expiresAt: string | null
}

function paymentStatusLabel(status: ShopPayment['status']) {
  if (status === 'verified') return 'Verified'
  if (status === 'rejected') return 'Rejected'
  return 'Pending review'
}

export default function PaymentQrCard({
  title = 'Pay Your Registration Fee',
  description = 'Your shop has been verified. Scan the QR code to pay, fill in your details, and attach a screenshot as proof of payment.',
  className,
  onSuccess,
}: PaymentQrCardProps) {
  const { openAlert, alertDialog } = useAlertDialog()
  const [setting, setSetting] = useState<PaymentQrSetting | null>(null)
  const [ready, setReady] = useState(false)
  const [payerName, setPayerName] = useState('')
  const [gcashName, setGcashName] = useState('')
  const [payerGcash, setPayerGcash] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [qrZoom, setQrZoom] = useState(false)
  const [payments, setPayments] = useState<ShopPayment[]>([])
  const [successfulPayment, setSuccessfulPayment] = useState<ShopPayment | null>(null)
  const [selectedPayment, setSelectedPayment] = useState<ShopPayment | null>(null)
  const [proofViewerUrl, setProofViewerUrl] = useState<string | null>(null)

  const loadPayments = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setPayments([])
      return
    }
    const { data, error } = await supabase
      .from('shop_payments')
      .select('id, status, amount, "payerName", "gcashName", "gcashNumber", "referenceNumber", "proofImageUrl", "rejectionReason", "createdAt", "verifiedAt", "expiresAt"')
      .eq('shopId', user.id)
      .order('createdAt', { ascending: false })
    if (error) throw error
    setPayments((data || []).map((row: any) => ({
      id: row.id,
      status: row.status || 'pending',
      amount: Number(row.amount) || 0,
      payerName: row.payerName || '',
      gcashName: row.gcashName || '',
      gcashNumber: row.gcashNumber || '',
      referenceNumber: row.referenceNumber || '',
      proofImageUrl: row.proofImageUrl || null,
      rejectionReason: row.rejectionReason || null,
      createdAt: row.createdAt || '',
      verifiedAt: row.verifiedAt || null,
      expiresAt: row.expiresAt || null,
    })))
  }, [])

  useEffect(() => {
    let active = true
    getPaymentQrSetting()
      .then((data) => {
        if (active) setSetting(data)
      })
      .catch(() => {
        if (active) setSetting(null)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void loadPayments().catch(() => setPayments([]))
    const channel = supabase
      .channel('shop-admin-payment-status-web')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_payments' }, () => {
        void loadPayments().catch(() => undefined)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadPayments])

  const hasContent =
    Boolean(setting) && Boolean(setting?.imageUrl) && Number(setting?.feeAmount) > 0

  const latestPayment = payments[0] || null
  const paymentPending = latestPayment?.status === 'pending'

  if (!ready) return null
  if (!setting || !hasContent) {
    return (
      <div className={`payment-qr-card${className ? ` ${className}` : ''}`}>
        <div className="payment-qr-unavailable">
          <h4>Payment setup is not available yet</h4>
          <p>The admin must publish a payment QR code and registration fee before shops can pay.</p>
        </div>
      </div>
    )
  }

  const handleProofChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return

    if (!selected.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please attach an image screenshot as proof of payment.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    if (proofPreview) URL.revokeObjectURL(proofPreview)
    setProofFile(selected)
    setProofPreview(URL.createObjectURL(selected))
  }

  const clearProof = () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview)
    setProofFile(null)
    setProofPreview(null)
  }

  const handleSubmit = async () => {
    if (submitting) return

    if (paymentPending) {
      openAlert({ title: 'Payment Under Review', message: 'Please wait for the admin to review your current submission.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    if (!payerName.trim() || !gcashName.trim() || !payerGcash.trim()) {
      openAlert({
        title: 'Incomplete Details',
        message: 'Please enter the sender name, GCash account name, and GCash number.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    if (!proofFile) {
      openAlert({
        title: 'Proof Required',
        message: 'Please attach a screenshot as proof that you paid.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    setSubmitting(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('You must be signed in to submit payment details.')

      const ext = proofFile.name.split('.').pop() || 'png'
      const path = `payment-proofs/${user.id}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, proofFile, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)

      const { data: insertedPayment, error } = await supabase
        .from('shop_payments')
        .insert({
          shopId: user.id,
          payerName: payerName.trim(),
          gcashName: gcashName.trim(),
          gcashNumber: payerGcash.trim(),
          referenceNumber: referenceNumber.trim(),
          amount: Number(setting.feeAmount) || 0,
          proofImageUrl: urlData.publicUrl,
          status: 'pending',
        })
        .select('*')
        .single()
      if (error) throw error

      setSuccessfulPayment({
        id: insertedPayment.id,
        status: insertedPayment.status || 'pending',
        amount: Number(insertedPayment.amount) || 0,
        payerName: insertedPayment.payerName || '',
        gcashName: insertedPayment.gcashName || '',
        gcashNumber: insertedPayment.gcashNumber || '',
        referenceNumber: insertedPayment.referenceNumber || '',
        proofImageUrl: insertedPayment.proofImageUrl || null,
        rejectionReason: insertedPayment.rejectionReason || null,
        createdAt: insertedPayment.createdAt || new Date().toISOString(),
        verifiedAt: insertedPayment.verifiedAt || null,
        expiresAt: insertedPayment.expiresAt || null,
      })

      setPayerName('')
      setGcashName('')
      setPayerGcash('')
      setReferenceNumber('')
      clearProof()
      await loadPayments()
      void createAdminNotification(
        'shop_payment_submitted',
        'Shop Payment Submitted',
        `${payerName.trim()} submitted a registration payment for review.`,
        { shopId: user.id },
      )

    } catch (err: any) {
      openAlert({
        title: 'Submission Failed',
        message: 'Unable to submit payment details: ' + (err?.message || 'Unknown error.'),
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`payment-qr-card${className ? ` ${className}` : ''}`}>
      <div className="payment-qr-section-head">
        <div>
          <h2 className="payment-qr-title">{title}</h2>
          <p className="payment-qr-description">{description}</p>
        </div>
        <button
          type="button"
          className="payment-qr-refresh"
          onClick={() => void loadPayments().catch(() => setPayments([]))}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 11A8 8 0 1 0 18 16.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M20 5V11H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Refresh
        </button>
      </div>

      <section className="payment-qr-workspace">
      <div className="payment-qr-top">
        <div className="payment-qr-info">
          <span className="payment-qr-eyebrow">Step 1 · Scan and pay</span>
          <h3>Pay the LifeCycle admin</h3>
          <p>Scan the QR code using GCash or your preferred e-wallet, then keep a screenshot of the receipt.</p>

          {Number(setting.feeAmount) > 0 ? (
            <div className="payment-qr-amount">
              <span>Amount to pay</span>
              <strong>{formatPeso(Number(setting.feeAmount))}</strong>
            </div>
          ) : null}
        </div>

        {setting.imageUrl ? (
          <button
            type="button"
            className="payment-qr-image-wrap"
            onClick={() => setQrZoom(true)}
            aria-label="Enlarge payment QR code"
          >
            <img src={setting.imageUrl} alt="Payment QR code" className="payment-qr-image" />
            <span className="payment-qr-zoom-badge">
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Tap to enlarge
            </span>
          </button>
        ) : null}
      </div>

      {latestPayment ? (
        <div className={`payment-qr-current is-${latestPayment.status}`}>
          <div>
            <strong>{paymentStatusLabel(latestPayment.status)}</strong>
            <span>
              {latestPayment.status === 'pending'
                ? 'The admin is reviewing your payment proof.'
                : latestPayment.status === 'verified'
                  ? 'Your registration payment was approved.'
                  : latestPayment.rejectionReason || 'Please correct the payment details and submit again.'}
            </span>
          </div>
          <span className="payment-qr-current-amount">{formatPeso(latestPayment.amount)}</span>
        </div>
      ) : null}

      <form
        className={`payment-qr-form${paymentPending ? ' is-disabled' : ''}`}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <div className="payment-qr-form-head">
          <div>
            <span className="payment-qr-eyebrow">Step 2 · Submit payment</span>
            <h3>Payment information</h3>
          </div>
          <p>Enter the account details used for this transaction and attach your receipt.</p>
        </div>
        <div className="payment-qr-form-fields">
          <div className="payment-qr-form-field">
            <label htmlFor="pqr-payer-name">Sender Name *</label>
            <input
              id="pqr-payer-name"
              type="text"
              placeholder="Name of the person who sent payment"
              value={payerName}
              onChange={(event) => setPayerName(event.target.value)}
            />
          </div>
          <div className="payment-qr-form-field">
            <label htmlFor="pqr-gcash-name">GCash Account Name *</label>
            <input
              id="pqr-gcash-name"
              type="text"
              placeholder="Name shown in GCash"
              value={gcashName}
              onChange={(event) => setGcashName(event.target.value)}
            />
          </div>
          <div className="payment-qr-form-field">
            <label htmlFor="pqr-gcash-number">GCash Number *</label>
            <input
              id="pqr-gcash-number"
              type="text"
              inputMode="tel"
              placeholder="e.g. 09XX XXX XXXX"
              value={payerGcash}
              onChange={(event) => setPayerGcash(event.target.value)}
            />
          </div>
          <div className="payment-qr-form-field">
            <label htmlFor="pqr-reference">Reference Number</label>
            <input
              id="pqr-reference"
              type="text"
              placeholder="Optional"
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
            />
          </div>
        </div>

        <div className="payment-qr-proof">
          <span className="payment-qr-proof-label">Proof of Payment *</span>
          {proofPreview ? (
            <div className="payment-qr-proof-preview">
              <img src={proofPreview} alt="Payment proof screenshot" />
              <div className="payment-qr-proof-preview-meta">
                <span>{proofFile?.name || 'Screenshot attached'}</span>
                <button type="button" className="payment-qr-proof-remove" onClick={clearProof}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <label className="payment-qr-proof-pick">
              <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                <path d="M12 16V4M12 4L7 9M12 4L17 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 16v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Attach payment screenshot
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="payment-qr-file-input"
                onChange={handleProofChange}
              />
            </label>
          )}
        </div>

        <button type="submit" className="payment-qr-submit" disabled={submitting || paymentPending}>
          {paymentPending ? 'Payment Under Review' : submitting ? 'Submitting...' : 'Submit Payment Details'}
        </button>
      </form>
      </section>

      <section className="payment-qr-history">
        <div className="payment-qr-history-head">
          <div>
            <h3>Payment History</h3>
            <p>Review all registration and renewal payments submitted to the LifeCycle admin.</p>
          </div>
          <span>{payments.length} payment{payments.length === 1 ? '' : 's'}</span>
        </div>
        {payments.length > 0 ? (
          <div className="payment-qr-history-table-wrap">
            <table className="payment-qr-history-table">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Sender</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      <strong>#{payment.id.slice(0, 8).toUpperCase()}</strong>
                      <span>{formatPaymentDate(payment.createdAt)}</span>
                    </td>
                    <td>
                      <strong>{payment.payerName || '—'}</strong>
                      <span>{payment.gcashName ? `GCash: ${payment.gcashName}` : 'GCash / E-wallet'}</span>
                    </td>
                    <td><strong>{formatPeso(payment.amount)}</strong></td>
                    <td>
                      <span className={`payment-qr-history-status is-${payment.status}`}>
                        {paymentStatusLabel(payment.status)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="payment-qr-history-action"
                        onClick={() => setSelectedPayment(payment)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="payment-qr-history-empty">
            <div aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M6 3H18A2 2 0 0 1 20 5V21L16 18L12 21L8 18L4 21V5A2 2 0 0 1 6 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                <path d="M8 8H16M8 12H15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <strong>No payment history yet</strong>
            <span>Your submitted payments will appear here.</span>
          </div>
        )}
      </section>

      {selectedPayment ? (
        <div
          className="shop-payment-details-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-payment-details-title"
        >
          <div className="shop-payment-details-screen">
            <header className={`shop-payment-details-hero is-${selectedPayment.status}`}>
              <button
                type="button"
                className="shop-payment-details-close"
                onClick={() => setSelectedPayment(null)}
                aria-label="Close payment details"
              >
                ×
              </button>
              <div className="shop-payment-details-badge" aria-hidden="true">
                {selectedPayment.status === 'verified' ? (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5L9.2 17L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : selectedPayment.status === 'rejected' ? (
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M7 7L17 17M17 7L7 17" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
                    <path d="M12 7.5V12L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <h2 id="shop-payment-details-title">{paymentStatusLabel(selectedPayment.status)}</h2>
              <p>
                {selectedPayment.status === 'verified'
                  ? 'Your payment has been verified by the LifeCycle admin.'
                  : selectedPayment.status === 'rejected'
                    ? 'This payment needs attention. Review the admin response below before submitting again.'
                    : 'Your payment proof is with the LifeCycle admin and is currently being reviewed.'}
              </p>
            </header>

            <main className="shop-payment-details-body">
              <section>
                <h3>Payment Details</h3>
                <div className="shop-payment-details-rows">
                  <div><span>Payment Date</span><strong>{formatPaymentDate(selectedPayment.createdAt)}</strong></div>
                  <div><span>Payment ID</span><strong>#{selectedPayment.id.slice(0, 10).toUpperCase()}</strong></div>
                  <div>
                    <span>Status</span>
                    <strong className={`is-${selectedPayment.status}`}>{paymentStatusLabel(selectedPayment.status)}</strong>
                  </div>
                  {selectedPayment.verifiedAt ? (
                    <div><span>Verified Date</span><strong>{formatPaymentDate(selectedPayment.verifiedAt)}</strong></div>
                  ) : null}
                  {selectedPayment.expiresAt ? (
                    <div><span>Access Until</span><strong>{formatPaymentDate(selectedPayment.expiresAt)}</strong></div>
                  ) : null}
                </div>
              </section>

              <div className="shop-payment-details-divider" />

              <div className="shop-payment-details-item">
                <div className="shop-payment-details-item-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M3 10H21M16 15H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <strong>Registration / Renewal Payment</strong>
                  <span>LifeCycle Admin</span>
                </div>
                <strong>{formatPeso(selectedPayment.amount)}</strong>
              </div>

              {selectedPayment.rejectionReason ? (
                <div className="shop-payment-details-rejection">
                  <strong>Admin response</strong>
                  <p>{selectedPayment.rejectionReason}</p>
                </div>
              ) : null}

              <div className="shop-payment-details-divider" />

              <section>
                <h3>Payment Information</h3>
                <div className="shop-payment-details-rows">
                  <div><span>Payment Method</span><strong>GCash / E-wallet</strong></div>
                  <div><span>Sender</span><strong>{selectedPayment.payerName || '—'}</strong></div>
                  <div><span>GCash Name</span><strong>{selectedPayment.gcashName || '—'}</strong></div>
                  <div><span>GCash Number</span><strong>{selectedPayment.gcashNumber || '—'}</strong></div>
                  {selectedPayment.referenceNumber ? (
                    <div><span>Reference Number</span><strong>{selectedPayment.referenceNumber}</strong></div>
                  ) : null}
                </div>
              </section>

              {selectedPayment.proofImageUrl ? (
                <>
                  <div className="shop-payment-details-divider" />
                  <section>
                    <h3>Proof of Payment</h3>
                    <button
                      type="button"
                      className="shop-payment-details-proof"
                      onClick={() => setProofViewerUrl(selectedPayment.proofImageUrl)}
                    >
                      <img src={selectedPayment.proofImageUrl} alt="Payment proof" />
                      <span>
                        <strong>View payment proof</strong>
                        <small>Open the submitted receipt in full size</small>
                      </span>
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 6L15 12L9 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </section>
                </>
              ) : null}

              <div className="shop-payment-details-total">
                <span>Total Paid</span>
                <strong>{formatPeso(selectedPayment.amount)}</strong>
              </div>

              <button type="button" className="shop-payment-details-done" onClick={() => setSelectedPayment(null)}>
                Close Payment Details
              </button>
            </main>
          </div>
        </div>
      ) : null}

      {successfulPayment ? (
        <div className="shop-payment-success-overlay" role="dialog" aria-modal="true" aria-labelledby="shop-payment-success-title">
          <div className="shop-payment-success-screen">
            <header className="shop-payment-success-hero">
              <div className="shop-payment-success-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 12.5L9.2 17L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 id="shop-payment-success-title">Payment Successful</h2>
              <p>Thank you for your payment. Your proof was sent to the LifeCycle admin and is now being reviewed.</p>
            </header>

            <main className="shop-payment-success-body">
              <h3>Payment Details</h3>
              <div className="shop-payment-success-details">
                <div><span>Payment Date</span><strong>{new Date(successfulPayment.createdAt).toLocaleString()}</strong></div>
                <div><span>Payment ID</span><strong>#{successfulPayment.id.slice(0, 10).toUpperCase()}</strong></div>
                <div><span>Status</span><strong className="is-pending">Pending admin review</strong></div>
              </div>

              <div className="shop-payment-success-divider" />

              <div className="shop-payment-success-item">
                <div className="shop-payment-success-item-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M3 10H21M16 15H18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="shop-payment-success-item-copy">
                  <strong>Registration / Renewal Payment</strong>
                  <span>LifeCycle Admin</span>
                  <span>GCash: {successfulPayment.gcashName}</span>
                </div>
                <strong className="shop-payment-success-item-amount">{formatPeso(successfulPayment.amount)}</strong>
              </div>

              <div className="shop-payment-success-divider" />

              <div className="shop-payment-success-details">
                <div><span>Sender</span><strong>{successfulPayment.payerName}</strong></div>
                <div><span>GCash Number</span><strong>{successfulPayment.gcashNumber}</strong></div>
                {successfulPayment.referenceNumber ? (
                  <div><span>Reference Number</span><strong>{successfulPayment.referenceNumber}</strong></div>
                ) : null}
              </div>

              <div className="shop-payment-success-divider" />

              <div className="shop-payment-success-total">
                <span>Total Paid</span>
                <strong>{formatPeso(successfulPayment.amount)}</strong>
              </div>

              <button
                type="button"
                className="shop-payment-success-action"
                onClick={() => {
                  setSelectedPayment(successfulPayment)
                  setSuccessfulPayment(null)
                  onSuccess?.()
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 3H18A2 2 0 0 1 20 5V21L16 18L12 21L8 18L4 21V5A2 2 0 0 1 6 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M8 8H16M8 12H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                View Payment Details
              </button>
            </main>
          </div>
        </div>
      ) : null}

      {alertDialog}

      {qrZoom && setting.imageUrl ? (
        <div className="payment-qr-zoom-overlay" onClick={() => setQrZoom(false)}>
          <button
            type="button"
            className="payment-qr-zoom-close"
            aria-label="Close enlarged QR"
            onClick={() => setQrZoom(false)}
          >
            ×
          </button>
          <img
            src={setting.imageUrl}
            alt="Payment QR code enlarged"
            className="payment-qr-zoom-img"
            onClick={(event) => event.stopPropagation()}
          />
          <div className="payment-qr-zoom-footer" onClick={(event) => event.stopPropagation()}>
            <span>Scan this QR code to pay your registration fee.</span>
            <a href={setting.imageUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </div>
        </div>
      ) : null}

      {proofViewerUrl ? (
        <div className="payment-qr-zoom-overlay" onClick={() => setProofViewerUrl(null)}>
          <button
            type="button"
            className="payment-qr-zoom-close"
            aria-label="Close payment proof"
            onClick={() => setProofViewerUrl(null)}
          >
            ×
          </button>
          <img
            src={proofViewerUrl}
            alt="Payment proof enlarged"
            className="payment-qr-zoom-img"
            onClick={(event) => event.stopPropagation()}
          />
          <div className="payment-qr-zoom-footer" onClick={(event) => event.stopPropagation()}>
            <span>Submitted proof of payment</span>
            <a href={proofViewerUrl} target="_blank" rel="noreferrer">Open in new tab</a>
          </div>
        </div>
      ) : null}
    </div>
  )
}
