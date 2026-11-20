import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { logWebAdminActivity } from '@/utils/adminActivity'
import { getProfileAvatar } from '@/utils/profileAvatar'
import './AdminProfilePage.css'

function notifyAdminProfileUpdated() {
  window.dispatchEvent(new CustomEvent('admin-profile-updated'))
}

export default function AdminProfilePage() {
  const { openAlert, alertDialog } = useAlertDialog()

  const [viewer, setViewer] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  const [fullName, setFullName] = useState('')
  const [gender, setGender] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [photoURL, setPhotoURL] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const currentUser = sessionData.session?.user ?? null
      setViewer(currentUser)
      if (!currentUser) return

      const { data } = await supabase
        .from('users')
        .select('fullName, gender, dateOfBirth, photoURL')
        .eq('id', currentUser.id)
        .maybeSingle()

      if (data) {
        setFullName(String(data.fullName || '').trim())
        setGender(String(data.gender || '').toLowerCase())
        setDateOfBirth(data.dateOfBirth ? String(data.dateOfBirth).substring(0, 10) : '')
        setPhotoURL(data.photoURL ? String(data.photoURL).trim() : null)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const handleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !viewer || uploadingPhoto) return

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

    setUploadingPhoto(true)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `avatars/${viewer.id}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })

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

      const { error: updateError } = await supabase
        .from('users')
        .update({
          photoURL: newURL,
          updatedAt: new Date().toISOString(),
        })
        .eq('id', viewer.id)

      if (!updateError) {
        setPhotoURL(newURL)
        notifyAdminProfileUpdated()
        void logWebAdminActivity({
          adminId: viewer.id,
          action: 'admin_profile_photo_updated',
          targetType: 'user',
          targetId: viewer.id,
          summary: 'Updated admin profile photo.',
        })
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
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!viewer || saving) return

    setSaving(true)
    const trimmedName = fullName.trim()
    const { error } = await supabase
      .from('users')
      .update({
        fullName: trimmedName,
        gender: gender || null,
        dateOfBirth: dateOfBirth || null,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', viewer.id)

    setSaving(false)
    if (!error) {
      setFullName(trimmedName)
      notifyAdminProfileUpdated()
      void logWebAdminActivity({
        adminId: viewer.id,
        action: 'admin_profile_updated',
        targetType: 'user',
        targetId: viewer.id,
        summary: 'Updated admin profile details.',
      })
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

  return (
    <section className="panel admin-profile-page">
      <div className="admin-profile-header">
        <h2>My Profile</h2>
        <p className="panel-sub">Manage your personal details and profile photo.</p>
      </div>

      {loading ? (
        <div className="admin-loading-state">Loading…</div>
      ) : (
        <div className="admin-profile-content">
          <div className="admin-profile-identity-card">
            <div className="admin-profile-avatar-wrap">
              <img src={getProfileAvatar(photoURL, gender)} alt="Avatar" />
            </div>
            <div className="admin-profile-identity-info">
              <h3 className="admin-profile-identity-name">{fullName || viewer?.email || 'Admin'}</h3>
              <p className="admin-profile-identity-email">{viewer?.email}</p>
            </div>
            <div className="admin-profile-identity-actions">
              <label className="ghost-btn admin-profile-photo-button">
                {uploadingPhoto ? 'Uploading…' : 'Change photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleImageUpload}
                  disabled={uploadingPhoto}
                  className="admin-profile-file-input"
                />
              </label>
            </div>
          </div>
          <p className="admin-profile-photo-hint">Maximum 10 MB. JPEG or PNG.</p>

          <div className="admin-profile-settings-card">
            <div className="admin-profile-settings-header">
              <h3>Personal information</h3>
            </div>

            <form onSubmit={handleSave}>
              <div className="admin-profile-settings-body">
                <div className="admin-profile-input-stack">
                  <label htmlFor="admin-profile-fullname">Full Name</label>
                  <input
                    id="admin-profile-fullname"
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                  />
                </div>

                <div className="admin-profile-input-stack">
                  <label>Gender</label>
                  <div className="admin-profile-radio-group">
                    <label>
                      <input
                        type="radio"
                        name="gender"
                        value="male"
                        checked={gender?.toLowerCase() === 'male'}
                        onChange={(event) => setGender(event.target.value)}
                      />{' '}
                      Male
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="gender"
                        value="female"
                        checked={gender?.toLowerCase() === 'female'}
                        onChange={(event) => setGender(event.target.value)}
                      />{' '}
                      Female
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="gender"
                        value="other"
                        checked={gender?.toLowerCase() === 'other'}
                        onChange={(event) => setGender(event.target.value)}
                      />{' '}
                      Other
                    </label>
                  </div>
                </div>

                <div className="admin-profile-input-stack">
                  <label htmlFor="admin-profile-dob">Date of Birth</label>
                  <input
                    id="admin-profile-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div className="admin-profile-input-stack">
                  <label>Email Address</label>
                  <div className="admin-profile-readonly-text">{viewer?.email}</div>
                </div>

                <div className="admin-profile-input-stack">
                  <label>Account UID</label>
                  <div className="admin-profile-readonly-text admin-profile-uid">{viewer?.id}</div>
                </div>
              </div>

              <div className="admin-profile-settings-footer">
                <button type="submit" disabled={saving} className="solid-btn admin-profile-save-btn">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {alertDialog}
    </section>
  )
}
