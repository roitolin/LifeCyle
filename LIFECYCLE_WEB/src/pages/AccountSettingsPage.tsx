import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import ProfileLayout from './ProfileLayout'

type LoginActivity = {
  id: string
  event: string
  device_name: string | null
  created_at: string
}

export default function AccountSettingsPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [activity, setActivity] = useState<LoginActivity[]>([])
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  useEffect(() => {
    void supabase
      .from('account_login_activity')
      .select('id,event,device_name,created_at')
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => setActivity((data || []) as LoginActivity[]))
  }, [])

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8) {
      openAlert({ title: 'Password Too Short', message: 'Use at least 8 characters for your new password.', tone: 'warning' })
      return
    }
    if (password !== confirmPassword) {
      openAlert({ title: 'Passwords Do Not Match', message: 'Enter the same new password in both fields.', tone: 'warning' })
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) {
      openAlert({ title: 'Password Not Updated', message: error.message, tone: 'danger' })
      return
    }
    setPassword('')
    setConfirmPassword('')
    openAlert({ title: 'Password Updated', message: 'Your account password has been changed.', okLabel: 'Done' })
  }

  const signOutOtherDevices = () => {
    openConfirm({
      title: 'Sign out other devices?',
      message: 'Your current browser will stay signed in. Other active sessions will need to sign in again.',
      confirmLabel: 'Sign Out Others',
      tone: 'warning',
      onConfirm: async () => {
        const { error } = await supabase.auth.signOut({ scope: 'others' })
        openAlert(error
          ? { title: 'Could Not Sign Out Devices', message: error.message, tone: 'danger' }
          : { title: 'Other Devices Signed Out', message: 'Your other sessions have been ended.', okLabel: 'Done' })
      },
    })
  }

  return (
    <ProfileLayout title="Account Settings" subtitle="Manage your password, signed-in devices, and account activity.">
      <div className="settings-page-content">
        <section className="settings-panel">
          <h2>Password &amp; security</h2>
          <form className="settings-password-form" onSubmit={updatePassword}>
            <label>New password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <label>Confirm new password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <button type="submit" className="btn-save" disabled={saving}>{saving ? 'Updating...' : 'Update Password'}</button>
          </form>
        </section>

        <section className="settings-panel">
          <h2>Active sessions</h2>
          <div className="settings-inline-action">
            <div><strong>Protect your account</strong><p>End every other signed-in session while keeping this browser active.</p></div>
            <button type="button" className="btn-outline settings-action-button" onClick={signOutOtherDevices}>Sign Out Other Devices</button>
          </div>
        </section>

        <section className="settings-panel">
          <h2>Recent login &amp; logout history</h2>
          {activity.length ? (
            <div className="settings-activity-list">
              {activity.map(item => (
                <div key={item.id} className="settings-activity-row">
                  <span className={`settings-activity-dot ${item.event}`} aria-hidden="true" />
                  <div><strong>{item.event === 'logout' ? 'Logged out' : 'Signed in'}</strong><small>{item.device_name || 'Unknown device'}</small></div>
                  <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-PH')}</time>
                </div>
              ))}
            </div>
          ) : <p className="settings-empty-copy">No account activity is available yet.</p>}
        </section>
      </div>
      {alertDialog}
      {confirmDialog}
    </ProfileLayout>
  )
}

