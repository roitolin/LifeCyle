import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadHomeHeroImageWeb } from '@/lib/supabaseStorage'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import './AdminHomeContentPage.css'

type HomeHeroTarget = 'shops' | 'catalog'

type HomeHeroRow = {
  id: number
  title: string
  subtitle: string
  button_label: string
  image_url: string | null
  target: HomeHeroTarget
  is_active: boolean
  updated_at?: string
}

function BannerIcon({ name }: { name: 'image' | 'phone' | 'upload' | 'trash' }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      {name === 'phone' ? <><rect x='6' y='2' width='12' height='20' rx='3' /><path d='M10 18h4' /></>
        : name === 'upload' ? <><path d='M12 16V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4' /></>
        : name === 'trash' ? <><path d='M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7' /></>
        : <><rect x='3' y='3' width='18' height='18' rx='3' /><circle cx='8' cy='8' r='1.5' /><path d='m21 15-5-5L5 21' /></>}
    </svg>
  )
}

export default function AdminHomeContentPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const [title, setTitle] = useState('Explore available caskets')
  const [subtitle, setSubtitle] = useState('Compare current listings from approved funeral shops.')
  const [buttonLabel, setButtonLabel] = useState('Browse now')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [target, setTarget] = useState<HomeHeroTarget>('shops')
  const [isActive, setIsActive] = useState(false)
  const [updatedAt, setUpdatedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewMode, setPreviewMode] = useState<'mobile' | 'image'>('mobile')
  const [dragging, setDragging] = useState(false)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const photoDisabled = loading || uploading || saving

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await supabase
        .from('home_hero_content')
        .select('id,title,subtitle,button_label,image_url,target,is_active,updated_at')
        .eq('id', 1)
        .maybeSingle()
      if (loadError) throw loadError
      if (!data) return
      const content = data as HomeHeroRow
      setTitle(content.title)
      setSubtitle(content.subtitle)
      setButtonLabel(content.button_label)
      setImageUrl(content.image_url)
      setTarget(content.target)
      setIsActive(content.is_active)
      setUpdatedAt(content.updated_at || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the mobile home feature.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`web-admin-home-hero-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'home_hero_content' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const uploadPhoto = async (file?: File) => {
    if (!file || photoDisabled) return
    setUploading(true)
    setError('')
    try {
      const nextImageUrl = await uploadHomeHeroImageWeb(file)
      setImageSize(null)
      setImageUrl(nextImageUrl)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The banner photo could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  const choosePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    void uploadPhoto(file)
  }

  const dropPhoto = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void uploadPhoto(event.dataTransfer.files?.[0])
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !subtitle.trim() || !buttonLabel.trim()) {
      setError('Title, supporting text, and button label are required.')
      return
    }
    if (isActive && !imageUrl) {
      setError('Choose a banner photo before making the feature visible.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!userData.user) throw new Error('Your admin session expired. Sign in again.')

      const { data, error: saveError } = await supabase
        .from('home_hero_content')
        .upsert({
          id: 1,
          title: title.trim(),
          subtitle: subtitle.trim(),
          button_label: buttonLabel.trim(),
          image_url: imageUrl,
          target,
          is_active: isActive,
          updated_by: userData.user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select('updated_at')
        .single()
      if (saveError) throw saveError
      setUpdatedAt(String(data?.updated_at || ''))
      openAlert({
        title: 'Mobile Home Feature Saved',
        message: isActive ? 'The banner is now visible on the mobile customer home.' : 'The feature was saved as a hidden draft.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The mobile home feature could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className='panel home-content-page'>
      <header className='home-content-header'>
        <div>
          <h2>Mobile home feature</h2>
          <p className='panel-sub'>Control the editorial banner above the mobile casket catalog.</p>
        </div>
        <span className={`home-content-status${isActive ? ' active' : ''}`}>{isActive ? 'Visible' : 'Draft'}</span>
      </header>

      <div className='home-content-layout'>
        <div className='home-content-preview-column'>
          <div className='home-content-preview-heading'>
            <div><h3>Banner preview</h3><p>See how your photo and text work together.</p></div>
            <div className='home-content-preview-tabs' role='group' aria-label='Preview mode'>
              <button type='button' aria-pressed={previewMode === 'mobile'} onClick={() => setPreviewMode('mobile')}><BannerIcon name='phone' />Mobile card</button>
              <button type='button' aria-pressed={previewMode === 'image'} onClick={() => setPreviewMode('image')} disabled={!imageUrl}><BannerIcon name='image' />Full photo</button>
            </div>
          </div>
          <div className='home-content-preview-stage' aria-busy={loading || uploading}>
            {imageUrl ? (
              <div className={previewMode === 'mobile' ? 'home-content-device' : 'home-content-original'}>
                <div className={previewMode === 'mobile' ? 'home-content-preview' : 'home-content-original-image'}>
                  <img src={imageUrl} alt={previewMode === 'image' ? 'Selected banner photo' : ''} onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                  {previewMode === 'mobile' ? (
                    <div className='home-content-preview-overlay'>
                      <div className='home-content-preview-copy'>
                        <h3>{title || 'Feature title'}</h3>
                        <p>{subtitle || 'Supporting text'}</p>
                        <span>{buttonLabel || 'Browse now'}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className='home-content-placeholder'>
                <span className='home-content-image-icon'><BannerIcon name='image' /></span>
                <strong>{loading ? 'Loading banner...' : 'Your next home feature starts here'}</strong>
                <p>Add a landscape photo to preview your banner.</p>
              </div>
            )}
          </div>
          <div className='home-content-preview-caption'><span>{previewMode === 'mobile' ? 'Customer home · mobile card' : 'Original photo · uncropped'}</span>{imageSize ? <span>{imageSize.width} × {imageSize.height} px</span> : null}</div>

          <div className={`home-content-photo-picker${dragging && !photoDisabled ? ' is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!photoDisabled) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={dropPhoto} aria-busy={uploading}>
            <span className={`home-content-image-icon${uploading ? ' is-uploading' : ''}`}><BannerIcon name='upload' /></span>
            <div className='home-content-picker-copy' aria-live='polite'><strong>{uploading ? 'Uploading your photo...' : 'Drop a banner photo here'}</strong><span>JPEG, PNG, WebP, HEIC or HEIF · up to 10 MB</span></div>
            <div className='home-content-photo-actions'>
              <button type='button' className='home-content-upload-btn' onClick={() => photoInputRef.current?.click()} disabled={photoDisabled}>{uploading ? 'Uploading...' : imageUrl ? 'Replace photo' : 'Choose photo'}</button>
              {imageUrl ? <button className='home-content-remove-btn' type='button' onClick={() => { setImageUrl(null); setImageSize(null); setPreviewMode('mobile') }} disabled={photoDisabled}><BannerIcon name='trash' />Remove</button> : null}
            </div>
            <input ref={photoInputRef} type='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif' onChange={choosePhoto} disabled={photoDisabled} hidden aria-label='Choose banner photo' />
          </div>
          <p className='home-content-photo-help'>Use a landscape photo, ideally 1600 × 900 or larger. Keep the main subject on the right so the text stays readable.</p>
          <p className='home-content-preview-note'>Preview updates as you edit. Save your changes to update the app.</p>
        </div>

        <form className='home-content-form' onSubmit={save}>
          <div className='home-content-form-heading'><h3>Banner details</h3><p>Keep the message short and easy to read.</p></div>
          <label>
            <span>Title <small>{title.length}/80</small></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} disabled={loading} />
          </label>
          <label>
            <span>Supporting text <small>{subtitle.length}/160</small></span>
            <textarea value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={160} rows={3} disabled={loading} />
          </label>
          <label>
            <span>Button label <small>{buttonLabel.length}/30</small></span>
            <input value={buttonLabel} onChange={(event) => setButtonLabel(event.target.value)} maxLength={30} disabled={loading} />
          </label>
          <label>
            <span>Button destination</span>
            <select value={target} onChange={(event) => setTarget(event.target.value as HomeHeroTarget)} disabled={loading}>
              <option value='shops'>Funeral shops</option>
              <option value='catalog'>Casket catalog on home</option>
            </select>
          </label>
          <label className='home-content-visibility'>
            <span><strong>Show on customer home</strong><small>{isActive ? 'Visible after you save.' : 'Saved as a hidden draft.'}</small></span>
            <input type='checkbox' role='switch' checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={loading || saving} />
          </label>
          {error ? <p className='auth-message auth-message-error'>{error}</p> : null}
          {updatedAt ? <p className='home-content-updated'>Last saved {new Date(updatedAt).toLocaleString('en-PH', { hour12: true })}</p> : null}
          <button className='home-content-save' type='submit' disabled={loading || uploading || saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>
      {alertDialog}
    </section>
  )
}
