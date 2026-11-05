import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { forgetWebRememberedAccount } from '@/utils/webDeviceAccounts'
import ProfileLayout from './ProfileLayout'

async function readFunctionError(error: unknown, fallback: string) {
  try {
    const context = (error as { context?: { json?: () => Promise<{ error?: unknown }> } })?.context
    const body = await context?.json?.()
    if (typeof body?.error === 'string' && body.error.trim()) return body.error
  } catch {
    // Fall back to the client error below when the response body is unavailable.
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export default function PrivacyDataPage() {
  const [exporting, setExporting] = useState(false)
  const [deletionModalOpen, setDeletionModalOpen] = useState(false)
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

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

  const deleteAccount = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      openAlert({ title: 'Session Required', message: 'Please sign in again before deleting your account.', tone: 'danger' })
      return
    }

    const { data, error } = await supabase.functions.invoke('account-deletion', {
      body: { confirmation: 'DELETE' },
    })
    if (error) {
      openAlert({
        title: 'Account Not Deleted',
        message: await readFunctionError(error, 'Unable to delete your account.'),
        tone: 'danger',
      })
      return
    }
    if (!data?.deleted) {
      openAlert({
        title: 'Account Not Deleted',
        message: typeof data?.error === 'string' ? data.error : 'Unable to delete your account.',
        tone: 'danger',
      })
      return
    }

    forgetWebRememberedAccount(session.user.id)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    navigate('/login?accountDeleted=1', { replace: true })
  }

  const continueDeletion = () => {
    if (deletionConfirmation.trim() !== 'DELETE') return
    setDeletionModalOpen(false)
    openConfirm({
      title: 'Permanently delete your account?',
      message: 'This cannot be undone. Your account and eligible account data will be permanently deleted without admin approval.',
      details: ['Active services or pending shop payments must be resolved first.'],
      confirmLabel: 'Delete Permanently',
      cancelLabel: 'Keep My Account',
      pendingLabel: 'Deleting...',
      tone: 'danger',
      onConfirm: deleteAccount,
    })
  }

  return (
    <ProfileLayout title="Privacy & Data" subtitle="Understand, export, or permanently delete your account data.">
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
            <button
              type="button"
              className="danger"
              onClick={() => {
                setDeletionConfirmation('')
                setDeletionModalOpen(true)
              }}
            >
              <span><strong>Delete Account</strong><small>Permanently delete your account without admin approval.</small></span><span aria-hidden="true">&rsaquo;</span>
            </button>
          </div>
        </section>
        <div className="settings-legal-links"><Link to="/privacy-policy">Privacy Policy</Link><Link to="/policies">Terms of Use</Link></div>
      </div>
      {deletionModalOpen ? (
        <div
          className="info-modal-overlay"
          role="presentation"
          onClick={() => setDeletionModalOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDeletionModalOpen(false)
          }}
        >
          <div
            className="info-modal-card account-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-delete-title"
            aria-describedby="account-delete-description"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="account-delete-icon" aria-hidden="true">!</span>
            <h3 id="account-delete-title">Delete your account</h3>
            <p id="account-delete-description">
              No admin approval is required. This action is permanent and cannot be undone.
            </p>
            <label htmlFor="account-delete-confirmation">
              Type <strong>DELETE</strong> to continue
            </label>
            <input
              id="account-delete-confirmation"
              value={deletionConfirmation}
              onChange={(event) => setDeletionConfirmation(event.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={10}
              autoFocus
            />
            <div className="account-delete-actions">
              <button type="button" className="account-delete-cancel" onClick={() => setDeletionModalOpen(false)}>
                Keep My Account
              </button>
              <button
                type="button"
                className="account-delete-continue"
                disabled={deletionConfirmation.trim() !== 'DELETE'}
                onClick={continueDeletion}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {alertDialog}
      {confirmDialog}
    </ProfileLayout>
  )
}

