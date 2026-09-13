import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { uploadCertificateWeb } from '@/lib/supabaseStorage'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import './CheckoutPage.css' // Reusing Checkout styles for consistent form layout

type ViewerProfile = {
  fullName?: string | null
  photoURL?: string | null
}

type CheckoutSuccessState = {
  requestId: string
  shopName: string
}

function generateId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    (Math.random() * 16 | 0).toString(16),
  )
}

function computeAgeFromDates(dob: Date | null, dop: Date | null): number | null {
  if (!dob || !dop) return null
  if (dop.getTime() <= dob.getTime()) return null
  const years = dop.getFullYear() - dob.getFullYear()
  const beforeBirthday =
    dop.getMonth() < dob.getMonth() ||
    (dop.getMonth() === dob.getMonth() && dop.getDate() < dop.getDate())
  return beforeBirthday ? years - 1 : years
}

export default function CustomCasketRequestPage() {
  const { shopId } = useParams()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const { openAlert, alertDialog } = useAlertDialog()
  const memorialFileInputRef = useRef<HTMLInputElement>(null)
  const referenceFileInputRef = useRef<HTMLInputElement>(null)

  // Viewer / profile
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [viewer, setViewer] = useState<{ id: string } | null>(null)

  // Shop state
  const [shopName, setShopName] = useState('Shop')
  const [shopContactNumber, setShopContactNumber] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [shopFound, setShopFound] = useState<boolean | null>(null)

  // Form state
  const [memorialPhotoUrl, setMemorialPhotoUrl] = useState<string | null>(null)
  const [memorialPhotoPreview, setMemorialPhotoPreview] = useState<string | null>(null)
  const [uploadingMemorial, setUploadingMemorial] = useState(false)

  const [referencePhotoUrl, setReferencePhotoUrl] = useState<string | null>(null)
  const [referencePhotoPreview, setReferencePhotoPreview] = useState<string | null>(null)
  const [uploadingReference, setUploadingReference] = useState(false)

  const [deceasedFullName, setDeceasedFullName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [dateOfPassing, setDateOfPassing] = useState('')
  const [tributeMessage, setTributeMessage] = useState('')
  const [familyCoordinatorName, setFamilyCoordinatorName] = useState('')
  const [wakeAddress, setWakeAddress] = useState('')
  const [churchName, setChurchName] = useState('')
  const [cemeteryName, setCemeteryName] = useState('')
  const [wakeStartDate, setWakeStartDate] = useState('')
  const [wakeEndDate, setWakeEndDate] = useState('')
  const [burialTime, setBurialTime] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [deceasedAge, setDeceasedAge] = useState('')
  const [designNotes, setDesignNotes] = useState('')
  const [ageInputMode, setAgeInputMode] = useState<'auto' | 'manual'>('auto')
  
  const [submitting, setSubmitting] = useState(false)
  const [successState, setSuccessState] = useState<CheckoutSuccessState | null>(null)

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setViewer(data.session?.user ? { id: data.session.user.id } : null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_, session) => {
      setViewer(session?.user ? { id: session.user.id } : null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  // Load profile and shop data
  useEffect(() => {
    const loadData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: userData } = await supabase
          .from('users')
          .select('fullName, photoURL')
          .eq('id', session.user.id)
          .maybeSingle()
        if (userData) {
          setProfile(userData)
          setFamilyCoordinatorName(String(userData.fullName || ''))
        }
      }

      if (shopId) {
        const { data: shopData } = await supabase
          .from('funeral_shops')
          .select('shopName, shopPhoneNumber, shopAddress')
          .eq('id', shopId)
          .maybeSingle()

        if (shopData) {
          setShopName(String(shopData.shopName || 'Shop'))
          setShopContactNumber(String(shopData.shopPhoneNumber || ''))
          setShopAddress(String(shopData.shopAddress || ''))
          setShopFound(true)
        } else {
          setShopFound(false)
        }
      }
    }
    void loadData()
  }, [shopId])

  // Photo uploads
  const handlePhotoSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>, type: 'memorial' | 'reference') => {
    const file = event.target.files?.[0]
    if (!file) return

    const previewUrl = URL.createObjectURL(file)
    if (type === 'memorial') {
      setMemorialPhotoPreview(previewUrl)
      setUploadingMemorial(true)
    } else {
      setReferencePhotoPreview(previewUrl)
      setUploadingReference(true)
    }

    try {
      const url = await uploadCertificateWeb(file)
      if (type === 'memorial') {
        setMemorialPhotoUrl(url)
      } else {
        setReferencePhotoUrl(url)
      }
    } catch (error: any) {
      openAlert({
        title: 'Upload Failed',
        message: error?.message || 'Failed to upload photo.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
      if (type === 'memorial') {
        setMemorialPhotoPreview(null)
        setMemorialPhotoUrl(null)
      } else {
        setReferencePhotoPreview(null)
        setReferencePhotoUrl(null)
      }
    } finally {
      if (type === 'memorial') setUploadingMemorial(false)
      else setUploadingReference(false)
    }
  }, [openAlert])

  const computedAge = useMemo(
    () => computeAgeFromDates(dateOfBirth ? new Date(dateOfBirth) : null, dateOfPassing ? new Date(dateOfPassing) : null),
    [dateOfBirth, dateOfPassing],
  )

  const ageMismatch =
    ageInputMode === 'manual' &&
    computedAge != null &&
    deceasedAge.trim() !== '' &&
    Number(deceasedAge) !== computedAge

  useEffect(() => {
    if (ageInputMode === 'auto' && computedAge != null) {
      setDeceasedAge(String(computedAge))
    }
  }, [ageInputMode, computedAge])

  // Submit
  const submitRequest = useCallback(async () => {
    if (!shopId || !viewer) return

    const safeDeceasedFullName = deceasedFullName.trim()
    const safeTributeMessage = tributeMessage.trim()
    const safeFamilyCoordinatorName = familyCoordinatorName.trim()
    const safeWakeAddress = wakeAddress.trim()
    const safeChurchName = churchName.trim()
    const safeCemeteryName = cemeteryName.trim()
    const safePickupAddress = pickupAddress.trim()
    const safeContactNumber = contactNumber.trim()
    const safeDesignNotes = designNotes.trim()
    const resolvedAge =
      ageInputMode === 'auto'
        ? computedAge != null
          ? String(computedAge)
          : deceasedAge.trim()
        : deceasedAge.trim()

    if (
      !memorialPhotoUrl ||
      !safeDeceasedFullName ||
      !dateOfBirth ||
      !dateOfPassing ||
      !resolvedAge ||
      !safeTributeMessage ||
      !safeFamilyCoordinatorName ||
      !safeWakeAddress ||
      !safeChurchName ||
      !safeCemeteryName ||
      !wakeStartDate ||
      !wakeEndDate ||
      !burialTime ||
      !safePickupAddress ||
      !safeContactNumber ||
      !safeDesignNotes
    ) {
      openAlert({
        title: 'Incomplete Details',
        message: 'Please complete all required details before sending your custom request.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    if (wakeStartDate < dateOfPassing || wakeEndDate < dateOfPassing) {
      openAlert({
        title: 'Invalid Wake Schedule',
        message: 'The wake start and end dates cannot be before the date of passing.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    if (wakeEndDate < wakeStartDate) {
      openAlert({
        title: 'Invalid Wake Schedule',
        message: 'The wake end date cannot be earlier than the wake start date.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    setSubmitting(true)
    try {
      const requestId = generateId()
      const { error } = await supabase.from('funeral_service_requests').insert({
        id: requestId,
        requesterId: viewer.id,
        shopId: shopId,
        shopName: shopName,
        shopContactNumber: shopContactNumber || null,
        shopAddress: shopAddress || null,
        cartId: `custom_${Date.now()}`,
        productId: 'custom_casket_design',
        productName: 'Custom Casket Design',
        productPrice: null,
        productImageUrl: null,
        variationName: null,
        requestType: 'custom_casket',
        customDesignNotes: safeDesignNotes,
        memorialPhotoUrl,
        referencePhotoUrl,
        deceasedFullName: safeDeceasedFullName,
        deceasedDateOfBirth: new Date(dateOfBirth).toISOString(),
        deceasedDateOfPassing: new Date(dateOfPassing).toISOString(),
        deceasedAge: Number(resolvedAge) || null,
        tributeMessage: safeTributeMessage,
        familyCoordinatorName: safeFamilyCoordinatorName,
        wakeAddress: safeWakeAddress,
        churchName: safeChurchName,
        cemeteryName: safeCemeteryName,
        wakeStartDate,
        wakeEndDate,
        burialTime,
        pickupAddress: safePickupAddress,
        contactNumber: safeContactNumber,
        status: 'pending_shop_acceptance',
        acceptedAt: null,
        declinedAt: null,
        cancelledAt: null,
        shopRespondedAt: null,
        handledByShopId: null,
      })

      if (error) throw error

      try {
        await supabase.from('notifications').insert({
          userId: shopId,
          type: 'funeral_request_pending',
          title: 'New Custom Casket Request',
          body: `${safeFamilyCoordinatorName} sent a custom casket request for ${safeDeceasedFullName}.`,
          data: {
            requestId,
            requesterId: viewer.id,
            shopId: shopId,
            productId: 'custom_casket_design',
          },
          read: false,
        })
      } catch (notificationError) {
        console.warn('Failed to create custom casket request notification:', notificationError)
      }

      setSuccessState({
        requestId,
        shopName,
      })
    } catch (error: any) {
      openAlert({
        title: 'Request Not Sent',
        message: error?.message || 'Failed to send your custom request.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSubmitting(false)
    }
  }, [
    cemeteryName, churchName, deceasedAge, ageInputMode, burialTime, contactNumber, computedAge, openAlert,
    dateOfBirth, dateOfPassing, deceasedFullName, familyCoordinatorName, memorialPhotoUrl,
    pickupAddress, shopAddress, shopContactNumber, tributeMessage, viewer, wakeAddress,
    wakeEndDate, wakeStartDate, designNotes, referencePhotoUrl, shopId, shopName
  ])

  const confirmSubmitRequest = useCallback(() => {
    openConfirm({
      title: 'Send Custom Request',
      message: 'Are you sure you want to send this custom casket request? The shop will review your design specifications and details.',
      confirmLabel: 'Send Request',
      cancelLabel: 'Cancel',
      tone: 'warning',
      onConfirm: submitRequest,
    })
  }, [openConfirm, submitRequest])

  // ── No Shop ──────────────────────────────
  if (shopFound === false) {
    return (
      <div className="checkout-page">
        <TopBar profileName={profile?.fullName} />
        <Header />
        <div className="checkout-empty">
          <h2>Shop Not Found</h2>
          <p>The shop you are looking for does not exist or has been removed.</p>
          <Link to="/funeral/shops" className="checkout-success-primary">Browse Shops</Link>
        </div>
      </div>
    )
  }

  // ── Success ───────────────────────────────────
  if (successState) {
    return (
      <div className="checkout-page">
        <TopBar profileName={profile?.fullName} />
        <Header />
        <div className="checkout-success">
          <h2 className="checkout-success-title">Request Sent</h2>
          <p className="checkout-success-text">
            Your custom casket request has been forwarded to {successState.shopName}. Please wait while the shop reviews your request.
          </p>
          <p className="checkout-success-condolence">
            Our heartfelt condolences are with you and your family during this difficult time.
          </p>
          <p className="checkout-success-ref">Reference: {successState.requestId}</p>
          <Link to="/user/requests" className="checkout-success-primary">Track My Request</Link>
          <Link to="/funeral/shops" className="checkout-success-secondary">Back to Shops</Link>
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────
  return (
    <div className="checkout-page">
      <TopBar profileName={profile?.fullName} />
      <Header />

      <div className="checkout-main">
        <div className="checkout-layout">
        <aside className="checkout-order-summary">
          <h2>Request summary</h2>
          <div className="checkout-summary">
            <div className="checkout-summary-fallback">LC</div>
            <div className="checkout-summary-body">
              <h2 className="checkout-summary-name">{shopName}</h2>
              <p className="checkout-summary-shop">Made-to-order casket</p>
              <p className="checkout-summary-note">
                The shop will review the design before providing a quote.
              </p>
            </div>
          </div>
          <div className="checkout-summary-divider" />
          <div className="checkout-summary-row">
            <span>Shop</span>
            <strong>{shopName}</strong>
          </div>
          <p className="checkout-summary-help">No payment is collected when you send this request.</p>
        </aside>

        <main className="checkout-form-column">
        <div className="checkout-photo-grid">
        <section className="checkout-section">
          <h3 className="checkout-section-title">Memorial portrait</h3>
          <div className={`checkout-photo-zone${memorialPhotoPreview ? ' has-photo' : ''}`}>
            {uploadingMemorial ? (
              <span className="checkout-photo-uploading">Uploading photo…</span>
            ) : memorialPhotoPreview ? (
              <>
                <img src={memorialPhotoPreview} alt="Memorial photo" className="checkout-photo-preview" />
              </>
            ) : (
              <>
                <span className="checkout-photo-label">Click to add memorial photo</span>
                <input
                  ref={memorialFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoSelect(e, 'memorial')}
                />
              </>
            )}
          </div>
          {memorialPhotoPreview && !uploadingMemorial ? (
             <div className="checkout-photo-actions">
               <button type="button" className="checkout-photo-change-btn" onClick={() => {
                 setMemorialPhotoUrl(null); setMemorialPhotoPreview(null);
                 if (memorialFileInputRef.current) memorialFileInputRef.current.value = '';
                 setTimeout(() => memorialFileInputRef.current?.click(), 50);
               }}>Change Photo</button>
             </div>
           ) : null}
        </section>

        <section className="checkout-section">
          <h3 className="checkout-section-title">Design reference</h3>
          <div className={`checkout-photo-zone${referencePhotoPreview ? ' has-photo' : ''}`}>
            {uploadingReference ? (
              <span className="checkout-photo-uploading">Uploading photo…</span>
            ) : referencePhotoPreview ? (
              <>
                <img src={referencePhotoPreview} alt="Reference photo" className="checkout-photo-preview" />
              </>
            ) : (
              <>
                <span className="checkout-photo-label">Click to add reference photo</span>
                <input
                  ref={referenceFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoSelect(e, 'reference')}
                />
              </>
            )}
          </div>
           {referencePhotoPreview && !uploadingReference ? (
             <div className="checkout-photo-actions">
               <button type="button" className="checkout-photo-change-btn" onClick={() => {
                 setReferencePhotoUrl(null); setReferencePhotoPreview(null);
                 if (referenceFileInputRef.current) referenceFileInputRef.current.value = '';
                 setTimeout(() => referenceFileInputRef.current?.click(), 50);
               }}>Change Photo</button>
             </div>
           ) : null}
        </section>
        </div>

        <section className="checkout-section checkout-form-section">
          <h3 className="checkout-section-title">Arrangement details</h3>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-deceased-name">Full Name of the Deceased</label>
            <input
              id="checkout-deceased-name"
              className="checkout-input"
              type="text"
              value={deceasedFullName}
              onChange={(e) => setDeceasedFullName(e.target.value)}
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-dob">Date of Birth</label>
            <input
              id="checkout-dob"
              className="checkout-input"
              type="date"
              max={new Date().toISOString().split('T')[0]}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-dop">Date of Passing</label>
            <input
              id="checkout-dop"
              className="checkout-input"
              type="date"
              max={new Date().toISOString().split('T')[0]}
              value={dateOfPassing}
              onChange={(e) => setDateOfPassing(e.target.value)}
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-age">Age of the Deceased</label>
            <div className="checkout-age-mode-row">
              <button
                type="button"
                className={`checkout-age-mode-btn${ageInputMode === 'auto' ? ' is-active' : ''}`}
                onClick={() => setAgeInputMode('auto')}
              >
                Automatic
              </button>
              <button
                type="button"
                className={`checkout-age-mode-btn${ageInputMode === 'manual' ? ' is-active' : ''}`}
                onClick={() => setAgeInputMode('manual')}
              >
                Manual
              </button>
            </div>
            <input
              id="checkout-age"
              className="checkout-input"
              type="number"
              min="0"
              max="150"
              placeholder={
                ageInputMode === 'auto'
                  ? computedAge != null
                    ? `${computedAge} years`
                    : 'Calculated from the dates provided'
                  : 'Enter age at time of passing'
              }
              value={ageInputMode === 'auto' ? (computedAge != null ? String(computedAge) : '') : deceasedAge}
              onChange={(e) => {
                setAgeInputMode('manual')
                setDeceasedAge(e.target.value)
              }}
            />
            {ageInputMode === 'auto' ? (
              <p className="checkout-age-auto-hint">
                {computedAge != null
                  ? 'Age is calculated automatically from the dates provided above.'
                  : 'Select both the date of birth and date of passing to calculate the age automatically.'}
              </p>
            ) : null}
            {ageMismatch ? (
              <div className="checkout-age-mismatch">
                The entered age does not match the date of birth and date of passing. Calculated age: {computedAge}.
              </div>
            ) : null}
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-tribute">Tribute Message</label>
            <textarea
              id="checkout-tribute"
              className="checkout-input checkout-textarea"
              placeholder="A short tribute in memory of the deceased"
              value={tributeMessage}
              onChange={(e) => setTributeMessage(e.target.value)}
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-coordinator">Family Coordinator</label>
            <input
              id="checkout-coordinator"
              className="checkout-input"
              type="text"
              placeholder="Name of the family member in charge"
              value={familyCoordinatorName}
              onChange={(e) => setFamilyCoordinatorName(e.target.value)}
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-wake">Wake Venue</label>
            <textarea
              id="checkout-wake"
              className="checkout-input checkout-textarea"
              placeholder="Complete address of the wake venue"
              value={wakeAddress}
              onChange={(e) => setWakeAddress(e.target.value)}
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-church">Church / Chapel</label>
            <input
              id="checkout-church"
              className="checkout-input"
              type="text"
              placeholder="Name of the church or chapel"
              value={churchName}
              onChange={(e) => setChurchName(e.target.value)}
              required
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-cemetery">Cemetery</label>
            <input
              id="checkout-cemetery"
              className="checkout-input"
              type="text"
              placeholder="Name of the cemetery"
              value={cemeteryName}
              onChange={(e) => setCemeteryName(e.target.value)}
              required
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-wake-start">Wake Starts</label>
            <input
              id="checkout-wake-start"
              className="checkout-input"
              type="date"
              min={dateOfPassing || undefined}
              value={wakeStartDate}
              onChange={(e) => setWakeStartDate(e.target.value)}
              required
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-wake-end">Wake Ends</label>
            <input
              id="checkout-wake-end"
              className="checkout-input"
              type="date"
              min={wakeStartDate || dateOfPassing || undefined}
              value={wakeEndDate}
              onChange={(e) => setWakeEndDate(e.target.value)}
              required
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-burial-time">Burial Time</label>
            <input
              id="checkout-burial-time"
              className="checkout-input"
              type="time"
              value={burialTime}
              onChange={(e) => setBurialTime(e.target.value)}
              required
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-pickup">Pickup Address</label>
            <textarea
              id="checkout-pickup"
              className="checkout-input checkout-textarea"
              placeholder="Location where the deceased will be picked up"
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
            />
          </div>

          <div className="checkout-field">
            <label className="checkout-label" htmlFor="checkout-contact">Contact Number</label>
            <input
              id="checkout-contact"
              className="checkout-input"
              type="tel"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
            />
          </div>

          <div className="checkout-field checkout-field-wide">
            <label className="checkout-label" htmlFor="checkout-design-notes">Custom Design Specifications</label>
            <textarea
              id="checkout-design-notes"
              className="checkout-input checkout-textarea"
              placeholder="Describe your preferred casket design, materials, colors, or special specifications"
              value={designNotes}
              onChange={(e) => setDesignNotes(e.target.value)}
            />
          </div>
        </section>

        {/* Submit */}
        <button
          type="button"
          className="checkout-submit-btn"
          onClick={confirmSubmitRequest}
          disabled={submitting || uploadingMemorial || uploadingReference}
        >
          {submitting ? 'Sending Request…' : 'Send Custom Request'}
        </button>

        <p className="checkout-footer-hint">
          The shop will review this request first. Please wait for their acceptance after sending it.
        </p>
        </main>
        </div>
      </div>

      {confirmDialog}
      {alertDialog}
    </div>
  )
}

/* ── Shared sub-components ─────────────────────── */

function TopBar({ profileName }: { profileName?: string | null }) {
  const navigate = useNavigate()
  return (
    <div className="checkout-topbar">
      <div className="checkout-topbar-inner">
        <div className="checkout-topbar-left">
          <button type="button" className="checkout-back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            Back
          </button>
        </div>
        <div className="checkout-topbar-right">
          <Link to="/user/notifications">Notifications</Link>
          <Link to="/user/help">Help Centre</Link>
          <span className="checkout-divider">|</span>
          <div className="checkout-user-menu">
            <div className="checkout-user-menu-trigger">
              <svg className="checkout-user-avatar" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              <span className="checkout-user-name">{profileName || 'User'}</span>
              <svg className="checkout-user-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
            <div className="checkout-user-dropdown">
              <Link to="/user/profile">My Account</Link>
              <Link to="/user/purchase">Purchases</Link>
              <Link to="/auth/switch-account" className="checkout-dropdown-switch">Switch Account</Link>
              <Link to="/auth/logout">Log out</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="checkout-header">
      <div className="checkout-header-inner">
        <Link to="/funeral" className="checkout-brand" aria-label="LifeCycle Home">
          <div className="checkout-logo-bag">LC</div>
          <span className="checkout-brand-name">LifeCycle</span>
        </Link>
        <div className="checkout-header-divider" />
        <h1>Custom casket request</h1>
      </div>
    </header>
  )
}
