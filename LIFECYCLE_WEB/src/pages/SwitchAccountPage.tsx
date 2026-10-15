import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { supabase } from '@/lib/supabase'
import {
  markWebAccountSessionSignedOut,
  recordWebAccountLoginActivity,
} from '@/utils/accountActivity'
import {
  forgetWebRememberedAccount,
  getWebRememberedAccounts,
  rememberWebAccount,
  type WebRememberedAccount,
} from '@/utils/webDeviceAccounts'
import './SwitchAccountPage.css'

function AccountAvatar({ account }: { account: WebRememberedAccount }) {
  if (account.photoURL) {
    return <span className='switch-account-avatar'><img src={account.photoURL} alt='' /></span>
  }

  return (
    <span className='switch-account-avatar' aria-hidden='true'>
      {(account.fullName || account.email).charAt(0).toUpperCase()}
    </span>
  )
}

export default function SwitchAccountPage() {
  const navigate = useNavigate()
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [accounts, setAccounts] = useState<WebRememberedAccount[]>([])
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error

      const session = data.session
      if (session) {
        const { data: profile } = await supabase
          .from('users')
          .select('fullName,photoURL')
          .eq('id', session.user.id)
          .maybeSingle()
        rememberWebAccount(session, profile)
        setCurrentAccountId(session.user.id)
      } else {
        setCurrentAccountId(null)
      }
      setAccounts(getWebRememberedAccounts())
    } catch (error) {
      openAlert({
        title: 'Accounts Unavailable',
        message: error instanceof Error ? error.message : 'Saved accounts could not be loaded.',
        tone: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }, [openAlert])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const signOutCurrentForSwitch = async () => {
    if (!currentAccountId) return
    await Promise.allSettled([
      markWebAccountSessionSignedOut('account_switched'),
      recordWebAccountLoginActivity('logout'),
    ])
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    setCurrentAccountId(null)
  }

  const signInAs = async (account: WebRememberedAccount) => {
    if (busyAccountId || account.id === currentAccountId) return
    setBusyAccountId(account.id)
    try {
      await signOutCurrentForSwitch()
      navigate(`/login?switch=1&email=${encodeURIComponent(account.email)}`, { replace: true })
    } catch (error) {
      setBusyAccountId(null)
      openAlert({
        title: 'Unable to Switch',
        message: error instanceof Error ? error.message : 'Please try again.',
        tone: 'danger',
      })
    }
  }

  const addAccount = async () => {
    if (busyAccountId) return
    setBusyAccountId('add-account')
    try {
      await signOutCurrentForSwitch()
      navigate('/login?switch=1', { replace: true })
    } catch (error) {
      setBusyAccountId(null)
      openAlert({
        title: 'Unable to Continue',
        message: error instanceof Error ? error.message : 'Please try again.',
        tone: 'danger',
      })
    }
  }

  const requestRemove = (account: WebRememberedAccount) => {
    const isCurrent = account.id === currentAccountId
    openConfirm({
      title: 'Remove account from this browser?',
      message: isCurrent
        ? 'This account will be signed out and removed from the saved account list.'
        : 'The saved account name and email will be removed from this browser.',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      pendingLabel: 'Removing...',
      tone: 'danger',
      onConfirm: async () => {
        setBusyAccountId(account.id)
        if (isCurrent) {
          await Promise.allSettled([
            markWebAccountSessionSignedOut(),
            recordWebAccountLoginActivity('logout'),
          ])
          const { error } = await supabase.auth.signOut({ scope: 'local' })
          if (error) throw error
          setCurrentAccountId(null)
        }
        forgetWebRememberedAccount(account.id)
        setAccounts(getWebRememberedAccounts())
        setBusyAccountId(null)
      },
    })
  }

  return (
    <main className="auth-page">
      <div className="auth-layout switch-account-layout">
        <section className="auth-card switch-account-card">
          <button type='button' className='back-btn' onClick={() => navigate('/funeral')}>
            {'< Back'}
          </button>
          <div className='auth-card-head'>
            <h1>Switch account</h1>
            <p className='auth-subtitle'>Choose a saved account or add another one.</p>
          </div>

          {loading ? <p className='switch-account-empty'>Loading saved accounts...</p> : null}
          {!loading && accounts.length === 0 ? (
            <p className='switch-account-empty'>No accounts are saved in this browser yet.</p>
          ) : null}

          {!loading && accounts.length > 0 ? (
            <div className='switch-account-list'>
              {accounts.map((account) => {
                const isCurrent = account.id === currentAccountId
                const busy = busyAccountId === account.id
                return (
                  <div className='switch-account-row' key={account.id}>
                    <button
                      type='button'
                      className='switch-account-main'
                      disabled={isCurrent || Boolean(busyAccountId)}
                      onClick={() => void signInAs(account)}
                    >
                      <AccountAvatar account={account} />
                      <span className='switch-account-copy'>
                        <strong>{account.fullName}</strong>
                        <small>{account.email}</small>
                      </span>
                      {isCurrent ? <span className='switch-account-current'>Current</span> : null}
                      {busy ? <span>Working...</span> : null}
                    </button>
                    <button
                      type='button'
                      className='switch-account-remove'
                      aria-label={`Remove ${account.email} from this browser`}
                      disabled={Boolean(busyAccountId)}
                      onClick={() => requestRemove(account)}
                    >
                      <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                        <path d='M3 6h18' /><path d='M8 6V4h8v2' /><path d='M19 6l-1 14H6L5 6' />
                        <path d='M10 11v5M14 11v5' />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className='switch-account-actions'>
            <button type='button' className='solid-btn' disabled={Boolean(busyAccountId)} onClick={() => void addAccount()}>
              Add another account
            </button>
            {!currentAccountId ? (
              <button type='button' className='ghost-btn' onClick={() => navigate('/login')}>
                Sign in
              </button>
            ) : null}
          </div>
          <p className='switch-account-note'>
            For security, saved web accounts store only profile details. You will enter the password when switching accounts.
          </p>
        </section>
      </div>
      {confirmDialog}
      {alertDialog}
    </main>
  )
}
