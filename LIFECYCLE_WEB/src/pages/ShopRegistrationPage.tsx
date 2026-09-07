import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import './ShopRegistrationPage.css'
import { useAlertDialog } from '@/hooks/useAlertDialog'

type RegistrationData = {
  shopName: string
  shopAddress: string
  shopPhoneNumber: string
  generalLocation: string
  individualRegisteredName: string
  businessName: string
  registeredAddress: string
  zipCode: string
  tin: string
  vatRegistrationStatus: boolean
}

export default function ShopRegistrationPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)
  
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<RegistrationData>({
    shopName: '',
    shopAddress: '',
    shopPhoneNumber: '',
    generalLocation: '',
    individualRegisteredName: '',
    businessName: '',
    registeredAddress: '',
    zipCode: '',
    tin: '',
    vatRegistrationStatus: false
  })
  
  const [birCertFile, setBirCertFile] = useState<File | null>(null)
  const [birCertPreview, setBirCertPreview] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const { openAlert, alertDialog } = useAlertDialog()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoadingUser(false)
    })
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user ?? null))
    return () => l.subscription.unsubscribe()
  }, [])

  if (loadingUser) {
    return <div style={{ textAlign: 'center', padding: '100px 0' }}>Loading...</div>
  }

  if (!user) {
    return (
      <div className="reg-page">
        <div className="reg-access-denied">
          <div className="reg-access-denied-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0110 0v4"></path>
            </svg>
          </div>
          <h2 className="reg-access-denied-title">Access Denied</h2>
          <p className="reg-access-denied-desc">You must be logged in to register a shop.</p>
          <div className="reg-access-denied-actions">
            <Link to="/funeral" className="reg-access-denied-back">Go Home</Link>
            <Link to="/login" className="reg-access-denied-login">Login to Continue</Link>
          </div>
        </div>
      </div>
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement
    const checked = (e.target as HTMLInputElement).checked
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const previewUrl = URL.createObjectURL(file)
    setBirCertFile(file)
    setBirCertPreview(previewUrl)
  }

  const removeImage = () => {
    setBirCertFile(null)
    setBirCertPreview(null)
  }

  const handleNext = () => {
    if (step === 1) {
      if (!formData.shopName || !formData.shopPhoneNumber || !formData.shopAddress) {
        openAlert({
          title: 'Incomplete Details',
          message: 'Please fill in all required shop details.',
          tone: 'warning',
          okLabel: 'Got It',
        })
        return
      }
      setStep(2)
    } else if (step === 2) {
      if (!formData.individualRegisteredName || !formData.businessName || !formData.registeredAddress || !formData.zipCode || !formData.tin) {
        openAlert({
          title: 'Incomplete Details',
          message: 'Please fill in all required business details.',
          tone: 'warning',
          okLabel: 'Got It',
        })
        return
      }
      if (!birCertFile) {
        openAlert({
          title: 'Missing Document',
          message: 'Please upload your BIR Certificate.',
          tone: 'warning',
          okLabel: 'Got It',
        })
        return
      }
      openAlert({
        title: 'Submit registration?',
        message: 'Are you sure you want to submit your funeral shop registration?',
        tone: 'info',
        okLabel: 'Submit',
        onClose: () => void handleSubmit(),
      })
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
    } else {
      navigate(-1)
    }
  }

  const handleSubmit = async () => {
    if (!user || submitting) return
    setSubmitting(true)
    
    try {
      let finalBirCertUrl = null
      
      // Upload BIR Certificate
      if (birCertFile) {
        const ext = birCertFile.name.split('.').pop()
        const path = `shops/${user.id}_bir_${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('avatars').upload(path, birCertFile, { upsert: true })
        if (uploadError) throw uploadError
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
        finalBirCertUrl = urlData.publicUrl
      }
      
      // Insert to Database
      const { error: dbError } = await supabase.from('funeral_shops').upsert({
        id: user.id,
        shopName: formData.shopName.trim(),
        shopAddress: formData.shopAddress.trim(),
        shopPhoneNumber: formData.shopPhoneNumber.trim(),
        generalLocation: formData.generalLocation.trim(),
        shopImageUrl: null,
        individualRegisteredName: formData.individualRegisteredName.trim(),
        businessName: formData.businessName.trim(),
        registeredAddress: formData.registeredAddress.trim(),
        zipCode: formData.zipCode.trim(),
        tin: formData.tin.trim(),
        vatRegistrationStatus: formData.vatRegistrationStatus,
        birCertificateUrl: finalBirCertUrl,
        status: 'pending' // Initial status
      })
      
      if (dbError) throw dbError
      
      openAlert({
        title: 'Registration Submitted',
        message: 'Your application is now pending review.',
        tone: 'info',
        okLabel: 'Continue',
        onClose: () => navigate('/seller', { replace: true }),
      })

    } catch (error: any) {
      openAlert({
        title: 'Registration Failed',
        message: error.message || 'Your application could not be submitted.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="reg-page">
      <header className="reg-header">
        <Link to="/funeral" className="reg-logo-area">
          <div className="reg-logo-box">LC</div>
          <span className="reg-logo-text">LifeCycle</span>
          <span className="reg-logo-sub">Seller Registration</span>
        </Link>
      </header>

      <div className="reg-content">
        <div className="reg-card">
          <div className="reg-steps">
            <div className={`reg-step-item ${step === 1 ? 'active' : (step > 1 ? 'completed' : '')}`}>1. Shop</div>
            <div className={`reg-step-item ${step === 2 ? 'active' : ''}`}>2. Verification</div>
          </div>

          <div className="reg-form-body">
            {step === 1 && (
              <div>
                <h3 className="reg-section-title">Shop Information</h3>
                <p style={{ color: '#66746f', fontSize: '14px', marginBottom: '18px' }}>Customers will see these details.</p>

                <div className="reg-form-group">
                  <label>Shop Name *</label>
                  <input type="text" className="reg-input" name="shopName" value={formData.shopName} onChange={handleChange} required />
                </div>
                
                <div className="reg-form-group">
                  <label>Shop Address *</label>
                  <input type="text" className="reg-input" name="shopAddress" value={formData.shopAddress} onChange={handleChange} required />
                </div>

                <div className="reg-form-group">
                  <label>Phone Number *</label>
                  <input type="text" className="reg-input" name="shopPhoneNumber" value={formData.shopPhoneNumber} onChange={handleChange} required />
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h3 className="reg-section-title">Business Information</h3>
                <p style={{ color: '#66746f', fontSize: '14px', marginBottom: '18px' }}>Used to verify your business.</p>
                <div className="reg-form-group">
                  <label>Individual Registered Name *</label>
                  <input type="text" className="reg-input" name="individualRegisteredName" value={formData.individualRegisteredName} onChange={handleChange} required />
                </div>
                
                <div className="reg-form-group">
                  <label>Business Name *</label>
                  <input type="text" className="reg-input" name="businessName" value={formData.businessName} onChange={handleChange} required />
                </div>

                <div className="reg-form-group">
                  <label>General Location *</label>
                  <input type="text" className="reg-input" name="generalLocation" value={formData.generalLocation} onChange={handleChange} placeholder="e.g. Quezon City" required />
                </div>
                
                <div className="reg-form-group">
                  <label>Registered Address *</label>
                  <input type="text" className="reg-input" name="registeredAddress" value={formData.registeredAddress} onChange={handleChange} required />
                </div>
                
                <div className="reg-form-group">
                  <label>Zip Code *</label>
                  <input type="text" className="reg-input" name="zipCode" value={formData.zipCode} onChange={handleChange} required />
                </div>
                
                <div className="reg-form-group">
                  <label>Tax Identification Number (TIN) *</label>
                  <input type="text" className="reg-input" name="tin" value={formData.tin} onChange={handleChange} required />
                </div>

                <div className="reg-form-group">
                  <label>VAT Registration Status *</label>
                  <select className="reg-input" name="vatRegistrationStatus" value={formData.vatRegistrationStatus ? 'true' : 'false'} onChange={(e) => setFormData(prev => ({ ...prev, vatRegistrationStatus: e.target.value === 'true' }))}>
                    <option value="true">VAT Registered</option>
                    <option value="false">Non Registered</option>
                  </select>
                </div>

                <div className="reg-form-group">
                  <label>BIR Certificate of Registration (Form 2303) *</label>
                  {birCertPreview ? (
                    <div className="reg-preview-box">
                      <img src={birCertPreview} alt="BIR Certificate" className="reg-preview-img" />
                      <button type="button" className="reg-preview-remove" onClick={removeImage}>✕</button>
                    </div>
                  ) : (
                    <label className="reg-image-upload">
                      <div className="reg-upload-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                      </div>
                      <div className="reg-upload-text">Choose JPEG or PNG</div>
                      <input type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={handleImageChange} />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="reg-footer">
            <button className="reg-btn reg-btn-back" onClick={handleBack} disabled={submitting}>
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            
            {step < 2 ? (
              <button className="reg-btn reg-btn-primary" onClick={handleNext}>Next</button>
            ) : (
              <button className="reg-btn reg-btn-primary" onClick={handleNext} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Registration'}
              </button>
            )}
          </div>
        </div>
      </div>
      {alertDialog}
    </div>
  )
}
