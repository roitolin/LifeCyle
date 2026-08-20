import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import ProfileLayout from './ProfileLayout'

export default function PrivacyDataPage() {
  const [exporting, setExporting] = useState(false)
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()

  const exportMyData = async () => {
    setExporting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) throw new Error('Please sign in again before exporting your data.')

      const [profile, requests, blocks, notifications] = await Promise.all([
        supabase.from('users').select('id,email,fullName,gender,dateOfBirth,photoURL,termsAccepted,termsAcceptedAt,createdAt,updatedAt').eq('id', session.user.id).maybeSingle(),
        supabase.from('funeral_service_requests').select('*').eq('requesterId', session.user.id).order('createdAt', { ascending: false }),
        supabase.from('user_blocks').select('blockedId,createdAt').eq('blockerId', session.user.id).order('createdAt', { ascending: false }),
        supabase.from('notifications').select('id,type,title,body,read,createdAt').eq('userId', session.user.id).order('createdAt', { ascending: false }),
      ])
      const error = profile.error || requests.error || blocks.error || notifications.error
      if (error) throw error

      const report = {
        exportedAt: new Date().toISOString(),
        account: profile.data || { id: session.user.id, email: session.user.email },
        serviceRequests: requests.data || [],
        blockedAccounts: blocks.data || [],
        notifications: notifications.data || [],
      }
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `lifecycle-account-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      openAlert({ title: 'Export Ready', message: 'Your LifeCycle account data was downloaded.', okLabel: 'Done' })
    } catch (error) {
      openAlert({ title: 'Export Failed', message: error instanceof Error ? error.message : 'Your account data could not be exported.', tone: 'danger' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <ProfileLayout title="Privacy & Data" subtitle="Understand, export, or request deletion of your account data.">
      <div className="settings-page-content">
        <section className="settings-panel">
          <h2>Your data</h2>
          <div className="settings-data-grid">
            <div><strong>Account information</strong><p>Your profile, email, and acceptance records.</p></div>
            <div><strong>Service information</strong><p>Your service requests and related details.</p></div>
            <div><strong>App activity</strong><p>Your notifications and blocked-account list.</p></div>
          </div>
        </section>
        <section className="settings-panel">
          <h2>Data controls</h2>
          <div className="settings-control-list">
            <button type="button" onClick={() => void exportMyData()} disabled={exporting}>
              <span><strong>{exporting ? 'Preparing export...' : 'Export My Data'}</strong><small>Download a portable JSON copy of your account data.</small></span><span aria-hidden="true">&rsaquo;</span>
            </button>
            <button type="button" className="danger" onClick={() => navigate('/user/contact?subject=Account%20deletion')}>
              <span><strong>Request Account Deletion</strong><small>Contact support for identity verification and permanent deletion.</small></span><span aria-hidden="true">&rsaquo;</span>
            </button>
          </div>
        </section>
        <div className="settings-legal-links"><Link to="/privacy-policy">Privacy Policy</Link><Link to="/policies">Terms of Use</Link></div>
      </div>
      {alertDialog}
    </ProfileLayout>
  )
}

