import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import ProfileLayout from './ProfileLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'

export default function UserProfilePage() {
  const [viewer, setViewer] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()

  /* form mirrors DB exactly */
  const [fullName, setFullName] = useState('')
  const [gender, setGender] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [photoURL, setPhotoURL] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      setViewer(session.user)

      const { data } = await supabase.from('users').select('*').eq('id', session.user.id).maybeSingle()
      if (data) {
        setFullName(data.fullName || '')
        setGender(data.gender || '')
        // Ensure date is formatted as YYYY-MM-DD for the date input
        setDateOfBirth(data.dateOfBirth ? data.dateOfBirth.substring(0, 10) : '')
        setPhotoURL(data.photoURL || null)
      }
      setLoading(false)
    }
    load()
  }, [navigate])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!viewer) return
    setSaving(true)
    const { error } = await supabase.from('users').update({
      fullName,
      gender,
      dateOfBirth,
      updatedAt: new Date().toISOString(),
    }).eq('id', viewer.id)

    setSaving(false)
    if (!error) {
      openAlert({
        title: 'Profile Updated',
        message: 'Profile updated successfully.',
        tone: 'info',
        okLabel: 'Done',
      })
    } else {
      openAlert({
        title: 'Update Failed',
        message: 'Error updating profile.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !viewer) return

    if (file.size > 10 * 1024 * 1024) {
      openAlert({
        title: 'File Too Large',
        message: 'File too large. Maximum 10 MB.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      openAlert({
        title: 'Unsupported File Type',
        message: 'Only JPEG and PNG files are allowed.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }

    /* Upload to Supabase Storage (avatars bucket) */
    const ext = file.name.split('.').pop()
    const path = `avatars/${viewer.id}.${ext}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) {
      openAlert({
        title: 'Upload Failed',
        message: 'Upload failed: ' + uploadError.message,
        tone: 'danger',
        okLabel: 'Dismiss',
      })
      return
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const newURL = urlData.publicUrl + '?t=' + Date.now()

    const { error: updateError } = await supabase.from('users').update({
      photoURL: newURL,
      updatedAt: new Date().toISOString(),
    }).eq('id', viewer.id)

    if (!updateError) {
      setPhotoURL(newURL)
      openAlert({
        title: 'Photo Updated',
        message: 'Profile picture updated.',
        tone: 'info',
        okLabel: 'Done',
      })
    } else {
      openAlert({
        title: 'Update Failed',
        message: 'Failed to update profile picture.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    }
  }

  if (loading) return <div className="profile-loading">Loading…</div>

  return (
    <ProfileLayout title="My Profile" subtitle="Manage your personal details for funeral service coordination.">
      {/* Hero Identity Card */}
      <div className="profile-identity-card">
        <div className="profile-identity-avatar-wrapper">
          {photoURL ? (
            <img src={photoURL} alt="Avatar" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>
          )}
        </div>
        <div className="profile-identity-info">
          <h2 className="profile-identity-name">{fullName || viewer?.email || 'LifeCycle User'}</h2>
          <p className="profile-identity-email">{viewer?.email}</p>
        </div>
        <div className="profile-identity-actions">
          <label className="btn-outline profile-photo-button">
            Change photo
            <input type="file" accept="image/jpeg,image/png" onChange={handleImageUpload} className="profile-file-input" />
          </label>
        </div>
      </div>
      <p className="profile-photo-hint">Maximum 10 MB. JPEG or PNG.</p>

      {/* Form Settings Card */}
      <div className="profile-settings-card">
        <div className="profile-settings-header">
          <h2>Personal information</h2>
        </div>
        
        <form onSubmit={handleSave}>
          <div className="profile-settings-body">
            <div className="profile-input-stack">
              <label>Full Name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>

            <div className="profile-input-stack">
              <label>Gender</label>
              <div className="profile-radio-group">
                <label>
                  <input type="radio" name="gender" value="male" checked={gender?.toLowerCase() === 'male'} onChange={e => setGender(e.target.value)} /> Male
                </label>
                <label>
                  <input type="radio" name="gender" value="female" checked={gender?.toLowerCase() === 'female'} onChange={e => setGender(e.target.value)} /> Female
                </label>
                <label>
                  <input type="radio" name="gender" value="other" checked={gender?.toLowerCase() === 'other'} onChange={e => setGender(e.target.value)} /> Other
                </label>
              </div>
            </div>

            <div className="profile-input-stack">
              <label>Date of Birth</label>
              <input type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} max={new Date().toISOString().split('T')[0]} />
            </div>

            <div className="profile-input-stack">
              <label>Email Address</label>
              <div className="profile-readonly-text">{viewer?.email}</div>
            </div>

            <div className="profile-input-stack">
              <label>Account UID</label>
              <div className="uid-pill">{viewer?.id}</div>
            </div>
          </div>

          <div className="profile-settings-footer">
            <button type="submit" disabled={saving} className="btn-save">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
      
      {alertDialog}
    </ProfileLayout>
  )
}



