import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import BrandLogo from '@/components/BrandLogo'
import './MyServiceRequestsPage.css'

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
}

type ServiceRequest = {
  id: string
  shopId: string
  shopName: string | null
  productName: string
  productImageUrl?: string | null
  productPrice?: number | string | null
  variationName?: string | null
  packageItems?: string[] | null
  requestType?: string
  customDesignNotes?: string | null
  referencePhotoUrl?: string | null
  memorialPhotoUrl?: string | null
  deceasedFullName: string
  deceasedDateOfBirth?: string | null
  deceasedDateOfPassing?: string | null
  deceasedAge?: number | null
  wakeAddress?: string | null
  churchName?: string | null
  cemeteryName?: string | null
  wakeStartDate?: string | null
  wakeEndDate?: string | null
  burialTime?: string | null
  tributeMessage?: string | null
  familyCoordinatorName?: string | null
  pickupAddress?: string | null
  contactNumber?: string | null
  shopContactNumber?: string | null
  shopAddress?: string | null
  status: string
  paymentQrUrl?: string | null
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
  completedAt?: string | null
  acceptedAt?: string | null
  declinedAt?: string | null
  cancelledAt?: string | null
  createdAt?: string
}

type PaymentSubmissionForm = {
  payerName: string
  gcashName: string
  gcashNumber: string
  referenceNumber: string
}

const EMPTY_PAYMENT_FORM: PaymentSubmissionForm = {
  payerName: '',
  gcashName: '',
  gcashNumber: '',
  referenceNumber: '',
}

function formatPeso(value: number | string | null | undefined): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(num)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatScheduleDate(value?: string | null) {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatTime(value?: string | null) {
  if (!value) return '—'
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return value
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function buildReceiptNumber(id: string) {
  return `RCPT-${String(id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`
}

function statusMeta(status?: string | null): { label: string; tone: string } {
  switch (String(status || '').toLowerCase()) {
    case 'pending_shop_acceptance':
      return { label: 'Waiting for Shop', tone: 'pending' }
    case 'accepted_by_shop':
      return { label: 'Accepted', tone: 'pending' }
    case 'awaiting_payment':
      return { label: 'Awaiting Payment', tone: 'pending' }
    case 'payment_submitted':
      return { label: 'Payment Submitted', tone: 'submitted' }
    case 'payment_verified':
      return { label: 'Payment Confirmed', tone: 'verified' }
    case 'awaiting_customer_confirmation':
      return { label: 'Awaiting Your Confirmation', tone: 'pending' }
    case 'completed':
      return { label: 'Completed', tone: 'verified' }
    case 'declined_by_shop':
      return { label: 'Declined', tone: 'rejected' }
    case 'cancelled_by_requester':
      return { label: 'Cancelled', tone: 'rejected' }
    default:
      return { label: String(status ?? '').replace(/_/g, ' '), tone: 'default' }
  }
}

function statusDetail(status?: string | null): {
  label: string
  background: string
  text: string
  message: string
  icon: 'wallet' | 'clock' | 'check' | 'alert'
} {
  switch (String(status || '').toLowerCase()) {
    case 'accepted_by_shop':
      return {
        label: 'Accepted by Shop',
        background: '#e7f5ec',
        text: '#166534',
        message: 'The shop accepted your request, but its saved payment setup is not complete yet.',
        icon: 'clock',
      }
    case 'awaiting_payment':
      return {
        label: 'Awaiting Payment',
        background: '#e0eefa',
        text: '#1c4f7e',
        message: 'Payment details are ready. Send the amount to the shop and submit your proof below.',
        icon: 'wallet',
      }
    case 'payment_submitted':
      return {
        label: 'Payment Under Review',
        background: '#e0eefa',
        text: '#1c4f7e',
        message: 'Your payment details are under review by the shop.',
        icon: 'clock',
      }
    case 'payment_verified':
      return {
        label: 'Payment Confirmed',
        background: '#e7f5ec',
        text: '#166534',
        message: 'Your payment is confirmed. The shop is preparing your casket.',
        icon: 'check',
      }
    case 'awaiting_customer_confirmation':
      return {
        label: 'Awaiting Your Confirmation',
        background: '#fef3c7',
        text: '#86654a',
        message: 'The shop has delivered and attached a completion proof. Review the photo and mark the request as done.',
        icon: 'clock',
      }
    case 'completed':
      return {
        label: 'Completed',
        background: '#14532d',
        text: '#ffffff',
        message: 'This request has been completed. Thank you.',
        icon: 'check',
      }
    case 'declined_by_shop':
      return {
        label: 'Declined',
        background: '#fde8e8',
        text: '#991b1b',
        message: 'This request was declined by the shop.',
        icon: 'alert',
      }
    case 'cancelled_by_requester':
      return {
        label: 'Cancelled',
        background: '#eef1ec',
        text: '#4c5b57',
        message: 'You cancelled this request.',
        icon: 'alert',
      }
    default:
      return {
        label: 'Waiting for Shop',
        background: '#fef3c7',
        text: '#86654a',
        message: 'Your request has been sent. Please wait while the shop reviews it.',
        icon: 'clock',
      }
  }
}

type MyServiceRequestsPageProps = {
  detailRequestId?: string
}

export default function MyServiceRequestsPage({ detailRequestId = '' }: MyServiceRequestsPageProps) {
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [requests, setRequests] = useState<ServiceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [reconnecting, setReconnecting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [submittingId, setSubmittingId] = useState('')
  const [proofFileInputRef] = useState<{ current: HTMLInputElement | null }>({ current: null })
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [detailsRequest, setDetailsRequest] = useState<ServiceRequest | null>(null)
  const [paymentInfoExpanded, setPaymentInfoExpanded] = useState(false)
  const [submittedProofExpanded, setSubmittedProofExpanded] = useState(false)

  const markedSeenRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    if (!detailsRequest) return
    if (String(detailsRequest.status || '').toLowerCase() !== 'awaiting_customer_confirmation') return
    if (!detailsRequest.completionProofImageUrl) return
    if (detailsRequest.completionProofSeenAt) return
    if (markedSeenRef.current[detailsRequest.id]) return
    markedSeenRef.current[detailsRequest.id] = true
    void (async () => {
      const { error: updateError } = await supabase
        .from('funeral_service_requests')
        .update({ completionProofSeenAt: new Date().toISOString() })
        .eq('id', detailsRequest.id)
        .eq('status', 'awaiting_customer_confirmation')
        .is('completionProofSeenAt', null)
      if (updateError) return
      setDetailsRequest((current) =>
        current ? { ...current, completionProofSeenAt: new Date().toISOString() } : current
      )
      const { error: notifyError } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('userId', viewerId)
        .eq('type', 'funeral_request_completed')
        .eq('data->>requestId', detailsRequest.id)
      if (notifyError) console.warn('Failed to mark notification read:', notifyError)
    })()
  }, [detailsRequest, viewerId])

  const paymentFormRefs = useRef<Record<string, PaymentSubmissionForm>>({})
  const [paymentForms, setPaymentForms] = useState<Record<string, PaymentSubmissionForm>>({})
  const [proofFiles, setProofFiles] = useState<Record<string, File | null>>({})
  const [proofPreviews, setProofPreviews] = useState<Record<string, string | null>>({})

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setLoading(false)
        return
      }
      setViewerId(session.user.id)
      const { data: userData } = await supabase
        .from('users')
        .select('fullName, photoURL')
        .eq('id', session.user.id)
        .maybeSingle()
      setProfile(userData ?? { fullName: session.user.email, photoURL: null })
    }
    void load()
  }, [])

  const loadRequests = useCallback(async (userId: string): Promise<boolean> => {
    try {
      let query = supabase
        .from('funeral_service_requests')
        .select('*')
        .eq('requesterId', userId)
      query = detailRequestId
        ? query.eq('id', detailRequestId).limit(1)
        : query.order('createdAt', { ascending: false }).limit(100)
      const { data, error } = await query
      if (error) throw error
      setRequests((data ?? []) as ServiceRequest[])
      setReconnecting(false)
      setLoading(false)
      return true
    } catch {
      setReconnecting(true)
      return false
    }
  }, [detailRequestId])

  useEffect(() => {
    if (!viewerId) return
    let cancelled = false
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (cancelled) return
      setLoading(true)
      const ok = await loadRequests(viewerId)
      if (cancelled) return
      if (ok) return
      const delay = Math.min(2000 * Math.pow(1.7, attempt), 30000)
      attempt += 1
      retryTimer = setTimeout(() => void run(), delay)
    }
    void run()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [viewerId, loadRequests, refreshKey])

  useEffect(() => {
    if (!detailRequestId) return
    setPaymentInfoExpanded(false)
    setSubmittedProofExpanded(false)
    setDetailsRequest(requests.find((request) => request.id === detailRequestId) ?? null)
  }, [detailRequestId, requests])

  const getForm = (requestId: string): PaymentSubmissionForm => paymentForms[requestId] ?? EMPTY_PAYMENT_FORM
  const setFormField = (requestId: string, field: keyof PaymentSubmissionForm, value: string) => {
    setPaymentForms(prev => ({ ...prev, [requestId]: { ...(prev[requestId] ?? EMPTY_PAYMENT_FORM), [field]: value } }))
    paymentFormRefs.current[requestId] = { ...(paymentFormRefs.current[requestId] ?? EMPTY_PAYMENT_FORM), [field]: value }
  }

  const handleProofFileChange = (requestId: string, file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      openAlert({ title: 'Invalid File', message: 'Please choose an image file as proof of payment.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (proofPreviews[requestId]) URL.revokeObjectURL(proofPreviews[requestId] as string)
    setProofFiles(prev => ({ ...prev, [requestId]: file }))
    setProofPreviews(prev => ({ ...prev, [requestId]: URL.createObjectURL(file) }))
  }

  const handleSubmitPayment = async (request: ServiceRequest) => {
    if (submittingId) return
    const form = getForm(request.id)
    if (!form.payerName.trim() || !form.gcashName.trim() || !form.gcashNumber.trim()) {
      openAlert({ title: 'Incomplete Details', message: 'Please provide the sender name, GCash account name, and GCash number.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (!proofFiles[request.id]) {
      openAlert({ title: 'Proof Required', message: 'Please upload a screenshot or photo of your payment proof.', tone: 'warning', okLabel: 'Got It' })
      return
    }
    if (!viewerId) return

    setSubmittingId(request.id)
    try {
      const file = proofFiles[request.id] as File
      const ext = file.name.split('.').pop() || 'png'
      const path = `payment-proof/user_${viewerId}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)

      const { error } = await supabase
        .from('funeral_service_requests')
        .update({
          status: 'payment_submitted',
          paymentPayerName: form.payerName.trim(),
          paymentGcashName: form.gcashName.trim(),
          paymentGcashNumber: form.gcashNumber.trim(),
          paymentReferenceNumber: form.referenceNumber.trim() || null,
          paymentProofImageUrl: urlData.publicUrl,
          paymentSubmittedAt: new Date().toISOString(),
          paymentRejectionReason: null,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('status', 'awaiting_payment')
      if (error) throw error

      try {
        await supabase.from('notifications').insert({
          userId: request.shopId,
          type: 'funeral_payment_submitted',
          title: 'Payment Submitted',
          body: `${form.payerName.trim()} submitted payment proof for ${request.productName || 'your service request'}. Please verify it.`,
          data: { requestId: request.id, requesterId: viewerId },
          read: false,
        })
      } catch {
        // Notification failure is non-blocking.
      }

      openAlert({
        title: 'Payment Submitted',
        message: 'Your payment proof has been submitted. The shop will verify it shortly.',
        tone: 'info',
        okLabel: 'Done',
      })

      if (proofPreviews[request.id]) {
        URL.revokeObjectURL(proofPreviews[request.id] as string)
      }
      setProofFiles(prev => ({ ...prev, [request.id]: null }))
      setProofPreviews(prev => ({ ...prev, [request.id]: null }))
      setPaymentForms(prev => ({ ...prev, [request.id]: EMPTY_PAYMENT_FORM }))
      paymentFormRefs.current[request.id] = EMPTY_PAYMENT_FORM

      const submittedRequest: ServiceRequest = {
        ...request,
        status: 'payment_submitted',
        paymentPayerName: form.payerName.trim(),
        paymentGcashName: form.gcashName.trim(),
        paymentGcashNumber: form.gcashNumber.trim(),
        paymentReferenceNumber: form.referenceNumber.trim() || null,
        paymentProofImageUrl: urlData.publicUrl,
        paymentSubmittedAt: new Date().toISOString(),
        paymentRejectionReason: null,
      }
      setDetailsRequest(submittedRequest)

      if (viewerId) void loadRequests(viewerId)
    } catch (err: any) {
      openAlert({ title: 'Submit Failed', message: 'Failed to submit your payment: ' + (err?.message || 'Unknown error.'), tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setSubmittingId('')
    }
  }

  const handleConfirmCompletion = async (request: ServiceRequest) => {
    if (submittingId || !viewerId) return
    setSubmittingId(request.id)
    try {
      const { error } = await supabase
        .from('funeral_service_requests')
        .update({
          status: 'completed',
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('status', 'awaiting_customer_confirmation')
      if (error) throw error

      try {
        await supabase.from('notifications').insert({
          userId: request.shopId,
          type: 'funeral_request_confirmed',
          title: 'Request Confirmed',
          body: `${profile?.fullName || 'The customer'} confirmed the request for ${request.productName || 'your service'} as done.`,
          data: { requestId: request.id, requesterId: viewerId },
          read: false,
        })
      } catch {
        // Notification failure is non-blocking.
      }

      openAlert({
        title: 'Marked as Done',
        message: 'Thank you for confirming! The shop will see that this request has been completed.',
        tone: 'info',
        okLabel: 'Done',
      })
      if (viewerId) void loadRequests(viewerId)
    } catch (err: any) {
      openAlert({ title: 'Confirm Failed', message: 'Failed to confirm completion: ' + (err?.message || 'Unknown error.'), tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setSubmittingId('')
    }
  }

  const canShowPaymentSection = (r: ServiceRequest) => {
    const status = String(r.status || '').toLowerCase()
    const hasPaymentSetup = Boolean(r.paymentQrUrl) && r.paymentAmount != null && Number(r.paymentAmount) > 0
    return ['awaiting_payment', 'payment_submitted', 'payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status) && hasPaymentSetup
  }

  return (
    <div className="requests-shop-page">
      <div className="requests-topbar">
        <div className="requests-topbar-left">
          <button
            type="button"
            className="requests-back-btn"
            onClick={() => navigate(detailRequestId ? '/user/requests' : '/user/profile')}
            aria-label={detailRequestId ? 'Back to service requests' : 'Go back to profile'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Back
          </button>
        </div>
        <div className="requests-topbar-right">
          <Link to="/user/notifications">Notifications</Link>
          <Link to="/user/help">Help Centre</Link>
          <span className="requests-divider" aria-hidden="true">|</span>
          <div className="requests-user-menu">
            <button type="button" className="requests-user-menu-trigger" aria-label="Open account menu">
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Account" className="requests-user-avatar" />
              ) : (
                <span className="requests-user-avatar requests-user-avatar-placeholder" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" /></svg>
                </span>
              )}
              <span className="requests-topbar-user">{profile?.fullName || 'User'}</span>
              <svg className="requests-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="requests-user-dropdown">
              <Link to="/user/profile">My Account</Link>
              <Link to="/user/purchase">Payments</Link>
              <Link to="/auth/switch-account">Switch Account</Link>
              <Link to="/auth/logout">Log out</Link>
            </div>
          </div>
        </div>
      </div>

      <header className="requests-header">
        <BrandLogo to="/funeral" compact className="requests-brand" />
        <div className="requests-header-divider" />
        <h1>{detailRequestId ? 'Request Details' : 'My Service Requests'}</h1>
      </header>

      {!detailRequestId ? <main className="requests-main">
        <button
          type="button"
          className="requests-refresh-btn"
          disabled={loading}
          onClick={() => setRefreshKey(key => key + 1)}
        >
          {loading ? 'Refreshing…' : 'Refresh Requests'}
        </button>
        {loading ? (
          <section className="requests-empty-state">
            <h2>{reconnecting ? 'Reconnecting…' : 'Loading…'}</h2>
            {reconnecting ? <p>Connection lost. Still trying to load your requests...</p> : null}
          </section>
        ) : requests.length === 0 ? (
          <section className="requests-empty-state">
            <h2>No Service Requests Yet</h2>
            <p>Your funeral service requests will appear here once you send them to a shop.</p>
            <Link to="/funeral" className="requests-browse-btn">Browse Products</Link>
          </section>
        ) : (
          requests.map(request => {
            const payMeta = statusMeta(request.status)
            const showPayment = canShowPaymentSection(request)
            const paymentForm = getForm(request.id)
            const canSubmit = String(request.status || '').toLowerCase() === 'awaiting_payment'

            return (
              <section key={request.id} className="requests-card">
                <div className="requests-card-header">
                    <div className="requests-card-product">
                      <button
                        type="button"
                        className="requests-product-thumb requests-clickable"
                        disabled={!request.productImageUrl}
                        aria-label={request.productImageUrl ? `View ${request.productName || 'product'} photo full size` : undefined}
                        title={request.productImageUrl ? 'Click to view full size' : undefined}
                        onClick={() => request.productImageUrl && setViewerUrl(request.productImageUrl)}
                      >
                        {request.productImageUrl ? <img src={request.productImageUrl} alt={request.productName} /> : <span>LC</span>}
                      </button>
                    <div>
                      <h3>{request.productName || 'Custom Casket'}</h3>
                      <p className="requests-card-shop">{request.shopName || 'Funeral Shop'}</p>
                      {request.variationName && <p className="requests-card-sub">Variation: {request.variationName}</p>}
                    </div>
                  </div>
                  <span className={`requests-status status-${(request.status || 'pending').toLowerCase()}`}>{payMeta.label}</span>
                </div>

                <div className="requests-card-meta">
                  <span className="requests-meta-item"><strong>Deceased:</strong> {request.deceasedFullName || '—'}</span>
                  {request.deceasedDateOfBirth && <span className="requests-meta-item"><strong>Date of Birth:</strong> {formatDate(request.deceasedDateOfBirth)}</span>}
                  {request.deceasedDateOfPassing && <span className="requests-meta-item"><strong>Date of Passing:</strong> {formatDate(request.deceasedDateOfPassing)}</span>}
                  {request.deceasedAge != null && <span className="requests-meta-item"><strong>Age at Passing:</strong> {request.deceasedAge}</span>}
                  {(request.wakeStartDate || request.wakeEndDate) && (
                    <span className="requests-meta-item">
                      <strong>Wake Schedule:</strong>{' '}
                      {formatScheduleDate(request.wakeStartDate)} to {formatScheduleDate(request.wakeEndDate)}
                    </span>
                  )}
                  {request.burialTime && <span className="requests-meta-item"><strong>Burial Time:</strong> {formatTime(request.burialTime)}</span>}
                  <span className="requests-meta-item"><strong>Requested:</strong> {request.createdAt ? formatDate(request.createdAt) : '—'}</span>
                </div>

                {showPayment && (
                  <div className="requests-payment">
                    <div className="requests-payment-head">
                      <h4>Payment Details</h4>
                      <span className={`requests-pay-pill pay-${payMeta.tone}`}>{payMeta.label}</span>
                    </div>
                    <div className="requests-payment-body">
                      <div className="requests-payment-qr">
                        {request.paymentQrUrl ? (
                          <button
                            type="button"
                            className="requests-qr-btn"
                            aria-label="View payment QR full size"
                            title="Click to view full size"
                            onClick={() => setViewerUrl(request.paymentQrUrl!)}
                          >
                            <img src={request.paymentQrUrl} alt="Payment QR" />
                          </button>
                        ) : (
                          <div className="requests-payment-qr-empty">No QR available</div>
                        )}
                      </div>
                      <div className="requests-payment-info">
                        <div className="requests-amount">
                          <span>Amount to send</span>
                          <strong>{request.paymentAmount != null && Number(request.paymentAmount) > 0 ? formatPeso(request.paymentAmount) : '—'}</strong>
                        </div>
                        <p className="requests-payment-hint">
                          Scan the QR code with your GCash (or other e-wallet) app and send the exact amount above. Then fill in your details and upload proof of payment.
                        </p>

                        {String(request.status || '').toLowerCase() === 'awaiting_payment' && request.paymentRejectionReason && (
                          <div className="requests-reject-card">
                            <strong>Your submission was rejected</strong>
                            <p>{request.paymentRejectionReason}</p>
                          </div>
                        )}

                        {(request.paymentProofImageUrl || request.paymentPayerName) && ['payment_submitted', 'payment_verified', 'completed'].includes(String(request.status || '').toLowerCase()) && (
                          <div className="requests-proof-summary">
                            {request.paymentPayerName && <div><span>Payer:</span> <strong>{request.paymentPayerName}</strong></div>}
                            {request.paymentGcashName && <div><span>GCash Name:</span> <strong>{request.paymentGcashName}</strong></div>}
                            {request.paymentGcashNumber && <div><span>GCash Number:</span> <strong>{request.paymentGcashNumber}</strong></div>}
                            {request.paymentReferenceNumber && <div><span>Reference:</span> <strong>{request.paymentReferenceNumber}</strong></div>}
                            {request.paymentProofImageUrl && (
                              <>
                                <button
                                  type="button"
                                  className="requests-proof-img-btn"
                                  aria-label="View proof of payment full size"
                                  title="Click to view full size"
                                  onClick={() => setViewerUrl(request.paymentProofImageUrl!)}
                                >
                                  <img src={request.paymentProofImageUrl} alt="Proof of payment" />
                                </button>
                                <a className="requests-proof-link" href={request.paymentProofImageUrl} target="_blank" rel="noreferrer">
                                  View proof of payment
                                </a>
                              </>
                            )}
                          </div>
                        )}

                        {request.completionProofImageUrl && (
                          <div className="requests-proof-summary">
                            <div><span>Completion Proof:</span></div>
                            <button
                              type="button"
                              className="requests-proof-img-btn"
                              aria-label="View completion proof full size"
                              title="Click to view full size"
                              onClick={() => setViewerUrl(request.completionProofImageUrl!)}
                            >
                              <img src={request.completionProofImageUrl} alt="Completion proof" />
                            </button>
                            <a className="requests-proof-link" href={request.completionProofImageUrl} target="_blank" rel="noreferrer">
                              View completion proof
                            </a>
                          </div>
                        )}

                        {canSubmit && (
                          <div className="requests-payment-form">
                            <div className="requests-form-row">
                              <label>Payer Name</label>
                              <input
                                type="text"
                                className="requests-input"
                                placeholder="Name used on the payment"
                                value={paymentForm.payerName}
                                onChange={e => setFormField(request.id, 'payerName', e.target.value)}
                              />
                            </div>
                            <div className="requests-form-row">
                              <label>GCash Account Name</label>
                              <input
                                type="text"
                                className="requests-input"
                                placeholder="Name registered to the GCash account"
                                value={paymentForm.gcashName}
                                onChange={e => setFormField(request.id, 'gcashName', e.target.value)}
                              />
                            </div>
                            <div className="requests-form-row">
                              <label>GCash Number</label>
                              <input
                                type="text"
                                className="requests-input"
                                placeholder="e.g. 0917 123 4567"
                                value={paymentForm.gcashNumber}
                                onChange={e => setFormField(request.id, 'gcashNumber', e.target.value)}
                              />
                            </div>
                            <div className="requests-form-row">
                              <label>Reference Number (Optional)</label>
                              <input
                                type="text"
                                className="requests-input"
                                placeholder="Enter it if shown on your receipt"
                                value={paymentForm.referenceNumber}
                                onChange={e => setFormField(request.id, 'referenceNumber', e.target.value)}
                              />
                            </div>
                            <div className="requests-form-row">
                              <label>Proof of Payment</label>
                              <input
                                ref={el => { proofFileInputRef.current = el }}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={e => {
                                  handleProofFileChange(request.id, e.target.files?.[0] ?? null)
                                  e.target.value = ''
                                }}
                              />
                              {proofPreviews[request.id] ? (
                                <div className="requests-proof-preview">
                                  <button
                                    type="button"
                                    className="requests-proof-img-btn"
                                    aria-label="View uploaded proof full size"
                                    title="Click to view full size"
                                    onClick={() => setViewerUrl(proofPreviews[request.id] as string)}
                                  >
                                    <img src={proofPreviews[request.id] as string} alt="Proof preview" />
                                  </button>
                                  <button type="button" className="requests-remove-proof" onClick={() => {
                                    if (proofPreviews[request.id]) URL.revokeObjectURL(proofPreviews[request.id] as string)
                                    setProofFiles(prev => ({ ...prev, [request.id]: null }))
                                    setProofPreviews(prev => ({ ...prev, [request.id]: null }))
                                  }}>
                                    Remove
                                  </button>
                                </div>
                              ) : (
                                <button type="button" className="requests-upload-btn" onClick={() => proofFileInputRef.current?.click()}>
                                  Upload Proof Image
                                </button>
                              )}
                            </div>
                            <button
                              type="button"
                              className="requests-submit-btn"
                              disabled={Boolean(submittingId)}
                              onClick={() => void handleSubmitPayment(request)}
                            >
                              {submittingId === request.id ? 'Submitting…' : 'Submit Payment Proof'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="requests-payment-actions">
                      <button
                        type="button"
                        className="requests-details-btn"
                        onClick={() => navigate(`/user/requests/${request.id}`)}
                      >
                        View request details
                      </button>
                      {String(request.status || '').toLowerCase() === 'awaiting_customer_confirmation' && (
                        <button
                          type="button"
                          className="requests-submit-btn"
                          disabled={Boolean(submittingId)}
                          onClick={() => void handleConfirmCompletion(request)}
                        >
                          {submittingId === request.id ? 'Confirming…' : 'Mark as Done'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {!showPayment ? (
                  <div className="requests-card-footer">
                    <button type="button" className="requests-details-btn" onClick={() => navigate(`/user/requests/${request.id}`)}>
                      View request details
                    </button>
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </main> : null}

      {detailRequestId && !detailsRequest ? (
        <main className="requests-main">
          <section className="requests-empty-state">
            <h2>{loading || reconnecting ? 'Loading request…' : 'Request not found'}</h2>
            {!loading && !reconnecting ? (
              <>
                <p>This request is unavailable or does not belong to your account.</p>
                <Link to="/user/requests" className="requests-browse-btn">Back to requests</Link>
              </>
            ) : null}
          </section>
        </main>
      ) : null}

      {viewerUrl && (
        <div className="requests-lightbox" onClick={() => setViewerUrl(null)}>
          <button type="button" className="requests-lightbox-close" aria-label="Close image" onClick={() => setViewerUrl(null)}>×</button>
          <img src={viewerUrl} alt="Full size view" onClick={(e) => e.stopPropagation()} />
          <a className="requests-lightbox-open" href={viewerUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Open in new tab
          </a>
        </div>
      )}

      {detailsRequest && (() => {
        const detail = detailsRequest
        const payDetail = statusDetail(detail.status)
        const amountSource = Number(detail.paymentAmount) > 0 ? detail.paymentAmount : detail.productPrice
        const amount = amountSource != null && Number(amountSource) > 0 ? formatPeso(amountSource) : 'Quote pending'
        const statusLabel = statusMeta(detail.status).label
        const paymentForm = getForm(detail.id)
        const paymentStatus = String(detail.status || '').toLowerCase()
        const showPaymentWorkspace = canShowPaymentSection(detail)

        return (
          <div className="requests-detail-page">
            <div
              className="requests-modal-card requests-payment-details-card"
              role="main"
              aria-labelledby="request-details-title"
            >
              <div className="requests-modal-header requests-pd-header">
                <div className="requests-pd-heading">
                  <div>
                    <h2 id="request-details-title">Service request record</h2>
                    <p className="requests-modal-sub">
                      {detail.shopName || 'Funeral Shop'} · Request #{detail.id.slice(0, 8).toUpperCase()} · Filed {formatDateTime(detail.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="requests-pd-head-actions">
                  <span className={`requests-pay-pill pay-${statusMeta(detail.status).tone}`}>{statusLabel}</span>
                </div>
              </div>

              <div className="requests-modal-body requests-pd-body">
                <section className="requests-record-overview" aria-label="Request overview">
                  {detail.memorialPhotoUrl ? (
                    <button
                      type="button"
                      className="requests-record-photo"
                      onClick={() => setViewerUrl(detail.memorialPhotoUrl!)}
                      aria-label="View memorial portrait"
                    >
                      <img src={detail.memorialPhotoUrl} alt={detail.deceasedFullName || 'Deceased'} />
                    </button>
                  ) : (
                    <div className="requests-record-photo requests-record-photo-empty">No photo</div>
                  )}

                  <div className="requests-record-person">
                    <span>Deceased</span>
                    <h3>{detail.deceasedFullName || 'Name not provided'}</h3>
                    <dl>
                      <div>
                        <dt>Date of passing</dt>
                        <dd>{detail.deceasedDateOfPassing ? formatDate(detail.deceasedDateOfPassing) : 'Not provided'}</dd>
                      </div>
                      <div>
                        <dt>Age</dt>
                        <dd>{detail.deceasedAge ?? 'Not provided'}</dd>
                      </div>
                      <div>
                        <dt>Family coordinator</dt>
                        <dd>{detail.familyCoordinatorName || 'Not provided'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="requests-record-service">
                    <span>Requested service</span>
                    <div>
                      {detail.productImageUrl ? (
                        <button
                          type="button"
                          onClick={() => setViewerUrl(detail.productImageUrl!)}
                          aria-label="View requested service image"
                        >
                          <img src={detail.productImageUrl} alt="" />
                        </button>
                      ) : (
                        <div className="requests-record-service-fallback">LC</div>
                      )}
                      <div>
                        <strong>{detail.productName || 'Custom casket service'}</strong>
                        <small>{detail.variationName || 'Standard option'}</small>
                        {detail.packageItems?.length ? <small>Packages: {detail.packageItems.join(', ')}</small> : null}
                        <b>{amount}</b>
                      </div>
                    </div>
                  </div>

                  {detail.customDesignNotes || detail.referencePhotoUrl ? (
                    <div className="requests-record-note">
                      {detail.customDesignNotes ? (
                        <div>
                          <span>Custom design specifications</span>
                          <p>{detail.customDesignNotes}</p>
                        </div>
                      ) : null}
                      {detail.referencePhotoUrl ? (
                        <button type="button" className="requests-detail-media" onClick={() => setViewerUrl(detail.referencePhotoUrl!)}>
                          View design reference
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <div className="requests-pd-hero" style={{ backgroundColor: payDetail.background }}>
                  <div className="requests-pd-hero-copy">
                    <h3 style={{ color: payDetail.text }}>{payDetail.label}</h3>
                    <p style={{ color: payDetail.text }}>{payDetail.message}</p>
                  </div>
                </div>

                <section className="requests-detail-groups" aria-label="Request information">
                  <details>
                    <summary>Family and memorial information</summary>
                    <div className="requests-detail-grid">
                      <div><span>Date of birth</span><strong>{detail.deceasedDateOfBirth ? formatDate(detail.deceasedDateOfBirth) : 'Not provided'}</strong></div>
                      <div><span>Family contact</span><strong>{detail.contactNumber || 'Not provided'}</strong></div>
                    </div>
                    {detail.tributeMessage ? (
                      <div className="requests-detail-note">
                        <span>Tribute message</span>
                        <p>{detail.tributeMessage}</p>
                      </div>
                    ) : null}
                  </details>

                  <details>
                    <summary>Schedule and locations</summary>
                    <div className="requests-detail-grid">
                      <div><span>Wake venue</span><strong>{detail.wakeAddress || 'Not provided'}</strong></div>
                      <div><span>Church / chapel</span><strong>{detail.churchName || 'Not provided'}</strong></div>
                      <div><span>Cemetery</span><strong>{detail.cemeteryName || 'Not provided'}</strong></div>
                      <div><span>Pickup address</span><strong>{detail.pickupAddress || 'Not provided'}</strong></div>
                      <div><span>Wake start</span><strong>{formatScheduleDate(detail.wakeStartDate)}</strong></div>
                      <div><span>Wake end</span><strong>{formatScheduleDate(detail.wakeEndDate)}</strong></div>
                      <div><span>Burial time</span><strong>{formatTime(detail.burialTime)}</strong></div>
                      <div><span>Shop contact</span><strong>{detail.shopContactNumber || 'Not provided'}</strong></div>
                      <div className="requests-detail-wide"><span>Shop address</span><strong>{detail.shopAddress || 'Not provided'}</strong></div>
                    </div>
                  </details>

                  <details>
                    <summary>Activity history</summary>
                    <div className="requests-detail-timeline">
                      <div><span>Request submitted</span><strong>{formatDateTime(detail.createdAt)}</strong></div>
                      {detail.acceptedAt ? <div><span>Accepted by shop</span><strong>{formatDateTime(detail.acceptedAt)}</strong></div> : null}
                      {detail.paymentSubmittedAt ? <div><span>Payment submitted</span><strong>{formatDateTime(detail.paymentSubmittedAt)}</strong></div> : null}
                      {detail.paymentVerifiedAt ? <div><span>Payment verified</span><strong>{formatDateTime(detail.paymentVerifiedAt)}</strong></div> : null}
                      {detail.shopMarkedCompletedAt ? <div><span>Marked delivered</span><strong>{formatDateTime(detail.shopMarkedCompletedAt)}</strong></div> : null}
                      {detail.completedAt ? <div><span>Request completed</span><strong>{formatDateTime(detail.completedAt)}</strong></div> : null}
                      {detail.declinedAt ? <div><span>Request declined</span><strong>{formatDateTime(detail.declinedAt)}</strong></div> : null}
                      {detail.cancelledAt ? <div><span>Request cancelled</span><strong>{formatDateTime(detail.cancelledAt)}</strong></div> : null}
                    </div>
                  </details>
                </section>

                {showPaymentWorkspace ? (
                <div className="requests-pd-layout">
                  <aside className="requests-pd-sidebar">
                <div className="requests-pd-section-title">Order Details</div>
                <div className="requests-pd-box">
                  <div className="requests-pd-row">
                    <span>Order Date</span>
                    <strong>{formatDateTime(detail.paymentSubmittedAt || detail.createdAt)}</strong>
                  </div>
                  <div className="requests-pd-row">
                    <span>Order ID</span>
                    <strong>#{detail.id.slice(0, 10).toUpperCase()}</strong>
                  </div>
                  <div className="requests-pd-row">
                    <span>Service Address</span>
                    <strong>{detail.wakeAddress || '—'}</strong>
                  </div>
                </div>

                <div className="requests-pd-divider" />

                <div className="requests-pd-item">
                  {detail.productImageUrl ? (
                    <img src={detail.productImageUrl} alt={detail.productName} className="requests-pd-item-img" />
                  ) : (
                    <span className="requests-pd-item-fallback">LC</span>
                  )}
                  <div className="requests-pd-item-copy">
                    <strong>{detail.productName || 'Custom Casket'}</strong>
                    <span>{detail.variationName || 'Funeral service'}</span>
                    <span>{detail.shopName || 'Funeral Shop'}</span>
                  </div>
                  <strong className="requests-pd-item-amount">{amount}</strong>
                </div>

                <div className="requests-pd-divider" />

                <div className="requests-pd-pay-card">
                  <span className="requests-pd-kicker">Payment to shop</span>
                  <strong className="requests-pd-pay-amount">{amount}</strong>
                  {detail.paymentQrUrl ? (
                    <button
                      type="button"
                      className="requests-pd-qr-button"
                      onClick={() => setViewerUrl(detail.paymentQrUrl!)}
                      aria-label="Enlarge shop payment QR code"
                    >
                      <img src={detail.paymentQrUrl} alt="Shop payment QR code" />
                      <span>Click to enlarge</span>
                    </button>
                  ) : (
                    <div className="requests-pd-qr-missing">Payment QR is not available.</div>
                  )}
                  <ol className="requests-pd-steps">
                    <li>Scan the QR code with GCash or your e-wallet.</li>
                    <li>Send the exact amount shown above.</li>
                    <li>Enter the transaction details and attach your receipt.</li>
                  </ol>
                </div>
                  </aside>

                  <section className="requests-pd-main">
                {paymentStatus === 'awaiting_payment' ? (
                  <div className="requests-pd-form-card">
                    <div className="requests-pd-form-heading">
                      <div>
                        <span className="requests-pd-kicker">Payment information</span>
                        <h3>Submit your payment</h3>
                      </div>
                      <span>All fields marked * are required</span>
                    </div>

                    {detail.paymentRejectionReason ? (
                      <div className="requests-reject-card requests-pd-reject">
                        <strong>Your previous submission needs attention</strong>
                        <p>{detail.paymentRejectionReason}</p>
                      </div>
                    ) : null}

                    <div className="requests-pd-form-grid">
                      <label className="requests-form-row">
                        <span>Sender Name *</span>
                        <input
                          type="text"
                          className="requests-input"
                          autoComplete="name"
                          placeholder="Person sending the payment"
                          value={paymentForm.payerName}
                          onChange={e => setFormField(detail.id, 'payerName', e.target.value)}
                        />
                      </label>
                      <label className="requests-form-row">
                        <span>GCash Account Name *</span>
                        <input
                          type="text"
                          className="requests-input"
                          placeholder="Name registered to GCash"
                          value={paymentForm.gcashName}
                          onChange={e => setFormField(detail.id, 'gcashName', e.target.value)}
                        />
                      </label>
                      <label className="requests-form-row">
                        <span>GCash Number *</span>
                        <input
                          type="tel"
                          className="requests-input"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="09XX XXX XXXX"
                          value={paymentForm.gcashNumber}
                          onChange={e => setFormField(detail.id, 'gcashNumber', e.target.value)}
                        />
                      </label>
                      <label className="requests-form-row">
                        <span>Reference Number</span>
                        <input
                          type="text"
                          className="requests-input"
                          placeholder="Optional transaction reference"
                          value={paymentForm.referenceNumber}
                          onChange={e => setFormField(detail.id, 'referenceNumber', e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="requests-form-row requests-pd-upload-field">
                      <span>Proof of Payment *</span>
                      <input
                        ref={el => { proofFileInputRef.current = el }}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={e => {
                          handleProofFileChange(detail.id, e.target.files?.[0] ?? null)
                          e.target.value = ''
                        }}
                      />
                      {proofPreviews[detail.id] ? (
                        <div className="requests-pd-upload-preview">
                          <button type="button" onClick={() => setViewerUrl(proofPreviews[detail.id] as string)}>
                            <img src={proofPreviews[detail.id] as string} alt="Selected payment proof" />
                          </button>
                          <div>
                            <strong>{proofFiles[detail.id]?.name || 'Payment receipt'}</strong>
                            <span>Image ready to submit</span>
                            <button type="button" className="requests-remove-proof" onClick={() => {
                              if (proofPreviews[detail.id]) URL.revokeObjectURL(proofPreviews[detail.id] as string)
                              setProofFiles(prev => ({ ...prev, [detail.id]: null }))
                              setProofPreviews(prev => ({ ...prev, [detail.id]: null }))
                            }}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="requests-pd-upload" onClick={() => proofFileInputRef.current?.click()}>
                          <svg viewBox="0 0 24 24" fill="none" width="24" height="24" aria-hidden="true">
                            <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span><strong>Upload payment receipt</strong>PNG, JPG, or other image format</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="requests-submit-btn requests-pd-submit"
                      disabled={Boolean(submittingId)}
                      onClick={() => void handleSubmitPayment(detail)}
                    >
                      {submittingId === detail.id ? 'Submitting…' : 'Submit Payment Details'}
                    </button>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="requests-pd-accordion"
                  onClick={() => setPaymentInfoExpanded((v) => !v)}
                  aria-expanded={paymentInfoExpanded}
                >
                  <span>Payment Information</span>
                  <span className={`requests-pd-chevron${paymentInfoExpanded ? ' is-open' : ''}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
                {paymentInfoExpanded ? (
                  <div className="requests-pd-box">
                    <div className="requests-pd-row"><span>Payment Method</span><strong>GCash / E-wallet</strong></div>
                    {detail.paymentPayerName && <div className="requests-pd-row"><span>Sender</span><strong>{detail.paymentPayerName}</strong></div>}
                    {detail.paymentGcashName && <div className="requests-pd-row"><span>GCash Name</span><strong>{detail.paymentGcashName}</strong></div>}
                    {detail.paymentGcashNumber && <div className="requests-pd-row"><span>GCash Number</span><strong>{detail.paymentGcashNumber}</strong></div>}
                    {detail.paymentReferenceNumber && <div className="requests-pd-row"><span>Reference Number</span><strong>{detail.paymentReferenceNumber}</strong></div>}
                    {detail.paymentSubmittedAt && <div className="requests-pd-row"><span>Payment Submitted</span><strong>{formatDateTime(detail.paymentSubmittedAt)}</strong></div>}
                    {detail.paymentVerifiedAt && <div className="requests-pd-row"><span>Payment Verified</span><strong>{formatDateTime(detail.paymentVerifiedAt)}</strong></div>}
                  </div>
                ) : null}

                {detail.paymentProofImageUrl ? (
                  <div className="requests-pd-proof">
                    <button
                      type="button"
                      className="requests-pd-accordion"
                      onClick={() => setSubmittedProofExpanded((v) => !v)}
                      aria-expanded={submittedProofExpanded}
                    >
                      <span>Submitted Proof</span>
                      <span className={`requests-pd-chevron${submittedProofExpanded ? ' is-open' : ''}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
                          <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                    {submittedProofExpanded ? (
                      <button
                        type="button"
                        className="requests-pd-proof-img"
                        aria-label="View proof of payment full size"
                        title="Click to view full size"
                        onClick={() => setViewerUrl(detail.paymentProofImageUrl!)}
                      >
                        <img src={detail.paymentProofImageUrl} alt="Proof of payment" />
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {detail.completionProofImageUrl ? (
                  <div className="requests-pd-proof">
                    <div className="requests-pd-media-label">Completion Proof</div>
                    <button
                      type="button"
                      className="requests-pd-proof-img"
                      aria-label="View completion proof full size"
                      title="Click to view full size"
                      onClick={() => setViewerUrl(detail.completionProofImageUrl!)}
                    >
                      <img src={detail.completionProofImageUrl} alt="Completion proof" />
                    </button>
                  </div>
                ) : null}

                {String(detail.status || '').toLowerCase() === 'awaiting_customer_confirmation' ? (
                  <div className="requests-pd-confirm-note">
                    <strong>Awaiting your confirmation</strong>
                    <p>The shop has delivered and attached a completion proof above. Review the photo and confirm the request as done.</p>
                  </div>
                ) : null}

                <div className="requests-pd-divider" />

                <div className="requests-pd-total">
                  <span>Order Total</span>
                  <strong>{amount}</strong>
                </div>

                {paymentStatus !== 'awaiting_payment' ? (
                  <>
                <div className="requests-receipt-print">
                  <div className="receipt-brand">
                    <span className="receipt-brand-badge">LC</span>
                    <span className="receipt-brand-name">LifeCycle</span>
                    <span className="receipt-brand-sub">FUNERAL SERVICES</span>
                  </div>
                  <h3 className="receipt-title">Payment Receipt</h3>
                  <div className="receipt-meta">
                    <span>Receipt No: {buildReceiptNumber(detail.id)}</span>
                    <span>Issued: {formatDateTime(detail.paymentVerifiedAt || detail.paymentSubmittedAt || detail.createdAt)}</span>
                  </div>
                  <div className="receipt-divider" />
                  <div className="receipt-amount">
                    <span>Amount Paid</span>
                    <strong>{amount}</strong>
                  </div>
                  <div className="receipt-rows">
                    <div><span>Shop</span><strong>{detail.shopName || '—'}</strong></div>
                    <div><span>Service</span><strong>{detail.productName || '—'}{detail.variationName ? ` (${detail.variationName})` : ''}</strong></div>
                    <div><span>Deceased</span><strong>{detail.deceasedFullName || '—'}</strong></div>
                    <div><span>Paid By</span><strong>{detail.paymentPayerName || '—'}</strong></div>
                    <div><span>GCash Number</span><strong>{detail.paymentGcashNumber || '—'}</strong></div>
                    <div><span>GCash Reference</span><strong>{detail.paymentReferenceNumber || '—'}</strong></div>
                    <div><span>GCash Name</span><strong>{detail.paymentGcashName || '—'}</strong></div>
                    <div><span>Payment Method</span><strong>GCash / E-wallet</strong></div>
                  </div>
                  <div className="receipt-divider" />
                  <p className="receipt-footer">
                    Thank you for your payment. This receipt confirms your payment to {detail.shopName} through LifeCycle.
                  </p>
                </div>

                <button type="button" className="requests-print-btn" onClick={() => window.print()}>
                  Print Receipt
                </button>
                  </>
                ) : null}

                {String(detail.status || '').toLowerCase() === 'awaiting_customer_confirmation' ? (
                  <button
                    type="button"
                    className="requests-submit-btn requests-pd-confirm-btn"
                    disabled={Boolean(submittingId)}
                    onClick={() => void handleConfirmCompletion(detail)}
                  >
                    {submittingId === detail.id ? 'Confirming…' : 'Confirm as Done'}
                  </button>
                ) : null}
                  </section>
                </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      })()}

      {alertDialog}
    </div>
  )
}
