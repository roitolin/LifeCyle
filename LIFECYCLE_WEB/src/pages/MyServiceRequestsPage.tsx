import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import BrandLogo from '@/components/BrandLogo'
import LogoutLink from '@/components/LogoutLink'
import ServiceXenditModal from '@/components/ServiceXenditModal'
import DeathCertificateVaultCard from '@/components/DeathCertificateVaultCard'
import PageBackButton from '@/components/PageBackButton'
import AccountMobileHeader from '@/components/AccountMobileHeader'
import { syncServiceXenditCheckout } from '@/utils/serviceXendit'
import { getProfileAvatar } from '@/utils/profileAvatar'
import './MyServiceRequestsPage.css'

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
  gender?: string | null
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

const MANUAL_PAYMENT_ENABLED = false

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

function getRequestCardImage(request: ServiceRequest) {
  const isCustomCasket = String(request.requestType || '').toLowerCase() === 'custom_casket'
  return isCustomCasket
    ? request.referencePhotoUrl || request.productImageUrl || null
    : request.productImageUrl || null
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
        message: 'Payment is ready. Complete the secure online checkout below.',
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
  const [xenditModalRequest, setXenditModalRequest] = useState<ServiceRequest | null>(null)
  const [manualPaymentExpanded, setManualPaymentExpanded] = useState<Record<string, boolean>>({})

  const markedSeenRef = useRef<Record<string, boolean>>({})
  const openRequestChat = useCallback((otherUserId: string | null | undefined, contactLabel: string) => {
    const targetId = String(otherUserId || '').trim()
    if (!targetId || targetId === viewerId) {
      openAlert({
        title: 'Chat unavailable',
        message: `This request does not have another ${contactLabel} account available to contact.`,
        tone: 'warning',
        okLabel: 'Got it',
      })
      return
    }
    window.dispatchEvent(new CustomEvent('open-chat', { detail: { userId: targetId } }))
  }, [openAlert, viewerId])

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
        .select('fullName, photoURL, gender')
        .eq('id', session.user.id)
        .maybeSingle()
      setProfile(userData ?? { fullName: session.user.email, photoURL: null, gender: null })
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

  // Automatically sync online payment when window gains focus
  useEffect(() => {
    if (!viewerId) return
    const handleFocusSync = async () => {
      const awaitingReq = requests.find(r => String(r.status || '').toLowerCase() === 'awaiting_payment')
      if (awaitingReq) {
        try {
          const res = await syncServiceXenditCheckout(awaitingReq.id)
          if (res.paid || res.status === 'payment_verified') {
            void loadRequests(viewerId)
          }
        } catch {
          // ignore background sync errors
        }
      }
    }
    window.addEventListener('focus', handleFocusSync)
    document.addEventListener('visibilitychange', handleFocusSync)
    return () => {
      window.removeEventListener('focus', handleFocusSync)
      document.removeEventListener('visibilitychange', handleFocusSync)
    }
  }, [viewerId, requests, loadRequests, refreshKey])

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
    const hasPaymentSetup = r.paymentAmount != null && Number(r.paymentAmount) > 0
    return ['awaiting_payment', 'payment_submitted', 'payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(status) && hasPaymentSetup
  }

  return (
    <div className={`requests-shop-page${detailRequestId ? ' requests-shop-page-detail' : ''}`}>
      <AccountMobileHeader />
      <div className="requests-topbar">
        <div className="requests-topbar-right">
          <Link to="/user/notifications" className="requests-topbar-link">Notifications</Link>
          <Link to="/user/help" className="requests-topbar-link">Help Centre</Link>
          <span className="requests-divider" aria-hidden="true" />
          <div className="requests-user-menu">
            <button type="button" className="requests-user-menu-trigger" aria-label="Open account menu">
              <img src={getProfileAvatar(profile?.photoURL, profile?.gender)} alt="Account" className="requests-user-avatar" />
              <span className="requests-topbar-user">{profile?.fullName || 'User'}</span>
              <svg className="requests-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="requests-user-dropdown">
              <Link to="/user/profile">My Account</Link>
              <Link to="/user/purchase">My Payments</Link>
              <Link to="/auth/switch-account">Switch Account</Link>
              <LogoutLink>Log out</LogoutLink>
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
        <div className="page-back-row"><PageBackButton to="/user/profile" /></div>
        <div className="requests-list-toolbar">
          <div>
            <strong>{loading ? 'Loading requests' : requests.length + ' ' + (requests.length === 1 ? 'request' : 'requests')}</strong>
            <span>Track your arrangements and payment status.</span>
          </div>
          <button
            type="button"
            className="requests-refresh-btn"
            disabled={loading}
            onClick={() => setRefreshKey(key => key + 1)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
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
            const cardImageUrl = getRequestCardImage(request)

            return (
              <section key={request.id} className="requests-card">
                <div className="requests-card-header">
                    <div className="requests-card-product">
                      <button
                        type="button"
                        className="requests-product-thumb requests-clickable"
                        disabled={!cardImageUrl}
                        aria-label={cardImageUrl ? `View ${request.productName || 'product'} photo full size` : undefined}
                        title={cardImageUrl ? 'Click to view full size' : undefined}
                        onClick={() => cardImageUrl && setViewerUrl(cardImageUrl)}
                      >
                        {cardImageUrl ? <img src={cardImageUrl} alt={request.productName || 'Custom casket design'} /> : <span>LC</span>}
                      </button>
                    <div>
                      <h3>{request.productName || 'Custom Casket'}</h3>
                      <p className="requests-card-shop">{request.shopName || 'Funeral Shop'}</p>
                      {request.variationName && <p className="requests-card-sub">Variation: {request.variationName}</p>}
                    </div>
                  </div>
                  <div className="requests-card-header-right">
                    <span className={`requests-status status-${(request.status || 'pending').toLowerCase()}`}>{payMeta.label}</span>
                  </div>
                </div>

                <div className="requests-card-meta">
                  <span className="requests-meta-item"><small>Deceased</small><strong>{request.deceasedFullName || 'Not provided'}</strong></span>
                  {request.deceasedDateOfPassing && <span className="requests-meta-item"><small>Date of passing</small><strong>{formatDate(request.deceasedDateOfPassing)}</strong></span>}
                  {(request.wakeStartDate || request.wakeEndDate) && (
                    <span className="requests-meta-item requests-meta-wide">
                      <small>Wake schedule</small>
                      <strong>{formatScheduleDate(request.wakeStartDate)} to {formatScheduleDate(request.wakeEndDate)}</strong>
                    </span>
                  )}
                  {request.burialTime && <span className="requests-meta-item"><small>Burial time</small><strong>{formatTime(request.burialTime)}</strong></span>}
                  {canSubmit && request.paymentAmount != null && Number(request.paymentAmount) > 0 ? (
                    <span className="requests-meta-item"><small>Amount due</small><strong>{formatPeso(request.paymentAmount)}</strong></span>
                  ) : null}
                  <span className="requests-meta-item"><small>Requested</small><strong>{request.createdAt ? formatDate(request.createdAt) : 'Not provided'}</strong></span>
                </div>

                {showPayment && (
                  <div className="requests-payment">
                    <div className="requests-payment-head">
                      <h4>Payment Details</h4>
                      <span className={`requests-pay-pill pay-${payMeta.tone}`}>{payMeta.label}</span>
                    </div>
                    <div className="requests-payment-body">
                      <div className="requests-payment-info">
                        <div className="requests-amount">
                          <span>Amount to send</span>
                          <strong>{request.paymentAmount != null && Number(request.paymentAmount) > 0 ? formatPeso(request.paymentAmount) : '—'}</strong>
                        </div>

                        {canSubmit && (
                          <div className="requests-online-pay-box">
                            <button
                              type="button"
                              className="requests-pay-online-primary-btn"
                              onClick={() => setXenditModalRequest(request)}
                            >
                              <span className="requests-pay-flash-icon">⚡</span>
                              <span>Pay Online (GCash, Cards & Maya)</span>
                            </button>
                            <p className="requests-online-pay-hint">
                              Fast, automated payment verification via Xendit. Instant order confirmation.
                            </p>
                          </div>
                        )}

                        <p className="requests-payment-hint">
                          {canSubmit
                            ? 'Use secure online checkout to pay with GCash, Maya, cards, or online banking.'
                            : 'Payment details and confirmation appear here after checkout.'}
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

                        {MANUAL_PAYMENT_ENABLED && canSubmit && (
                          <div className="requests-manual-accordion">
                            <button
                              type="button"
                              className="requests-manual-accordion-btn"
                              onClick={() => setManualPaymentExpanded(prev => ({ ...prev, [request.id]: !prev[request.id] }))}
                            >
                              <span>Alternative manual payment</span>
                              <span>{manualPaymentExpanded[request.id] ? '▴' : '▾'}</span>
                            </button>
                            {manualPaymentExpanded[request.id] && (
                              <div className="requests-manual-accordion-body">
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
                              </div>
                            )}
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
                {(
                  <div className="requests-card-footer">
                    <button type="button" className="requests-details-btn" onClick={() => navigate(`/user/requests/${request.id}`)}>
                      View details
                    </button>
                    <div className="requests-card-actions">
                      {String(request.status || '').toLowerCase() === 'awaiting_customer_confirmation' ? (
                        <button
                          type="button"
                          className="requests-confirm-btn"
                          disabled={Boolean(submittingId)}
                          onClick={() => void handleConfirmCompletion(request)}
                        >
                          {submittingId === request.id ? 'Confirming...' : 'Mark as done'}
                        </button>
                      ) : null}
                      {canSubmit ? (
                        <button
                          type="button"
                          className="requests-card-pay-btn"
                          onClick={() => setXenditModalRequest(request)}
                        >
                          Pay now
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            )
          })
        )}
      </main> : null}

      {detailRequestId && !detailsRequest ? (
        <main className="requests-main">
          <div className="page-back-row"><PageBackButton to="/user/requests" /></div>
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
              aria-label="Request details"
            >
              <div className="requests-modal-header requests-pd-header">
                <div className="requests-pd-title-row">
                  <PageBackButton to="/user/requests" label="Back to requests" className="requests-detail-back" />
                </div>
                <div className="requests-pd-head-actions">
                  <span className={`requests-pay-pill pay-${statusMeta(detail.status).tone}`}>{statusLabel}</span>
                </div>
              </div>

              <div className="requests-modal-body requests-pd-body">
                <section className="requests-record-overview" aria-label="Request overview">
                  <div className="requests-record-service">
                    <span>Request #{detail.id.slice(0, 8).toUpperCase()}</span>
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
                        <strong>{detail.requestType === 'custom_casket' ? 'Custom Casket Request' : detail.productName || 'Service request'}</strong>
                        <small>Service request</small>
                      </div>
                    </div>
                  </div>

                  <div className="requests-record-facts">
                    <div>
                      <span>Shop</span>
                      <strong>{detail.shopName || 'Funeral Shop'}</strong>
                    </div>
                    <div>
                      <span>Submitted</span>
                      <strong>{formatDateTime(detail.createdAt)}</strong>
                    </div>
                  </div>
                </section>

                <div className="requests-pd-hero" style={{ backgroundColor: payDetail.background }}>
                  <div className="requests-pd-hero-copy">
                    <h3 style={{ color: payDetail.text }}>{payDetail.label}</h3>
                    <p style={{ color: payDetail.text }}>{payDetail.message}</p>
                  </div>
                </div>

                <section className="requests-detail-groups" aria-label="Request information">
                  <details open>
                    <summary>
                      <span><strong>Service options</strong><small>Variation, amount, and design information</small></span>
                    </summary>
                    <div className="requests-detail-grid">
                      <div><span>Selected variation</span><strong>{detail.variationName || 'Standard option'}</strong></div>
                      <div><span>Service amount</span><strong className="requests-service-amount">{amount}</strong></div>
                      {detail.packageItems?.length ? (
                        <div className="requests-detail-wide"><span>Package inclusions</span><strong>{detail.packageItems.join(', ')}</strong></div>
                      ) : null}
                    </div>
                    {detail.customDesignNotes ? (
                      <div className="requests-detail-note">
                        <span>Custom design specifications</span>
                        <p>{detail.customDesignNotes}</p>
                      </div>
                    ) : null}
                    {detail.referencePhotoUrl ? (
                      <button type="button" className="requests-detail-media" onClick={() => setViewerUrl(detail.referencePhotoUrl!)}>
                        View design reference photo
                      </button>
                    ) : null}
                  </details>

                  <details>
                    <summary>
                      <span><strong>Shop contact</strong><small>Contact the provider handling this request</small></span>
                    </summary>
                    <div className="requests-detail-grid">
                      <div><span>Shop</span><strong>{detail.shopName || 'Not available'}</strong></div>
                      <div><span>Contact number</span><strong>{detail.shopContactNumber || 'Not available'}</strong></div>
                      <div className="requests-detail-wide"><span>Shop address</span><strong>{detail.shopAddress || 'Not available'}</strong></div>
                    </div>
                    <div className="requests-contact-actions" aria-label="Shop contact actions">
                      <a
                        className={`requests-contact-action${detail.shopContactNumber ? '' : ' is-disabled'}`}
                        href={detail.shopContactNumber ? `tel:${detail.shopContactNumber.replace(/[^\d+]/g, '')}` : undefined}
                        aria-disabled={!detail.shopContactNumber}
                        onClick={event => { if (!detail.shopContactNumber) event.preventDefault() }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9Z" /></svg>
                        <span>Call shop</span>
                      </a>
                      <button
                        type="button"
                        className={`requests-contact-action${detail.shopId ? '' : ' is-disabled'}`}
                        disabled={!detail.shopId}
                        onClick={() => openRequestChat(detail.shopId, 'shop')}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.8 8.5 9.2 9.2 0 0 1-4.1-1l-4.1 1 1.1-3.7A8.2 8.2 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" /><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" /></svg>
                        <span>Chat with shop</span>
                      </button>
                    </div>
                  </details>

                  <details>
                    <summary>
                      <span><strong>Deceased information</strong><small>Personal and memorial details provided by the family</small></span>
                    </summary>
                    {detail.memorialPhotoUrl ? (
                      <button
                        type="button"
                        className="requests-detail-photo"
                        onClick={() => setViewerUrl(detail.memorialPhotoUrl!)}
                        aria-label="View memorial portrait"
                      >
                        <img src={detail.memorialPhotoUrl} alt={detail.deceasedFullName || 'Deceased'} />
                      </button>
                    ) : null}
                    <div className="requests-detail-grid">
                      <div><span>Full name</span><strong>{detail.deceasedFullName || 'Not provided'}</strong></div>
                      <div><span>Date of birth</span><strong>{detail.deceasedDateOfBirth ? formatDate(detail.deceasedDateOfBirth) : 'Not provided'}</strong></div>
                      <div><span>Date of passing</span><strong>{detail.deceasedDateOfPassing ? formatDate(detail.deceasedDateOfPassing) : 'Not provided'}</strong></div>
                      <div><span>Age at time of passing</span><strong>{detail.deceasedAge ?? 'Not provided'}</strong></div>
                      <div><span>Family coordinator</span><strong>{detail.familyCoordinatorName || 'Not provided'}</strong></div>
                      <div><span>Contact number</span><strong>{detail.contactNumber || 'Not provided'}</strong></div>
                    </div>
                    {detail.tributeMessage ? (
                      <div className="requests-detail-note">
                        <span>Tribute message</span>
                        <p>{detail.tributeMessage}</p>
                      </div>
                    ) : null}
                  </details>

                  <details>
                    <summary>
                      <span><strong>Wake &amp; burial schedule</strong><small>Review the dates and service locations carefully</small></span>
                    </summary>
                    <div className="requests-detail-grid">
                      <div><span>Wake venue</span><strong>{detail.wakeAddress || 'Not provided'}</strong></div>
                      <div><span>Church / chapel</span><strong>{detail.churchName || 'Not provided'}</strong></div>
                      <div><span>Cemetery</span><strong>{detail.cemeteryName || 'Not provided'}</strong></div>
                      <div><span>Pickup address</span><strong>{detail.pickupAddress || 'Not provided'}</strong></div>
                      <div><span>Wake start</span><strong>{formatScheduleDate(detail.wakeStartDate)}</strong></div>
                      <div><span>Wake end</span><strong>{formatScheduleDate(detail.wakeEndDate)}</strong></div>
                      <div className="requests-detail-wide"><span>Burial</span><strong>{detail.wakeEndDate && detail.burialTime ? `${formatScheduleDate(detail.wakeEndDate)} at ${formatTime(detail.burialTime)}` : 'Not provided'}</strong></div>
                    </div>
                  </details>

                  <details>
                    <summary>
                      <span><strong>Activity history</strong><small>Past request updates with their recorded date and time</small></span>
                    </summary>
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

                <DeathCertificateVaultCard serviceRequestId={detail.id} role="customer" />

                {showPaymentWorkspace ? (
                <div className="requests-pd-layout">
                  <aside className="requests-pd-sidebar">
                <div className="requests-pd-section-title">Payment details</div>
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

                  </aside>

                  <section className="requests-pd-main">
                {paymentStatus === 'awaiting_payment' ? (
                  <>
                    <div className="requests-pd-online-pay-card">
                      <div className="requests-pd-online-heading">
                        <div className="requests-pd-online-title-group">
                          <span className="requests-pd-online-title-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <rect x="3" y="5" width="18" height="14" rx="3" />
                              <path d="M3 10h18M7 15h3" />
                            </svg>
                          </span>
                          <div>
                          <span className="requests-pd-kicker">Recommended Payment</span>
                          <h3>Instant Online Checkout</h3>
                          </div>
                        </div>
                        <span className="requests-secure-pill">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6l-7-3Z" />
                            <path d="m9 12 2 2 4-4" />
                          </svg>
                          Secure checkout
                        </span>
                      </div>
                      <div className="requests-pd-online-gateway">
                        <span className="requests-pd-online-gateway-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M4 7.5h14.5A1.5 1.5 0 0 1 20 9v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h13" />
                            <path d="M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
                          </svg>
                        </span>
                        <div>
                          <strong>Xendit Payment Gateway</strong>
                          <span>GCash, Maya, cards and online banking</span>
                        </div>
                        <svg className="requests-pd-online-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="m8.5 12 2.2 2.2 4.8-4.8" />
                        </svg>
                      </div>
                      <button
                        type="button"
                        className="requests-pay-online-primary-btn requests-pd-pay-btn"
                        onClick={() => setXenditModalRequest(detail)}
                      >
                        <svg className="requests-pay-flash-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d="M13.2 2 5 13h6l-.2 9L19 11h-6l.2-9Z" />
                        </svg>
                        <span>Pay Online (GCash, Cards & Maya)</span>
                      </button>
                      <p className="requests-pd-online-desc">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="5" y="10" width="14" height="10" rx="2" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                        Payment is encrypted and verified automatically by Xendit
                      </p>
                    </div>

                    {MANUAL_PAYMENT_ENABLED && <div className="requests-manual-accordion">
                      <button
                        type="button"
                        className="requests-manual-accordion-btn"
                        onClick={() => setManualPaymentExpanded(prev => ({ ...prev, [detail.id]: !prev[detail.id] }))}
                      >
                        <span>Alternative manual payment</span>
                        <span>{manualPaymentExpanded[detail.id] ? '▴' : '▾'}</span>
                      </button>
                      {manualPaymentExpanded[detail.id] && (
                        <div className="requests-manual-accordion-body">
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
                                  <button
                                    type="button"
                                    className="requests-proof-img-btn"
                                    onClick={() => setViewerUrl(proofPreviews[detail.id] as string)}
                                    aria-label="View uploaded payment receipt"
                                  >
                                    <img src={proofPreviews[detail.id] as string} alt="Uploaded payment receipt" />
                                  </button>
                                  <button
                                    type="button"
                                    className="requests-remove-proof"
                                    onClick={() => {
                                      if (proofPreviews[detail.id]) URL.revokeObjectURL(proofPreviews[detail.id] as string)
                                      setProofFiles(prev => ({ ...prev, [detail.id]: null }))
                                      setProofPreviews(prev => ({ ...prev, [detail.id]: null }))
                                    }}
                                  >
                                    Remove receipt
                                  </button>
                                </div>
                              ) : (
                                <button type="button" className="requests-pd-upload" onClick={() => proofFileInputRef.current?.click()}>
                                  <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                        </div>
                      )}
                    </div>}
                  </>
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

                {paymentStatus !== 'awaiting_payment' ? (
                  <>
                <div className="requests-receipt-print">
                  <BrandLogo to="/funeral" compact className="receipt-brand-logo" />
                  <h3 className="receipt-title">Payment Receipt</h3>
                  <span className={`requests-pay-pill receipt-status pay-${statusMeta(detail.status).tone}`}>{statusLabel}</span>
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
                    <div><span>Sender</span><strong>{detail.paymentPayerName || '—'}</strong></div>
                    <div><span>GCash Name</span><strong>{detail.paymentGcashName || '—'}</strong></div>
                    <div><span>GCash Number</span><strong>{detail.paymentGcashNumber || '—'}</strong></div>
                    <div><span>GCash Reference</span><strong>{detail.paymentReferenceNumber || '—'}</strong></div>
                    <div><span>Payment Method</span><strong>GCash / E-wallet</strong></div>
                    {detail.shopAddress ? <div><span>Shop Address</span><strong>{detail.shopAddress}</strong></div> : null}
                    {detail.shopContactNumber ? <div><span>Shop Contact</span><strong>{detail.shopContactNumber}</strong></div> : null}
                  </div>
                  {detail.paymentProofImageUrl ? (
                    <button
                      type="button"
                      className="receipt-proof"
                      onClick={() => setViewerUrl(detail.paymentProofImageUrl!)}
                      aria-label="View payment proof full size"
                    >
                      <img src={detail.paymentProofImageUrl} alt="Payment proof" />
                    </button>
                  ) : null}
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

      <ServiceXenditModal
        isOpen={Boolean(xenditModalRequest)}
        request={xenditModalRequest}
        onClose={() => setXenditModalRequest(null)}
        onSuccess={() => {
          if (viewerId) void loadRequests(viewerId)
          if (detailsRequest && xenditModalRequest?.id === detailsRequest.id) {
            setDetailsRequest(prev => prev ? { ...prev, status: 'payment_verified' } : prev)
          }
        }}
      />
    </div>
  )
}
