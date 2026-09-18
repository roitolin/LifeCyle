import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { supabase } from '@/lib/supabase'
import { acceptFuneralServiceRequest } from '@/utils/serviceRequestFlow'
import './SellerServiceRequestPage.css'

type ShopSummary = {
  id: string
  shopName: string
  paymentQrUrl?: string | null
  serviceFeeAmount?: number | string | null
}

type ServiceRequest = {
  id: string
  requesterId: string
  productId: string
  productName: string
  productPrice?: string | number | null
  productImageUrl?: string | null
  variationName?: string | null
  packageItems?: string[] | null
  requestType?: string | null
  customDesignNotes?: string | null
  deceasedFullName?: string | null
  deceasedDateOfBirth?: string | null
  deceasedDateOfPassing?: string | null
  deceasedAge?: number | null
  tributeMessage?: string | null
  contactNumber?: string | null
  status: string
  paymentAmount?: number | string | null
  paymentPayerName?: string | null
  paymentGcashName?: string | null
  paymentGcashNumber?: string | null
  paymentReferenceNumber?: string | null
  paymentProofImageUrl?: string | null
  paymentRejectionReason?: string | null
  paymentSubmittedAt?: string | null
  paymentVerifiedAt?: string | null
  completionProofImageUrl?: string | null
  shopMarkedCompletedAt?: string | null
  completionProofSeenAt?: string | null
  requesterName?: string | null
  familyCoordinatorName?: string | null
  wakeAddress?: string | null
  churchName?: string | null
  cemeteryName?: string | null
  wakeStartDate?: string | null
  wakeEndDate?: string | null
  burialTime?: string | null
  pickupAddress?: string | null
  memorialPhotoUrl?: string | null
  acceptedAt?: string | null
  declinedAt?: string | null
  cancelledAt?: string | null
  completedAt?: string | null
  shopRespondedAt?: string | null
  createdAt?: string | null
}

const STATUS_META: Record<string, { label: string; detail: string; tone: string }> = {
  pending_shop_acceptance: { label: 'Needs response', detail: 'Review the case and respond to the family.', tone: 'warning' },
  awaiting_payment: { label: 'Awaiting payment', detail: 'The family can now view your payment instructions.', tone: 'neutral' },
  payment_submitted: { label: 'Payment to review', detail: 'Check the submitted payment details and proof.', tone: 'warning' },
  payment_verified: { label: 'In service', detail: 'Payment is verified. Complete the service when ready.', tone: 'success' },
  awaiting_customer_confirmation: { label: 'Family confirmation', detail: 'The completion proof was sent to the family.', tone: 'info' },
  completed: { label: 'Completed', detail: 'This arrangement case has been completed.', tone: 'success' },
  declined_by_shop: { label: 'Declined', detail: 'The shop declined this request.', tone: 'danger' },
  cancelled: { label: 'Cancelled', detail: 'This request was cancelled.', tone: 'danger' },
  cancelled_by_requester: { label: 'Cancelled', detail: 'The family cancelled this request.', tone: 'danger' },
}

function titleCase(value: string | null | undefined) {
  if (!value) return 'Standard service'
  return value.replace(/_/g, ' ').replace(/\\b\\w/g, (letter) => letter.toUpperCase())
}

function formatPeso(value: number | string | null | undefined) {
  const amount = Number(String(value ?? '').replace(/[^\\d.]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0) return '—'
  return `₱${new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 }).format(amount)}`
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
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
  if (!value) return '—'
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(value)
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
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

export default function SellerServiceRequestPage() {
  const { requestId = '' } = useParams()
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const proofInputRef = useRef<HTMLInputElement | null>(null)
  const [shop, setShop] = useState<ShopSummary | null>(null)
  const [request, setRequest] = useState<ServiceRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [paymentReceiptOpen, setPaymentReceiptOpen] = useState(false)
  const [rejectMode, setRejectMode] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const loadRequest = useCallback(async () => {
    if (!requestId) {
      setError('This arrangement case does not have a valid request ID.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        navigate('/login', { replace: true })
        return
      }

      const [shopResult, requestResult] = await Promise.all([
        supabase
          .from('funeral_shops')
          .select('id, "shopName", "paymentQrUrl", "serviceFeeAmount"')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('funeral_service_requests')
          .select('*')
          .eq('id', requestId)
          .eq('shopId', user.id)
          .maybeSingle(),
      ])

      if (shopResult.error) throw shopResult.error
      if (requestResult.error) throw requestResult.error
      setShop((shopResult.data as ShopSummary | null) ?? null)
      setRequest((requestResult.data as ServiceRequest | null) ?? null)
      if (!requestResult.data) setError('This arrangement case was not found or is not assigned to your shop.')
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this arrangement case.')
    } finally {
      setLoading(false)
    }
  }, [navigate, requestId])

  useEffect(() => {
    void loadRequest()
  }, [loadRequest])

  useEffect(() => {
    return () => {
      if (proofPreview) URL.revokeObjectURL(proofPreview)
    }
  }, [proofPreview])

  useEffect(() => {
    if (!paymentReceiptOpen && !lightboxUrl) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (lightboxUrl) {
        setLightboxUrl(null)
      } else {
        setPaymentReceiptOpen(false)
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [lightboxUrl, paymentReceiptOpen])

  const notifyRequester = async (config: { type: string; title: string; body: string }) => {
    if (!request) return
    const { data: sessionData } = await supabase.auth.getSession()
    await supabase.from('notifications').insert({
      userId: request.requesterId,
      type: config.type,
      title: config.title,
      body: config.body,
      data: { requestId: request.id, shopId: sessionData.session?.user.id },
      read: false,
    })
  }

  const updateRequestStatus = (nextStatus: 'accepted_by_shop' | 'declined_by_shop') => {
    if (!request || actionBusy) return
    const accepting = nextStatus === 'accepted_by_shop'
    const serviceFee = Number(shop?.serviceFeeAmount) || 0
    const requestProductPrice = Number(request.productPrice) || 0
    const finalAmount = requestProductPrice > 0 ? requestProductPrice : serviceFee

    if (accepting && finalAmount <= 0) {
      openAlert({
        title: 'Payment setup required',
        message: 'Configure the casket product price or shop default amount before accepting this request.',
        tone: 'warning',
        okLabel: 'Got it',
      })
      return
    }

    openConfirm({
      title: accepting ? 'Accept this request?' : 'Decline this request?',
      message: accepting
        ? 'The family will receive your payment instructions immediately.'
        : 'The family will be notified that your shop cannot take this case.',
      details: accepting
        ? [
            `Payment amount: ${formatPeso(finalAmount)}. The customer can complete payment securely via Xendit.`,
            request.productId === 'custom_casket_design'
              ? 'This custom design request will not change product stock.'
              : 'One item will be reserved from the product stock.',
          ]
        : ['No stock will be deducted.', 'You cannot process payment after declining the case.'],
      confirmLabel: accepting ? 'Accept request' : 'Decline request',
      cancelLabel: 'Keep reviewing',
      tone: accepting ? 'success' : 'danger',
      onConfirm: async () => {
        setActionBusy(true)
        try {
          if (accepting) {
            await acceptFuneralServiceRequest(request.id)
          } else {
            const respondedAt = new Date().toISOString()
            const { error: updateError } = await supabase
              .from('funeral_service_requests')
              .update({
                status: 'declined_by_shop',
                declinedAt: respondedAt,
                shopRespondedAt: respondedAt,
                updatedAt: respondedAt,
              })
              .eq('id', request.id)
              .eq('status', 'pending_shop_acceptance')
            if (updateError) throw updateError
          }

          try {
            await notifyRequester({
              type: accepting ? 'funeral_payment_ready' : 'funeral_request_updated',
              title: accepting ? 'Request Accepted - Payment Ready' : 'Request Declined',
              body: accepting
                ? `${shop?.shopName || 'The shop'} accepted your request. Please pay ${formatPeso(finalAmount)} using the payment options in your request.`
                : `${shop?.shopName || 'The shop'} declined your service request.`,
            })
          } catch {
            // A notification failure should not roll back the request update.
          }

          await loadRequest()
          openAlert({
            title: accepting ? 'Request accepted' : 'Request declined',
            message: accepting
              ? 'Payment instructions are now available to the family.'
              : 'The family has been notified of your response.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (updateError: unknown) {
          openAlert({
            title: 'Update failed',
            message: updateError instanceof Error ? updateError.message : 'The request could not be updated.',
            tone: 'danger',
            okLabel: 'Dismiss',
          })
        } finally {
          setActionBusy(false)
        }
      },
    })
  }

  const updatePayment = async (outcome: 'verified' | 'rejected') => {
    if (!request || actionBusy) return
    const reason = rejectionReason.trim()
    if (outcome === 'rejected' && !reason) {
      openAlert({
        title: 'Reason required',
        message: 'Add a short reason so the family knows what to correct.',
        tone: 'warning',
        okLabel: 'Got it',
      })
      return
    }

    setActionBusy(true)
    try {
      const now = new Date().toISOString()
      const { error: updateError } = await supabase
        .from('funeral_service_requests')
        .update(
          outcome === 'verified'
            ? {
                status: 'payment_verified',
                paymentVerifiedAt: now,
                paymentRejectionReason: null,
                updatedAt: now,
              }
            : {
                status: 'awaiting_payment',
                paymentVerifiedAt: null,
                paymentRejectionReason: reason,
                updatedAt: now,
              },
        )
        .eq('id', request.id)
        .eq('status', 'payment_submitted')
      if (updateError) throw updateError

      try {
        await notifyRequester({
          type: 'funeral_payment_updated',
          title: outcome === 'verified' ? 'Payment Verified' : 'Payment Needs Review',
          body: outcome === 'verified'
            ? 'The shop verified your payment for this service request.'
            : `The shop could not verify your payment: ${reason}. Please correct it and resubmit.`,
        })
      } catch {
        // A notification failure should not roll back the payment update.
      }

      setRejectMode(false)
      setRejectionReason('')
      await loadRequest()
      openAlert({
        title: outcome === 'verified' ? 'Payment verified' : 'Payment returned',
        message: outcome === 'verified'
          ? 'The case can now move into service.'
          : 'The family can correct the payment details and submit again.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (updateError: unknown) {
      openAlert({
        title: 'Payment update failed',
        message: updateError instanceof Error ? updateError.message : 'The payment status could not be updated.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setActionBusy(false)
    }
  }

  const handleProofChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      openAlert({
        title: 'Choose an image',
        message: 'Completion proof must be an image file.',
        tone: 'warning',
        okLabel: 'Got it',
      })
      event.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      openAlert({
        title: 'Image is too large',
        message: 'Choose a completion proof image smaller than 10 MB.',
        tone: 'warning',
        okLabel: 'Got it',
      })
      event.target.value = ''
      return
    }
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

  const clearProof = () => {
    setProofFile(null)
    setProofPreview(null)
    if (proofInputRef.current) proofInputRef.current.value = ''
  }

  const markServiceComplete = () => {
    if (!request || actionBusy) return
    if (!proofFile) {
      openAlert({
        title: 'Completion proof required',
        message: 'Attach a clear photo before sending the case to the family for confirmation.',
        tone: 'warning',
        okLabel: 'Got it',
      })
      return
    }

    openConfirm({
      title: 'Send for family confirmation?',
      message: 'The completion proof will be shared with the family for their review.',
      details: ['The case will remain open until the family confirms it as done.'],
      confirmLabel: 'Send completion',
      cancelLabel: 'Not yet',
      tone: 'success',
      onConfirm: async () => {
        setActionBusy(true)
        try {
          const { data: sessionData } = await supabase.auth.getSession()
          if (!sessionData.session?.user) throw new Error('Your session has expired. Please sign in again.')

          const extension = proofFile.name.split('.').pop() || 'jpg'
          const path = `completion-proof/request_${request.id}_${Date.now()}.${extension}`
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(path, proofFile, { upsert: true })
          if (uploadError) throw uploadError
          const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)

          const now = new Date().toISOString()
          const { error: updateError } = await supabase
            .from('funeral_service_requests')
            .update({
              status: 'awaiting_customer_confirmation',
              completionProofImageUrl: publicUrlData.publicUrl,
              shopMarkedCompletedAt: now,
              completedAt: null,
              updatedAt: now,
            })
            .eq('id', request.id)
            .eq('status', 'payment_verified')
          if (updateError) throw updateError

          try {
            await notifyRequester({
              type: 'funeral_request_completed',
              title: 'Review Your Completion',
              body: `${shop?.shopName || 'The shop'} marked your request as delivered and attached a completion proof. Review it and confirm the request as done.`,
            })
          } catch {
            // A notification failure should not roll back the completion update.
          }

          clearProof()
          await loadRequest()
          openAlert({
            title: 'Sent for confirmation',
            message: 'The family can now review your completion proof and confirm the case as done.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (completionError: unknown) {
          openAlert({
            title: 'Could not send completion',
            message: completionError instanceof Error ? completionError.message : 'Please try again.',
            tone: 'danger',
            okLabel: 'Dismiss',
          })
        } finally {
          setActionBusy(false)
        }
      },
    })
  }

  const timeline = useMemo(() => {
    if (!request) return []
    return [
      { label: 'Request created', value: request.createdAt },
      { label: 'Shop responded', value: request.shopRespondedAt },
      { label: 'Payment submitted', value: request.paymentSubmittedAt },
      { label: 'Payment verified', value: request.paymentVerifiedAt },
      { label: 'Sent for family confirmation', value: request.shopMarkedCompletedAt },
      { label: 'Case completed', value: request.completedAt },
      { label: 'Request declined', value: request.declinedAt },
      { label: 'Request cancelled', value: request.cancelledAt },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value))
  }, [request])

  const pageTopbar = (
    <header className="sr-topbar">
      <div className="sr-brand-group">
        <BrandLogo to="/seller" compact />
        {shop && (
          <>
            <span className="sr-brand-divider" aria-hidden="true" />
            <span className="sr-shop-label">{shop.shopName || 'Shop Center'}</span>
          </>
        )}
      </div>
      <Link to="/seller?tab=orders" className="sr-back-link">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        Back to Arrangement Cases
      </Link>
    </header>
  )

  if (loading || error || !request) {
    return (
      <div className="sr-page">
        {pageTopbar}
        <main className="sr-state">
          {loading ? (
            <>
              <span className="sr-spinner" aria-hidden="true" />
              <h1>Loading arrangement case</h1>
              <p>Getting the latest request and payment information.</p>
            </>
          ) : (
            <>
              <span className="sr-state-icon" aria-hidden="true">!</span>
              <h1>Arrangement case unavailable</h1>
              <p>{error || 'This service request could not be found.'}</p>
              <Link to="/seller?tab=orders" className="sr-button sr-button-primary">Back to Arrangement Cases</Link>
            </>
          )}
        </main>
        {alertDialog}
        {confirmDialog}
      </div>
    )
  }

  const normalizedStatus = String(request.status || '').toLowerCase()
  const meta = STATUS_META[normalizedStatus] || {
    label: titleCase(normalizedStatus || 'pending'),
    detail: 'Review the latest information for this case.',
    tone: 'neutral',
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
        message: 'This family payment was reviewed and confirmed by the shop.',
        tone: 'verified',
      }
    : normalizedStatus === 'payment_submitted'
      ? {
          title: 'Payment under review',
          message: 'Check the receipt information and submitted proof before verifying it.',
          tone: 'review',
        }
      : {
          title: 'Family payment',
          message: 'Review the available payment and receipt information for this request.',
          tone: 'default',
        }

  return (
    <div className="sr-page">
      {pageTopbar}

      <main className="sr-main">
        <section className="sr-case-header">
          <div>
            <span className="sr-document-kicker">LifeCycle Funeral Services</span>
            <h1>Service Request Record</h1>
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
                  <div className="sr-deceased-photo sr-deceased-photo-empty" aria-label="No deceased photo provided">
                    <span>No photo</span>
                  </div>
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
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(request.productImageUrl as string)}
                        aria-label="View requested service image"
                      >
                        <img src={request.productImageUrl} alt="" />
                      </button>
                    ) : null}
                    <div>
                      <strong>{request.productName || 'Custom casket service'}</strong>
                      <small>{request.variationName || titleCase(request.requestType)}</small>
                      {request.packageItems?.length ? <small>Packages: {request.packageItems.join(', ')}</small> : null}
                      <b>{formatPeso(request.productPrice)}</b>
                    </div>
                  </div>
                </div>
              </div>
              {request.customDesignNotes && (
                <div className="sr-note">
                  <span>Custom design notes</span>
                  <p>{request.customDesignNotes}</p>
                </div>
              )}
            </section>

            <div className="sr-card-grid">
              <section className="sr-card">
                <div className="sr-section-heading">
                  <h2>Family contact</h2>
                </div>
                <DetailList>
                  <DetailRow label="Requestor" value={request.familyCoordinatorName || request.requesterName || 'Not provided'} />
                  <DetailRow label="Contact number" value={request.contactNumber || 'Not provided'} />
                </DetailList>
              </section>

              <section className="sr-card">
                <div className="sr-section-heading">
                  <h2>Deceased information</h2>
                </div>
                <DetailList>
                  <DetailRow label="Full name" value={request.deceasedFullName || 'Not provided'} />
                  <DetailRow label="Date of birth" value={formatDate(request.deceasedDateOfBirth)} />
                  <DetailRow label="Date of passing" value={formatDate(request.deceasedDateOfPassing)} />
                  <DetailRow label="Age" value={request.deceasedAge ?? 'Not provided'} />
                </DetailList>
              </section>
            </div>

            {hasSchedule && (
              <section className="sr-card">
                <div className="sr-section-heading">
                  <h2>Schedule and logistics</h2>
                </div>
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
            )}

            {request.tributeMessage && (
              <section className="sr-card sr-tribute">
                <span>Tribute message</span>
                <blockquote>{request.tributeMessage}</blockquote>
              </section>
            )}

            {hasPayment && (
              <section className="sr-card sr-payment-summary">
                <div className="sr-section-heading">
                  <h2>Payment</h2>
                </div>
                <dl>
                  <div><dt>Status</dt><dd>{receiptMeta.title}</dd></div>
                  <div><dt>Amount</dt><dd>{formatPeso(request.paymentAmount)}</dd></div>
                  <div><dt>Reference number</dt><dd>{request.paymentReferenceNumber || 'Not provided'}</dd></div>
                  <div><dt>Submitted</dt><dd>{formatTimestamp(request.paymentSubmittedAt)}</dd></div>
                </dl>
                <button
                  type="button"
                  className="sr-view-receipt"
                  onClick={() => setPaymentReceiptOpen(true)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>
                  View payment receipt
                </button>
              </section>
            )}

            {paymentReceiptOpen && hasPayment && (
              <div className="sr-receipt-modal-overlay" role="presentation" onClick={() => setPaymentReceiptOpen(false)}>
                <div
                  className="sr-receipt-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="sr-payment-receipt-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="sr-receipt-modal-close"
                    aria-label="Close payment receipt"
                    onClick={() => setPaymentReceiptOpen(false)}
                    autoFocus
                  >
                    ×
                  </button>
                  <section className="sr-payment-receipt">
                <div className={`sr-receipt-hero sr-receipt-hero-${receiptMeta.tone}`}>
                  <div className="sr-receipt-status-icon" aria-hidden="true">
                    {receiptMeta.tone === 'verified' ? (
                      <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6" /></svg>
                    )}
                  </div>
                  <div className="sr-receipt-hero-copy">
                    <h2 id="sr-payment-receipt-title">{receiptMeta.title}</h2>
                    <p>{receiptMeta.message}</p>
                  </div>
                  <div className="sr-receipt-amount">
                    <span>{receiptMeta.tone === 'verified' ? 'Received' : 'Amount'}</span>
                    <strong>{formatPeso(request.paymentAmount)}</strong>
                  </div>
                </div>

                <div className="sr-receipt-body">
                  <section className="sr-receipt-section">
                    <h3>Order details</h3>
                    <dl className="sr-receipt-order-grid">
                      <div>
                        <dt>Order date</dt>
                        <dd>{formatTimestamp(request.paymentSubmittedAt || request.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Order ID</dt>
                        <dd>#{request.id.slice(0, 10).toUpperCase()}</dd>
                      </div>
                      <div>
                        <dt>Service address</dt>
                        <dd>{request.wakeAddress || 'Not provided'}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="sr-receipt-service">
                    {request.productImageUrl ? (
                      <button
                        type="button"
                        className="sr-receipt-service-image"
                        onClick={() => setLightboxUrl(request.productImageUrl as string)}
                        aria-label="View service image"
                      >
                        <img src={request.productImageUrl} alt="" />
                      </button>
                    ) : (
                      <div className="sr-receipt-service-image sr-receipt-service-fallback" aria-hidden="true">LC</div>
                    )}
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
                      {request.paymentVerifiedAt && (
                        <DetailRow label="Verified" value={formatTimestamp(request.paymentVerifiedAt)} />
                      )}
                    </DetailList>
                  </section>

                  {request.paymentRejectionReason && (
                    <div className="sr-inline-alert sr-inline-alert-danger">
                      <strong>Previous review note</strong>
                      <p>{request.paymentRejectionReason}</p>
                    </div>
                  )}

                  <section className="sr-receipt-proof">
                    <div>
                      <h3>Submitted receipt</h3>
                      <span>{request.paymentProofImageUrl ? 'Select the image to view it full size.' : 'No receipt was attached.'}</span>
                    </div>
                    {request.paymentProofImageUrl ? (
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(request.paymentProofImageUrl as string)}
                        aria-label="View submitted receipt full size"
                      >
                        <img src={request.paymentProofImageUrl} alt="Submitted payment receipt" />
                      </button>
                    ) : (
                      <div className="sr-receipt-missing">
                        <strong>Receipt unavailable</strong>
                        <span>No payment proof is attached to this request.</span>
                      </div>
                    )}
                  </section>
                </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          <aside className="sr-side-column">
            <section className="sr-card sr-action-card">
              <div className="sr-section-heading">
                <h2>
                  {['pending_shop_acceptance', 'payment_submitted', 'payment_verified'].includes(normalizedStatus)
                    ? 'Action required'
                    : 'Case status'}
                </h2>
              </div>
              <p className="sr-action-help">{meta.detail}</p>

              {normalizedStatus === 'pending_shop_acceptance' && (
                <div className="sr-action-stack">
                  <button
                    type="button"
                    className="sr-button sr-button-primary"
                    disabled={actionBusy}
                    onClick={() => updateRequestStatus('accepted_by_shop')}
                  >
                    Accept request
                  </button>
                  <button
                    type="button"
                    className="sr-button sr-button-danger-quiet"
                    disabled={actionBusy}
                    onClick={() => updateRequestStatus('declined_by_shop')}
                  >
                    Decline request
                  </button>
                </div>
              )}

              {normalizedStatus === 'payment_submitted' && (
                <div className="sr-action-stack">
                  <button
                    type="button"
                    className="sr-button sr-button-primary"
                    disabled={actionBusy}
                    onClick={() => {
                      openConfirm({
                        title: 'Verify this payment?',
                        message: 'Confirm that the amount, sender, and reference number match your payment record.',
                        confirmLabel: 'Verify payment',
                        cancelLabel: 'Review again',
                        tone: 'success',
                        onConfirm: () => updatePayment('verified'),
                      })
                    }}
                  >
                    Verify payment
                  </button>
                  {!rejectMode ? (
                    <button
                      type="button"
                      className="sr-button sr-button-secondary"
                      disabled={actionBusy}
                      onClick={() => setRejectMode(true)}
                    >
                      Payment needs correction
                    </button>
                  ) : (
                    <div className="sr-reject-form">
                      <label htmlFor="sr-rejection-reason">Reason for correction</label>
                      <textarea
                        id="sr-rejection-reason"
                        rows={3}
                        maxLength={300}
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        placeholder="Example: The reference number does not match our record."
                      />
                      <div>
                        <button
                          type="button"
                          className="sr-text-button"
                          onClick={() => {
                            setRejectMode(false)
                            setRejectionReason('')
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="sr-button sr-button-danger"
                          disabled={actionBusy || !rejectionReason.trim()}
                          onClick={() => void updatePayment('rejected')}
                        >
                          Return payment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {normalizedStatus === 'payment_verified' && (
                <div className="sr-completion">
                  {proofPreview ? (
                    <div className="sr-upload-preview">
                      <button type="button" onClick={() => setLightboxUrl(proofPreview)}>
                        <img src={proofPreview} alt="Completion proof preview" />
                      </button>
                      <div>
                        <strong>{proofFile?.name}</strong>
                        <button type="button" onClick={clearProof}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <label className="sr-upload">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14" /></svg>
                      <strong>Attach completion proof</strong>
                      <span>Image file, up to 10 MB</span>
                      <input
                        ref={proofInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleProofChange}
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    className="sr-button sr-button-primary"
                    disabled={actionBusy || !proofFile}
                    onClick={markServiceComplete}
                  >
                    {actionBusy ? 'Sending…' : 'Send for family confirmation'}
                  </button>
                </div>
              )}

              {normalizedStatus === 'awaiting_customer_confirmation' && (
                <div className="sr-inline-alert sr-inline-alert-info">
                  <strong>{request.completionProofSeenAt ? 'Seen by the family' : 'Delivered to the family'}</strong>
                  <p>
                    {request.completionProofSeenAt
                      ? `The family viewed the proof on ${formatTimestamp(request.completionProofSeenAt)}.`
                      : 'The exact time will appear here after the family opens the proof.'}
                  </p>
                </div>
              )}

              {!['pending_shop_acceptance', 'payment_submitted', 'payment_verified', 'awaiting_customer_confirmation'].includes(normalizedStatus) && (
                <div className="sr-inline-alert">
                  <strong>No action required</strong>
                  <p>This case is currently {meta.label.toLowerCase()}.</p>
                </div>
              )}
            </section>

            {request.completionProofImageUrl && (
              <section className="sr-card">
                <div className="sr-section-heading">
                  <h2>Completion proof</h2>
                </div>
                <button
                  type="button"
                  className="sr-completion-proof"
                  onClick={() => setLightboxUrl(request.completionProofImageUrl as string)}
                >
                  <img src={request.completionProofImageUrl} alt="Completion proof" />
                  <span>Open full image</span>
                </button>
              </section>
            )}

            <section className="sr-card">
              <div className="sr-section-heading">
                <h2>Activity</h2>
              </div>
              {timeline.length ? (
                <ol className="sr-timeline">
                  {timeline.map((item, index) => (
                    <li key={item.label} className={index === timeline.length - 1 ? 'current' : ''}>
                      <span aria-hidden="true" />
                      <div>
                        <strong>{item.label}</strong>
                        <time>{formatTimestamp(item.value)}</time>
                      </div>
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

      {lightboxUrl && (
        <div className="sr-lightbox" role="presentation" onClick={() => setLightboxUrl(null)}>
          <button type="button" aria-label="Close image" onClick={() => setLightboxUrl(null)}>×</button>
          <img src={lightboxUrl} alt="Full-size case attachment" onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      {alertDialog}
      {confirmDialog}
    </div>
  )
}
