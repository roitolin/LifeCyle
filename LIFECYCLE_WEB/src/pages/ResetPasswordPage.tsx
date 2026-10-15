import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthBrandPanel from '@/components/AuthBrandPanel'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkingLink, setCheckingLink] = useState(true)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryTokenHash, setRecoveryTokenHash] = useState('')
  const [verifyingLink, setVerifyingLink] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const queryParams = new URLSearchParams(window.location.search)
    const hasRecoveryMarker =
      hashParams.get('type') === 'recovery' ||
      queryParams.get('type') === 'recovery' ||
      queryParams.has('code')
    const tokenHash = queryParams.get('token_hash') || ''
    const linkError = hashParams.get('error_description') || queryParams.get('error_description')

    if (tokenHash && queryParams.get('type') === 'recovery') {
      setRecoveryTokenHash(tokenHash)
      setError('')
      setCheckingLink(false)
      return
    }

    if (linkError) {
      setError('This password reset link is invalid or has expired. Please request a new one.')
      setCheckingLink(false)
      return
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' && session) {
        setRecoveryReady(true)
        setCheckingLink(false)
        setError('')
      }
    })

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (hasRecoveryMarker && data.session && !sessionError) {
        setRecoveryReady(true)
        setError('')
      } else if (hasRecoveryMarker && sessionError) {
        setError('This password reset link is invalid or has expired. Please request a new one.')
      } else {
        setError('Open the reset link from your email to choose a new password.')
      }
      setCheckingLink(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const verifyRecoveryLink = async () => {
    if (!recoveryTokenHash) return

    setVerifyingLink(true)
    setError('')

    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: recoveryTokenHash,
        type: 'recovery',
      })
      if (verifyError) throw verifyError
      if (!data.session) throw new Error('Recovery session was not created.')

      setRecoveryReady(true)
      setRecoveryTokenHash('')
      window.history.replaceState(window.history.state, document.title, '/reset-password')
    } catch {
      setError('This password reset link is invalid, expired, or has already been used. Request a new link and use only the newest email.')
    } finally {
      setVerifyingLink(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (password.length < 8) {
      setError('Use at least 8 characters for your new password.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      await supabase.auth.signOut({ scope: 'local' })
      navigate('/login?passwordReset=1', { replace: true })
    } catch (caughtError) {
      const errorCode =
        typeof caughtError === 'object' && caughtError !== null && 'code' in caughtError
          ? String(caughtError.code)
          : ''
      if (errorCode === 'same_password') {
        setError('Your new password must be different from your current password.')
      } else if (errorCode === 'weak_password') {
        setError('Please choose a stronger password.')
      } else {
        setError('Unable to reset your password. The link may have expired; please request a new one.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className='auth-page'>
      <div className='auth-layout'>
        <AuthBrandPanel />

        <section className='auth-card' aria-label='Reset password form'>
          <div className='page-back-row auth-page-back'><PageBackButton to='/login' /></div>

          <div className='auth-card-head'>
            <h1>Create New Password</h1>
            <p className='auth-subtitle'>Choose a new password for your LifeCycle account.</p>
            {checkingLink ? <p className='auth-message auth-message-info' role='status'>Checking your reset link...</p> : null}
            {recoveryTokenHash && !recoveryReady ? (
              <p className='auth-message auth-message-info' role='status'>
                Your reset link is ready. Continue to verify it and choose a new password.
              </p>
            ) : null}
            {error ? <p className='auth-message auth-message-error' role='alert'>{error}</p> : null}
          </div>

          {recoveryTokenHash && !recoveryReady ? (
            <button
              type='button'
              className={`solid-btn auth-submit${verifyingLink ? ' auth-submit-loading' : ''}`}
              disabled={verifyingLink}
              onClick={() => void verifyRecoveryLink()}
            >
              {verifyingLink ? 'Verifying...' : 'Continue Password Reset'}
            </button>
          ) : null}

          {recoveryReady ? (
            <form onSubmit={handleSubmit} className='auth-form'>
              <label htmlFor='reset-password'>New Password</label>
              <div className='password-field'>
                <input
                  id='reset-password'
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete='new-password'
                  minLength={8}
                  autoFocus
                  required
                />
                <button
                  type='button'
                  className='password-toggle'
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                >
                  {showPassword ? (
                    <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                      <path d='M3 3L21 21' strokeWidth='1.8' strokeLinecap='round' />
                      <path d='M9.88 5.09C10.56 4.89 11.27 4.79 12 4.79C16.5 4.79 20.27 8.06 21.25 12C20.91 13.36 20.18 14.6 19.15 15.55M14.12 18.91C13.44 19.11 12.73 19.21 12 19.21C7.5 19.21 3.73 15.94 2.75 12C3.31 9.75 4.78 7.83 6.77 6.65' strokeWidth='1.8' strokeLinecap='round' />
                    </svg>
                  ) : (
                    <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                      <path d='M2.75 12C3.73 8.06 7.5 4.79 12 4.79C16.5 4.79 20.27 8.06 21.25 12C20.27 15.94 16.5 19.21 12 19.21C7.5 19.21 3.73 15.94 2.75 12Z' strokeWidth='1.8' />
                      <circle cx='12' cy='12' r='3' strokeWidth='1.8' />
                    </svg>
                  )}
                </button>
              </div>
              <p className='auth-helper-text'>Use at least 8 characters.</p>

              <label htmlFor='reset-confirm-password'>Confirm New Password</label>
              <input
                id='reset-confirm-password'
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete='new-password'
                minLength={8}
                required
              />

              <button type='submit' className={`solid-btn auth-submit${loading ? ' auth-submit-loading' : ''}`} disabled={loading}>
                {loading ? 'Updating...' : 'Reset Password'}
              </button>
            </form>
          ) : null}

          {!checkingLink && !recoveryReady && !recoveryTokenHash ? (
            <p className='auth-switch'>
              <Link to='/forgot-password'>Request a New Reset Link</Link>
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}

export default ResetPasswordPage
