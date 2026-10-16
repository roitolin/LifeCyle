import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import PageBackButton from '@/components/PageBackButton'
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

const avatarClass = 'grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#315f50] font-extrabold text-white [&_img]:size-full [&_img]:object-cover'

function AccountAvatar({ account }: { account: WebRememberedAccount }) {
  if (account.photoURL) {
    return <span className={avatarClass}><img src={account.photoURL} alt='' /></span>
  }

  return (
    <span className={avatarClass} aria-hidden='true'>
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
      <div className="auth-layout grid w-full max-w-[620px] grid-cols-1">
        <section className="auth-card gap-5 min-[481px]:gap-5 max-[480px]:min-w-0 max-[480px]:gap-4">
          <div className='page-back-row auth-page-back'><PageBackButton to='/funeral' /></div>
          <div className='auth-card-head'>
            <h1>Switch account</h1>
            <p className='auth-subtitle'>Choose a saved account or add another one.</p>
          </div>

          {loading ? <p className='rounded-2xl border border-dashed border-[#cbd5d1] p-6 text-center text-[#64748b]'>Loading saved accounts...</p> : null}
          {!loading && accounts.length === 0 ? (
            <p className='rounded-2xl border border-dashed border-[#cbd5d1] p-6 text-center text-[#64748b]'>No accounts are saved in this browser yet.</p>
          ) : null}

          {!loading && accounts.length > 0 ? (
            <div className='grid gap-2.5'>
              {accounts.map((account) => {
                const isCurrent = account.id === currentAccountId
                const busy = busyAccountId === account.id
                return (
                  <div className='flex min-h-[72px] items-center gap-3 rounded-2xl border border-[#dce4e0] bg-[#f8faf9] px-3 py-2.5 max-[480px]:min-w-0 max-[480px]:gap-2.5 max-[480px]:rounded-xl max-[480px]:p-2.5' key={account.id}>
                    <button
                      type='button'
                      className='flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-inherit disabled:cursor-default max-[480px]:min-w-0'
                      disabled={isCurrent || Boolean(busyAccountId)}
                      onClick={() => void signInAs(account)}
                    >
                      <AccountAvatar account={account} />
                      <span className='grid min-w-0 flex-1 gap-[3px]'>
                        <strong className='truncate text-[#22312d]'>{account.fullName}</strong>
                        <small className='truncate text-[#64748b]'>{account.email}</small>
                      </span>
                      {isCurrent ? <span className='rounded-full bg-[#e7f0eb] px-2 py-[5px] text-[0.7rem] font-extrabold uppercase text-[#315f50] max-[480px]:px-1.5 max-[480px]:py-1 max-[480px]:text-[0.62rem] max-[360px]:hidden'>Current</span> : null}
                      {busy ? <span>Working...</span> : null}
                    </button>
                    <button
                      type='button'
                      className='grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-[#fff0f0] text-[#b4232c] [&_svg]:size-[18px]'
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

          <div className='flex flex-wrap gap-2.5 max-[480px]:grid max-[480px]:grid-cols-1 [&_button]:min-h-11 [&_button]:flex-[1_1_190px] max-[480px]:[&_button]:w-full'>
            <button type='button' className='solid-btn' disabled={Boolean(busyAccountId)} onClick={() => void addAccount()}>
              Add another account
            </button>
            {!currentAccountId ? (
              <button type='button' className='ghost-btn' onClick={() => navigate('/login')}>
                Sign in
              </button>
            ) : null}
          </div>
          <p className='text-[0.8rem] leading-[1.55] text-[#64748b]'>
            For security, saved web accounts store only profile details. You will enter the password when switching accounts.
          </p>
        </section>
      </div>
      {confirmDialog}
      {alertDialog}
    </main>
  )
}
