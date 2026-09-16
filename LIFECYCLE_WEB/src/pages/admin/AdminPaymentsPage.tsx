import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { getPaymentQrSetting, savePaymentQrDetails } from '@/utils/paymentQrSettings'
import { addMonths, SUBSCRIPTION_MONTHS } from '@/utils/subscription'
import { buildCsv, csvTimestamp, dateStamp, downloadCsv } from '@/utils/exportCsv'
import { createNotification } from '@/utils/supabaseNotifications'
import AdminShopPaymentReceipt from './AdminShopPaymentReceipt'
import AdminRefundsPanel from './AdminRefundsPanel'
import './AdminPaymentsPage.css'

function formatUpdatedAt(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function formatPeso(value: string): string {
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return '—'
  return `₱${parsed.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

export type PaymentSubmission = {
  id: string
  shopId: string
  payerName: string
  gcashName: string
  gcashNumber: string
  referenceNumber: string
  amount: number
  proofImageUrl: string | null
  status: string
  createdAt: string
  verifiedAt: string | null
  expiresAt: string | null
  rejectionReason: string | null
  shopName: string
  ownerEmail: string
  ownerFullName: string
  paymentProvider: 'manual' | 'paymongo' | 'xendit'
  providerPaymentId: string | null
  providerPaymentMethod: string | null
}

export default function AdminPaymentsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [feeAmount, setFeeAmount] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [payments, setPayments] = useState<PaymentSubmission[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [payingId, setPayingId] = useState('')
  const [paymentsError, setPaymentsError] = useState('')
  const [selectedPayment, setSelectedPayment] = useState<PaymentSubmission | null>(null)
  const [rejectingPayment, setRejectingPayment] = useState<PaymentSubmission | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [activeTab, setActiveTab] = useState<'submissions' | 'refunds' | 'setup'>(() => (
    new URLSearchParams(window.location.search).get('tab') === 'refunds' ? 'refunds' : 'submissions'
  ))

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const setting = await getPaymentQrSetting()
      setQrUrl(setting.imageUrl)
      setFeeAmount(setting.feeAmount > 0 ? String(setting.feeAmount) : '')
      setUpdatedAt(setting.updatedAt)
    } catch {
      setError('Unable to load the payment settings right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const loadSubmissions = async () => {
    setPaymentsLoading(true)
    setPaymentsError('')
    try {
      const { data, error: fetchError } = await supabase
        .from('shop_payments')
        .select(`
          *,
          users!shop_payments_shopId_fkey (
            email,
            "fullName",
            funeral_shops!funeral_shops_id_fkey ( shopName )
          )
        `)
        .order('createdAt', { ascending: false })

      if (fetchError) throw fetchError

      const list: PaymentSubmission[] = (data || []).map((row: any) => ({
        id: row.id,
        shopId: row.shopId || '',
        payerName: row.payerName || '',
        gcashName: row.gcashName || '',
        gcashNumber: row.gcashNumber || '',
        referenceNumber: row.referenceNumber || '',
        amount: Number(row.amount) || 0,
        proofImageUrl: row.proofImageUrl || null,
        status: row.status || 'pending',
        createdAt: row.createdAt || '',
        verifiedAt: row.verifiedAt || null,
        expiresAt: row.expiresAt || null,
        rejectionReason: row.rejectionReason || null,
        shopName: row.users?.funeral_shops?.shopName || '',
        ownerEmail: row.users?.email || '',
        ownerFullName: row.users?.fullName || '',
        paymentProvider: row.paymentProvider === 'xendit'
          ? 'xendit'
          : row.paymentProvider === 'paymongo'
            ? 'paymongo'
            : 'manual',
        providerPaymentId: row.providerPaymentId || null,
        providerPaymentMethod: row.providerPaymentMethod || null,
      }))
      setPayments(list)
    } catch {
      setPaymentsError('Unable to load payment submissions right now.')
    } finally {
      setPaymentsLoading(false)
    }
  }

  useEffect(() => {
    void loadSubmissions()
  }, [])

  const exportPayments = () => {
    const csv = buildCsv(payments, [
      { header: 'Payment ID', value: (row) => row.id },
      { header: 'Shop Name', value: (row) => row.shopName || '' },
      { header: 'Owner Full Name', value: (row) => row.ownerFullName || '' },
      { header: 'Owner Email', value: (row) => row.ownerEmail || '' },
      { header: 'Payer Name', value: (row) => row.payerName || '' },
      { header: 'GCash Account Name', value: (row) => row.gcashName || '' },
      { header: 'GCash Number', value: (row) => row.gcashNumber || '' },
      { header: 'Reference Number', value: (row) => row.referenceNumber || '' },
      { header: 'Amount', value: (row) => row.amount || 0 },
      { header: 'Status', value: (row) => row.status || '' },
      { header: 'Rejection Reason', value: (row) => row.rejectionReason || '' },
      { header: 'Submitted At', value: (row) => csvTimestamp(row.createdAt || null) },
      { header: 'Verified At', value: (row) => csvTimestamp(row.verifiedAt || null) },
      { header: 'Expires At', value: (row) => csvTimestamp(row.expiresAt || null) },
    ])
    downloadCsv(`payments-${dateStamp()}.csv`, csv)
  }

  const setPaymentStatus = async (paymentId: string, nextStatus: 'verified' | 'rejected') => {
    const item = payments.find((entry) => entry.id === paymentId)
    if (nextStatus === 'rejected') {
      if (item) {
        setSelectedPayment(null)
        setRejectionReason('')
        setRejectingPayment(item)
      }
      return
    }
    setSelectedPayment(null)
    openConfirm({
      title: nextStatus === 'verified' ? 'Verify this payment?' : 'Reject this payment?',
      message: nextStatus === 'verified'
        ? `Verify the ₱${item?.amount ? Number(item.amount).toLocaleString('en-PH') : '—'} payment submitted by ${item?.payerName || item?.ownerEmail || 'this seller'}?`
        : `Reject the payment submitted by ${item?.payerName || item?.ownerEmail || 'this seller'}?`,
      details:
        nextStatus === 'verified'
          ? ['The payment will be marked verified.', 'The seller can then Go Live on their shop to start their 1 month of live access.']
          : ['The payment will be marked rejected.', 'The seller will be notified to resubmit.'],
      tone: nextStatus === 'verified' ? 'success' : 'danger',
      confirmLabel: nextStatus === 'verified' ? 'Verify Payment' : 'Reject Payment',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setPayingId(paymentId)
        try {
          if (nextStatus === 'verified') {
            const now = new Date()
            const verifiedAt = now.toISOString()
            const expiresAt = addMonths(now, SUBSCRIPTION_MONTHS).toISOString()

            const { data: updatedPayment, error: updateError } = await supabase
              .from('shop_payments')
              .update({ status: nextStatus, verifiedAt, expiresAt, rejectionReason: null })
              .eq('id', paymentId)
              .eq('status', 'pending')
              .select('id')
              .maybeSingle()
            if (updateError) throw updateError
            if (!updatedPayment) throw new Error('This payment was already reviewed.')
          } else {
            const { error: updateError } = await supabase
              .from('shop_payments')
              .update({ status: nextStatus, verifiedAt: null, expiresAt: null })
              .eq('id', paymentId)
            if (updateError) throw updateError
          }
          if (item?.shopId) {
            try {
              await createNotification({
                userId: item.shopId,
                type: 'shop_payment_verified',
                title: 'Registration Payment Verified',
                body: 'Your payment was verified. You can now make your shop live.',
                data: { paymentId },
              })
            } catch (notificationError) {
              console.warn('Payment verified, but the shop notification could not be created:', notificationError)
            }
          }
          await loadSubmissions()
        } catch (err: any) {
          setPaymentsError('Update failed: ' + (err?.message || 'Unknown error.'))
        } finally {
          setPayingId('')
        }
      },
    })
  }

  const confirmPaymentRejection = async () => {
    const item = rejectingPayment
    const reason = rejectionReason.trim()
    if (!item || payingId) return
    if (!reason) {
      openAlert({ title: 'Reason Required', message: 'Explain why this payment could not be verified.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setPayingId(item.id)
    try {
      const { data, error: updateError } = await supabase
        .from('shop_payments')
        .update({ status: 'rejected', rejectionReason: reason, verifiedAt: null, expiresAt: null })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('This payment was already reviewed.')

      try {
        await createNotification({
          userId: item.shopId,
          type: 'shop_payment_rejected',
          title: 'Registration Payment Needs Review',
          body: `The admin could not verify your payment: ${reason}`,
          data: { paymentId: item.id, rejectionReason: reason },
        })
      } catch (notificationError) {
        console.warn('Payment rejected, but the shop notification could not be created:', notificationError)
      }
      setRejectingPayment(null)
      setRejectionReason('')
      await loadSubmissions()
    } catch (err: any) {
      setPaymentsError('Update failed: ' + (err?.message || 'Unknown error.'))
    } finally {
      setPayingId('')
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (!selected) return

    if (!selected.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file for the payment QR code.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(selected)
    setPreviewUrl(URL.createObjectURL(selected))
  }

  const clearSelection = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDiscard = () => {
    if (saving) return
    clearSelection()
    void load()
  }

  const handleSave = async () => {
    if (saving) return

    const parsedFee = Number(String(feeAmount).replace(/[^\d.]/g, ''))
    if (!String(feeAmount).trim() || !Number.isFinite(parsedFee) || parsedFee <= 0) {
      openAlert({ title: 'Invalid Amount', message: 'Please enter a valid registration fee amount.', tone: 'warning', okLabel: 'Got It' })
      return
    }

    setSaving(true)
    setError('')
    try {
      await savePaymentQrDetails({
        imageUrl: null,
        feeAmount: parsedFee,
      })

      setQrUrl(null)
      setUpdatedAt(new Date().toISOString())
      clearSelection()

      openAlert({
        title: 'Payments Updated',
        message: 'Payment settings saved. Verified shops can now pay this fee through Xendit Test Mode.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (err: any) {
      setError('Save failed: ' + (err?.message || 'Unknown error.'))
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveQr = () => {
    if (!qrUrl || saving) return
    const parsedFee = Number(String(feeAmount).replace(/[^\d.]/g, ''))
    openConfirm({
      title: 'Remove Payment QR?',
      message: 'This will remove the QR code from the seller payment section until you upload a new one. The registration fee will be kept.',
      confirmLabel: 'Remove QR',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        setSaving(true)
        try {
          await savePaymentQrDetails({
            imageUrl: null,
            feeAmount: Number.isFinite(parsedFee) && parsedFee > 0 ? parsedFee : 0,
          })
          setQrUrl(null)
          setUpdatedAt(new Date().toISOString())
          openAlert({
            title: 'Payment QR Removed',
            message: 'The payment QR code was removed.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (err: any) {
          setError('Remove failed: ' + (err?.message || 'Unknown error.'))
        } finally {
          setSaving(false)
        }
      },
    })
  }

  const shownQrUrl = previewUrl || qrUrl
  const pendingPaymentCount = payments.filter((entry) => entry.status === 'pending' && entry.paymentProvider === 'manual').length
  const verifiedPayments = payments.filter((entry) => entry.status === 'verified')
  const verifiedPaymentTotal = verifiedPayments.reduce((total, entry) => total + Number(entry.amount || 0), 0)

  return (
    <section className="panel payments-panel">
      <header className="payments-header">
        <div className="payments-header-text">
          <h2>Payments</h2>
          <p className="panel-sub">
            Review shop registration payments and manage the payment instructions shown to sellers.
          </p>
        </div>
        <span className={`payments-status-pill${Number(feeAmount) > 0 ? ' is-live' : ' is-empty'}`}>
          <span className="payments-status-dot" aria-hidden="true" />
          {Number(feeAmount) > 0 ? 'Xendit Ready' : 'Fee Required'}
        </span>
      </header>

      <div className="payments-tabs" role="tablist" aria-label="Payment sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'submissions'}
          className={`payments-tab${activeTab === 'submissions' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          Submissions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'refunds'}
          className={activeTab === 'refunds' ? 'payments-tab is-active' : 'payments-tab'}
          onClick={() => setActiveTab('refunds')}
        >
          Refunds
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'setup'}
          className={activeTab === 'setup' ? 'payments-tab is-active' : 'payments-tab'}
          onClick={() => setActiveTab('setup')}
        >
          Payment Setup
        </button>
      </div>

      {activeTab === 'refunds' ? <AdminRefundsPanel /> : null}

      {activeTab === 'setup' ? (
        <>
          {loading ? <p className="panel-sub payments-loading">Loading payment settings...</p> : null}
          {error ? <p className="auth-message auth-message-error payments-error">{error}</p> : null}
        </>
      ) : null}

      {activeTab === 'setup' && !loading ? (
        <>
          <div className="payments-summary">
            <div className="payments-summary-item">
              <span className="payments-summary-label">Registration Fee</span>
              <strong className="payments-summary-value">{formatPeso(feeAmount)}</strong>
            </div>
            <div className="payments-summary-item">
              <span className="payments-summary-label">Last Updated</span>
              <strong className="payments-summary-value payments-summary-date">{formatUpdatedAt(updatedAt)}</strong>
            </div>
          </div>

          <div className="payments-grid">
            <section className="payments-card">
              <div className="payments-card-head">
                <h3>Registration Fee</h3>
                <p>The amount verified sellers must pay after their shop is approved.</p>
              </div>

              <div className="payments-form-grid">
                <div className="payments-field">
                  <label htmlFor="payments-fee">Registration Fee (₱) *</label>
                  <div className="payments-field-input">
                    <span className="payments-field-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" width="17" height="17">
                        <line x1="12" y1="1" x2="12" y2="23" stroke="currentColor" strokeWidth="1.8" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </span>
                    <input
                      id="payments-fee"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 500"
                      value={feeAmount}
                      onChange={(event) => setFeeAmount(event.target.value)}
                    />
                  </div>
                  <span className="payments-field-hint">Xendit charges this exact test amount through secure hosted checkout.</span>
                </div>
              </div>
            </section>

            <section className="payments-card">
              <div className="payments-card-head">
                <h3>Xendit Test Checkout</h3>
                <p>Enabled Xendit test channels are confirmed automatically. No real money is used.</p>
              </div>

              <div className='payments-paymongo-live'>
                <strong>Secure checkout enabled</strong>
                <p>No QR image or payment screenshot is required. Xendit sends the verified result directly to LifeCycle.</p>
              </div>
              <div className="payments-qr-layout" style={{ display: 'none' }}>
                <div className={`payments-qr-preview${shownQrUrl ? ' has-image' : ''}`}>
                  {shownQrUrl ? (
                    <img src={shownQrUrl} alt={previewUrl ? 'New payment QR preview' : 'Current payment QR code'} />
                  ) : (
                    <div className="payments-qr-empty">
                      <svg viewBox="0 0 24 24" fill="none" width="34" height="34">
                        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
                        <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
                        <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M14 14H21V21H14V14Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                      <span>No QR uploaded yet</span>
                    </div>
                  )}
                </div>

                <div className="payments-qr-controls">
                  <input
                    ref={fileInputRef}
                    id="payments-qr-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="payments-file-input"
                    onChange={handleFileChange}
                  />
                  <label htmlFor="payments-qr-file-input" className="ghost-btn payments-choose-btn">
                    <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                      <path d="M12 16V4M12 4L7 9M12 4L17 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5 16v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    {previewUrl ? 'Choose another image' : 'Upload QR image'}
                  </label>

                  {previewUrl ? (
                    <button type="button" className="ghost-btn" onClick={clearSelection} disabled={saving}>
                      Cancel
                    </button>
                  ) : null}

                  <p className="payments-upload-hint">
                    {previewUrl
                      ? 'New QR selected — save to publish it to sellers.'
                      : qrUrl
                        ? 'This QR code is currently shown to verified sellers.'
                        : 'Upload a QR code image to start accepting registration payments.'}
                  </p>

                  {qrUrl ? (
                    <button type="button" className="payments-remove" onClick={handleRemoveQr} disabled={saving}>
                      Remove current QR code
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
          </div>

          <footer className="payments-actions">
            <button type="button" className="ghost-btn" onClick={handleDiscard} disabled={saving}>
              Discard Changes
            </button>
            <button type="button" className="solid-btn" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save Xendit Fee'}
            </button>
          </footer>
        </>
      ) : null}

      {activeTab === 'submissions' ? (
        <section className="payments-submissions">
          <header className="payments-submissions-head">
            <div>
              <h3>Payment Submissions</h3>
              <p className="panel-sub">Review seller payments and verify them so the shop can go live.</p>
            </div>
            <button type="button" className="ghost-btn admin-export-btn" onClick={exportPayments}>
              Export CSV
            </button>
          </header>

          <div className="payments-submission-summary" aria-label="Payment submission summary">
            <article>
              <span>Needs review</span>
              <strong>{pendingPaymentCount}</strong>
            </article>
            <article>
              <span>Verified</span>
              <strong>{verifiedPayments.length}</strong>
            </article>
            <article>
              <span>Verified total</span>
              <strong>{verifiedPaymentTotal > 0 ? formatPeso(String(verifiedPaymentTotal)) : '—'}</strong>
            </article>
          </div>

          {paymentsLoading ? <p className="panel-sub payments-loading">Loading payment submissions...</p> : null}
          {paymentsError ? <p className="auth-message auth-message-error payments-error">{paymentsError}</p> : null}
          {!paymentsLoading && payments.length === 0 ? <p className="panel-sub">No payment submissions yet.</p> : null}

          {!paymentsLoading && payments.length > 0 ? (
            <div className="table-wrap">
              <table className="request-table">
                <thead>
                  <tr>
                    <th>Seller</th>
                    <th>Shop</th>
                    <th>Amount</th>
                    <th>Submitted</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((entry) => {
                    const busy = payingId === entry.id
                    return (
                      <tr key={entry.id}>
                        <td>
                          {entry.payerName || '-'}
                          <div className="row-muted">{entry.ownerFullName || entry.ownerEmail || ''}</div>
                          <div className="row-muted">{entry.gcashNumber || ''}</div>
                        </td>
                        <td>{entry.shopName || '-'}</td>
                        <td>{entry.amount > 0 ? `₱${Number(entry.amount).toLocaleString('en-PH')}` : '—'}</td>
                        <td>{formatUpdatedAt(entry.createdAt)}</td>
                        <td>
                          <span className={`status-pill ${entry.status}`}>{entry.status}</span>
                        </td>
                        <td>
                          <div className="request-actions">
                            <button
                              type="button"
                              className="ghost-btn table-action"
                              disabled={busy}
                              onClick={() => setSelectedPayment(entry)}
                            >
                              View receipt
                            </button>
                            {entry.status === 'pending' && entry.paymentProvider === 'manual' ? (
                              <>
                                <button
                                  type="button"
                                  className="ghost-btn table-action"
                                  disabled={busy}
                                  onClick={() => void setPaymentStatus(entry.id, 'verified')}
                                >
                                  Verify
                                </button>
                                <button
                                  type="button"
                                  className="ghost-btn table-action"
                                  disabled={busy}
                                  onClick={() => void setPaymentStatus(entry.id, 'rejected')}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedPayment ? (
        <AdminShopPaymentReceipt
          payment={selectedPayment}
          busy={payingId === selectedPayment.id}
          onClose={() => setSelectedPayment(null)}
          onReject={() => void setPaymentStatus(selectedPayment.id, 'rejected')}
          onVerify={() => void setPaymentStatus(selectedPayment.id, 'verified')}
        />
      ) : null}

      {rejectingPayment ? (
        <div className="payments-modal-overlay" role="presentation" onClick={() => setRejectingPayment(null)}>
          <div
            className="payments-modal payments-reject-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payments-reject-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="payments-modal-header">
              <div className="payments-modal-heading">
                <h3 id="payments-reject-title">Reject Payment</h3>
                <p>Explain what {rejectingPayment.shopName || 'the shop'} needs to correct.</p>
              </div>
              <button type="button" className="payments-modal-close" aria-label="Close" onClick={() => setRejectingPayment(null)}>×</button>
            </div>
            <div className="payments-modal-body">
              <label className="payments-reject-label" htmlFor="payments-rejection-reason">Reason for rejection *</label>
              <textarea
                id="payments-rejection-reason"
                className="payments-reject-reason"
                value={rejectionReason}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Example: The reference number is not visible in the screenshot."
                rows={5}
                autoFocus
              />
              <p className="payments-reject-hint">This reason will be shown to the shop and included in its notification.</p>
            </div>
            <div className="payments-modal-footer">
              <button type="button" className="ghost-btn" onClick={() => setRejectingPayment(null)} disabled={Boolean(payingId)}>Cancel</button>
              <button
                type="button"
                className="solid-btn payments-reject-confirm"
                onClick={() => void confirmPaymentRejection()}
                disabled={!rejectionReason.trim() || Boolean(payingId)}
              >
                {payingId ? 'Rejecting...' : 'Reject & Notify Shop'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {alertDialog}
      {confirmDialog}
    </section>
  )
}
