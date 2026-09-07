import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
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

  const choosePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      setImageUrl(await uploadHomeHeroImageWeb(file))
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The banner photo could not be uploaded.')
    } finally {
      setUploading(false)
    }
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
          <div className={`home-content-preview${imageUrl ? ' has-image' : ''}`}>
            {imageUrl ? <img src={imageUrl} alt='' /> : null}
            <div className='home-content-preview-overlay'>
              {imageUrl ? (
                <>
                  <h3>{title || 'Feature title'}</h3>
                  <p>{subtitle || 'Supporting text'}</p>
                  <span>{buttonLabel || 'Browse now'}</span>
                </>
              ) : (
                <div className='home-content-placeholder'>
                  <strong>No banner photo selected</strong>
                  <small>Use a landscape image with a clear subject and room for text.</small>
                </div>
              )}
            </div>
          </div>

          <div className='home-content-photo-actions'>
            <label className='home-content-upload-btn'>
              {uploading ? 'Uploading...' : imageUrl ? 'Replace photo' : 'Choose photo'}
              <input type='file' accept='image/jpeg,image/png,image/webp,image/heic,image/heif' onChange={(event) => void choosePhoto(event)} disabled={loading || uploading || saving} />
            </label>
            {imageUrl ? <button type='button' onClick={() => setImageUrl(null)} disabled={uploading || saving}>Remove</button> : null}
          </div>
          <p className='home-content-photo-help'>Recommended: 1600 × 900 or wider. The mobile preview crops to a compact landscape card.</p>
        </div>

        <form className='home-content-form' onSubmit={save}>
          <label>
            <span>Title <small>{title.length}/80</small></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} disabled={loading} />
          </label>
          <label>
            <span>Supporting text <small>{subtitle.length}/160</small></span>
            <textarea value={subtitle} onChange={(event) => setSubtitle(event.target.value)} maxLength={160} rows={4} disabled={loading} />
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
            <input type='checkbox' checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={loading || saving} />
          </label>
          {error ? <p className='auth-message auth-message-error'>{error}</p> : null}
          {updatedAt ? <p className='home-content-updated'>Last saved {new Date(updatedAt).toLocaleString('en-PH', { hour12: true })}</p> : null}
          <button className='home-content-save' type='submit' disabled={loading || uploading || saving}>
            {saving ? 'Saving...' : 'Save mobile home feature'}
          </button>
        </form>
      </div>
      {alertDialog}
    </section>
  )
}
