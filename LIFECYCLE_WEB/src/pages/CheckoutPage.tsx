import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { uploadCertificateWeb } from '@/lib/supabaseStorage'
import { removeFuneralCartItem, type WebFuneralCartItem } from '@/utils/funeralCart'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import BrandLogo from '@/components/BrandLogo'
import './CheckoutPage.css'

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

function formatPeso(value: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

function computeAgeFromDates(dob: Date | null, dop: Date | null): number | null {
  if (!dob || !dop) return null
  if (dop.getTime() <= dob.getTime()) return null
  const years = dop.getFullYear() - dob.getFullYear()
  const beforeBirthday =
    dop.getMonth() < dob.getMonth() ||
    (dop.getMonth() === dob.getMonth() && dop.getDate() < dob.getDate())
  return beforeBirthday ? years - 1 : years
}



export default function CheckoutPage() {

  const location = useLocation()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const { openAlert, alertDialog } = useAlertDialog()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cart item from location state (passed by CartPage)
  const cartItem = (location.state as { cartItem?: WebFuneralCartItem } | null)?.cartItem ?? null

  // Viewer / profile
  const [profile, setProfile] = useState<ViewerProfile | null>(null)
  const [viewer, setViewer] = useState<{ id: string } | null>(null)

  // Form state
  const [memorialPhotoUrl, setMemorialPhotoUrl] = useState<string | null>(null)
  const [memorialPhotoPreview, setMemorialPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deceasedFullName, setDeceasedFullName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [dateOfPassing, setDateOfPassing] = useState('')
  const [tributeMessage, setTributeMessage] = useState('')
  const [familyCoordinatorName, setFamilyCoordinatorName] = useState('')
  const [wakeAddress, setWakeAddress] = useState('')
  const [wakeStartDate, setWakeStartDate] = useState('')
  const [wakeEndDate, setWakeEndDate] = useState('')
  const [burialTime, setBurialTime] = useState('')
  const [pickupAddress, setPickupAddress] = useState('')
  const [contactNumber, setContactNumber] = useState('')
  const [shopContactNumber, setShopContactNumber] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [deceasedAge, setDeceasedAge] = useState('')
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
      if (!session?.user) return

      const { data: userData } = await supabase
        .from('users')
        .select('fullName, photoURL')
        .eq('id', session.user.id)
        .maybeSingle()

      if (userData) {
        setProfile(userData)
        setFamilyCoordinatorName(String(userData.fullName || ''))
      }

      if (cartItem?.shopId) {
        const { data: shopData } = await supabase
          .from('funeral_shops')
          .select('shopPhoneNumber, shopAddress')
          .eq('id', cartItem.shopId)
          .maybeSingle()

        if (shopData) {
          setShopContactNumber(String(shopData.shopPhoneNumber || ''))
          setShopAddress(String(shopData.shopAddress || ''))
        }
      }
    }
    void loadData()
  }, [cartItem?.shopId])

  // Photo upload
  const handlePhotoSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Create a local preview
    const previewUrl = URL.createObjectURL(file)
    setMemorialPhotoPreview(previewUrl)
    setUploadingPhoto(true)

    try {
      const url = await uploadCertificateWeb(file)
      setMemorialPhotoUrl(url)
    } catch (error: any) {
      openAlert({
        title: 'Upload Failed',
        message: error?.message || 'Failed to upload memorial photo.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
      setMemorialPhotoPreview(null)
      setMemorialPhotoUrl(null)
    } finally {
      setUploadingPhoto(false)
    }
  }, [openAlert])

  const removePhoto = useCallback(() => {
    setMemorialPhotoUrl(null)
    setMemorialPhotoPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const changePhoto = useCallback(() => {
    removePhoto()
    setTimeout(() => fileInputRef.current?.click(), 50)
  }, [removePhoto])

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
    if (!cartItem || !viewer) return

    const safeDeceasedFullName = deceasedFullName.trim()
    const safeTributeMessage = tributeMessage.trim()
    const safeFamilyCoordinatorName = familyCoordinatorName.trim()
    const safeWakeAddress = wakeAddress.trim()
    const safePickupAddress = pickupAddress.trim()
    const safeContactNumber = contactNumber.trim()
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
      !wakeStartDate ||
      !wakeEndDate ||
      !burialTime ||
      !safePickupAddress ||
      !safeContactNumber
    ) {
      openAlert({
        title: 'Incomplete Details',
        message: 'Please complete all required details before sending your request.',
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
        shopId: cartItem.shopId,
        shopName: cartItem.shopName,
        shopContactNumber: shopContactNumber || null,
        shopAddress: shopAddress || null,
        cartId: cartItem.cartId,
        productId: cartItem.productId,
        productName: cartItem.name,
        productPrice: cartItem.price,
        productImageUrl: cartItem.imageUrl || null,
        variationName: cartItem.variationName || null,
        requestType: 'catalog_product',
        customDesignNotes: null,
        memorialPhotoUrl,
        referencePhotoUrl: null,
        deceasedFullName: safeDeceasedFullName,
        deceasedDateOfBirth: new Date(dateOfBirth).toISOString(),
        deceasedDateOfPassing: new Date(dateOfPassing).toISOString(),
        deceasedAge: Number(resolvedAge) || null,
        tributeMessage: safeTributeMessage,
        familyCoordinatorName: safeFamilyCoordinatorName,
        wakeAddress: safeWakeAddress,
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

      // Notification for the shop
      try {
        await supabase.from('notifications').insert({
          userId: cartItem.shopId,
          type: 'funeral_request_pending',
          title: 'New Funeral Service Request',
          body: `${safeFamilyCoordinatorName} sent a service request for ${safeDeceasedFullName}.`,
          data: {
            requestId,
            requesterId: viewer.id,
            shopId: cartItem.shopId,
            productId: cartItem.productId,
          },
          read: false,
        })
      } catch (notificationError) {
        console.warn('Failed to create funeral request notification:', notificationError)
      }

      // Remove cart item
      removeFuneralCartItem(cartItem.cartId)

      setSuccessState({
        requestId,
        shopName: cartItem.shopName,
      })
    } catch (error: any) {
      openAlert({
        title: 'Request Not Sent',
        message: error?.message || 'Failed to send your service request.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSubmitting(false)
    }
  }, [
    deceasedAge,
    ageInputMode,
    burialTime,
    cartItem,
    contactNumber,
    computedAge,
    openAlert,
    dateOfBirth,
    dateOfPassing,
    deceasedFullName,
    familyCoordinatorName,
    memorialPhotoUrl,
    pickupAddress,
    shopAddress,
    shopContactNumber,
    tributeMessage,
    viewer,
    wakeAddress,
    wakeEndDate,
    wakeStartDate,
  ])

  const confirmSubmitRequest = useCallback(() => {
    openConfirm({
      title: 'Send Service Request',
      message: 'Are you sure you want to send this funeral service request? The shop will review and respond to your request.',
      confirmLabel: 'Send Request',
      cancelLabel: 'Cancel',
      tone: 'warning',
      onConfirm: submitRequest,
    })
  }, [openConfirm, submitRequest])

  // ── No cart item ──────────────────────────────
  if (!cartItem) {
    return (
      <div className="checkout-page">
        <TopBar profile={profile} />
        <Header />
        <div className="checkout-empty">
          <h2>No cart item selected</h2>
          <p>Please go back to your cart and select an item to check out.</p>
          <Link to="/user/cart" className="checkout-success-primary">Go to Cart</Link>
        </div>
      </div>
    )
  }

  // ── Success ───────────────────────────────────
  if (successState) {
    return (
      <div className="checkout-page">
        <TopBar profile={profile} />
        <Header />
        <div className="checkout-success">
          <h2 className="checkout-success-title">Request Sent</h2>
          <p className="checkout-success-text">
            Your service request has been forwarded to {successState.shopName}. Please wait while the shop reviews and accepts your request.
          </p>
          <p className="checkout-success-condolence">
            Our heartfelt condolences are with you and your family during this difficult time.
          </p>
          <p className="checkout-success-ref">Reference: {successState.requestId}</p>
          <Link to="/user/requests" className="checkout-success-primary">Track My Request</Link>
          <Link to="/user/cart" className="checkout-success-secondary">Back to Cart</Link>
        </div>
      </div>
    )
  }

  // ── Form ──────────────────────────────────────
  return (
    <div className="checkout-page">
      <TopBar profile={profile} />
      <Header />

      <div className="checkout-main">
        <div className="checkout-layout">
        <aside className="checkout-order-summary">
          <h2>Request summary</h2>
          <div className="checkout-summary">
            {cartItem.imageUrl ? (
              <img src={cartItem.imageUrl} alt={cartItem.name} className="checkout-summary-image" />
            ) : (
              <div className="checkout-summary-fallback">LC</div>
            )}
            <div className="checkout-summary-body">
              <h2 className="checkout-summary-name">{cartItem.name}</h2>
              <p className="checkout-summary-shop">{cartItem.shopName}</p>
              {cartItem.variationName ? (
                <p className="checkout-summary-variation">Option: {cartItem.variationName}</p>
              ) : null}
              <p className="checkout-summary-note">
                The shop will confirm availability before requesting payment.
              </p>
            </div>
          </div>
          <div className="checkout-summary-divider" />
          <div className="checkout-summary-row">
            <span>Service price</span>
            <strong>{formatPeso(cartItem.price)}</strong>
          </div>
          <p className="checkout-summary-help">No payment is collected when you send this request.</p>
        </aside>

        <main className="checkout-form-column">
        <section className="checkout-section">
          <h3 className="checkout-section-title">Memorial portrait</h3>
          <div className={`checkout-photo-zone${memorialPhotoPreview ? ' has-photo' : ''}`}>
            {uploadingPhoto ? (
              <span className="checkout-photo-uploading">Uploading photo…</span>
            ) : memorialPhotoPreview ? (
              <>
                <img src={memorialPhotoPreview} alt="Memorial photo" className="checkout-photo-preview" />
              </>
            ) : (
              <>
                <span className="checkout-photo-label">Click to add memorial photo</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handlePhotoSelect(e)}
                />
              </>
            )}
          </div>
          {memorialPhotoPreview && !uploadingPhoto ? (
            <div className="checkout-photo-actions">
              <button type="button" className="checkout-photo-change-btn" onClick={changePhoto}>Change Photo</button>
              <button type="button" className="checkout-photo-remove-btn" onClick={removePhoto}>Remove</button>
            </div>
          ) : null}
        </section>

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
        </section>

        {/* Submit */}
        <button
          type="button"
          className="checkout-submit-btn"
          onClick={confirmSubmitRequest}
          disabled={submitting || uploadingPhoto}
        >
          {submitting ? 'Sending Request…' : 'Send Service Request'}
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

function TopBar({ profile }: { profile: ViewerProfile | null }) {
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
              {profile?.photoURL ? (
                <img src={profile.photoURL} alt="Account" className="checkout-user-avatar checkout-user-avatar-image" />
              ) : (
                <svg className="checkout-user-avatar" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              )}
              <span className="checkout-user-name">{profile?.fullName || 'User'}</span>
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
        <BrandLogo to="/funeral" compact className="checkout-brand-logo" />
        <div className="checkout-header-divider" />
        <h1>Service Request</h1>
      </div>
    </header>
  )
}
