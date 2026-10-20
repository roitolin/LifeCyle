import { useEffect, useMemo, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { normalizeEmail } from '@/utils/inputSecurity'

const OTP_LENGTH = 6
const VERIFICATION_WINDOW_MS = 60 * 60 * 1000
const RESEND_COOLDOWN_SECONDS = 60

function getRoleRedirect(role: string) {
  if (role === 'super_admin') return '/admin/dashboard'
  if (role === 'funeral_admin') return '/admin/funeral-shops'
  return role === 'admin' ? '/admin' : '/app'
}

function getDeadlineKey(identity: string) {
  return `verification_deadline_${identity.toLowerCase()}`
}

function getVerificationError(error: unknown) {
  const message = String(
    typeof error === 'object' && error !== null && 'message' in error ? error.message : ''
  ).toLowerCase()
  if (message.includes('rate limit')) return 'Too many attempts. Please wait and try again.'
  if (message.includes('expired') || message.includes('invalid')) {
    return 'That code is invalid or expired. Request a new code and try again.'
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Check your internet connection and try again.'
  }
  return 'We could not verify that code. Please try again.'
}

function VerifyEmailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [remainingMs, setRemainingMs] = useState(VERIFICATION_WINDOW_MS)
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [code, setCode] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [deadlineRevision, setDeadlineRevision] = useState(0)
  const [status, setStatus] = useState('')
  const [statusIsError, setStatusIsError] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const raw = params.get('next') || ''
    return raw.startsWith('/') ? raw : ''
  }, [location.search])
  const requestedEmail = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return normalizeEmail(params.get('email') || '')
  }, [location.search])
  const verificationEmail = normalizeEmail(requestedEmail || user?.email || '')

  useEffect(() => {
    const exchangeVerificationCode = async () => {
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      if (!code) return

      setChecking(true)
      setStatus('')
      setStatusIsError(false)
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) throw error
        params.delete('code')
        const nextSearch = params.toString()
        window.history.replaceState(null, '', `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`)
        setStatus('Email verified. Redirecting...')
      } catch {
        setStatusIsError(true)
        setStatus('Verification link could not be processed. Please request a new verification email.')
      } finally {
        setChecking(false)
      }
    }

    void exchangeVerificationCode()
  }, [location.pathname, location.search])

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const nextUser = data.session?.user ?? null
      setUser(nextUser)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
    })
    return () => listener.subscription.unsubscribe()
  }, [navigate])

  useEffect(() => {
    const autoForwardVerifiedUser = async () => {
      if (!user?.email_confirmed_at) return
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      const role = String(profile?.role || 'user').toLowerCase()
      if (user.email) window.localStorage.removeItem(getDeadlineKey(user.email))
      navigate(nextPath || getRoleRedirect(role), { replace: true })
    }
    void autoForwardVerifiedUser()
  }, [navigate, nextPath, user])

  useEffect(() => {
    if (!verificationEmail) return

    const key = getDeadlineKey(verificationEmail)
    const savedDeadline = Number(window.localStorage.getItem(key) || 0)
    const initialDeadline = Number.isFinite(savedDeadline) && savedDeadline > Date.now()
      ? savedDeadline
      : Date.now() + VERIFICATION_WINDOW_MS

    window.localStorage.setItem(key, String(initialDeadline))
    setRemainingMs(Math.max(0, initialDeadline - Date.now()))

    const timer = window.setInterval(() => {
      const left = Math.max(0, initialDeadline - Date.now())
      setRemainingMs(left)
      if (left > 0) return

      window.clearInterval(timer)
      window.localStorage.removeItem(key)
      void supabase.auth.signOut()
      navigate(`/login?verifyExpired=1&email=${encodeURIComponent(verificationEmail)}`, { replace: true })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [deadlineRevision, navigate, verificationEmail])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setInterval(() => {
      setResendCooldown(current => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

  const verifyCode = async () => {
    if (!verificationEmail || code.length !== OTP_LENGTH) {
      setStatusIsError(true)
      setStatus(`Enter the complete ${OTP_LENGTH}-digit code from your email.`)
      codeInputRef.current?.focus()
      return
    }
    setChecking(true)
    setStatus('')
    setStatusIsError(false)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: verificationEmail,
        token: code,
        type: 'email',
      })
      if (error) throw error
      const verifiedUser = data.user
      if (!verifiedUser?.email_confirmed_at) throw new Error('Verification could not be confirmed.')
      const { data: profile } = await supabase.from('users').select('role').eq('id', verifiedUser.id).maybeSingle()
      const role = String(profile?.role || 'user').toLowerCase()
      window.localStorage.removeItem(getDeadlineKey(verificationEmail))
      setStatus('Email verified. Redirecting...')
      navigate(nextPath || getRoleRedirect(role), { replace: true })
    } catch (error) {
      setCode('')
      setStatusIsError(true)
      setStatus(getVerificationError(error))
      codeInputRef.current?.focus()
    } finally {
      setChecking(false)
    }
  }

  const resendVerification = async () => {
    if (!verificationEmail || resendCooldown > 0) return
    setResending(true)
    setStatus('')
    setStatusIsError(false)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: verificationEmail,
      })
      if (error) throw error
      setCode('')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      const nextDeadline = Date.now() + VERIFICATION_WINDOW_MS
      window.localStorage.setItem(getDeadlineKey(verificationEmail), String(nextDeadline))
      setRemainingMs(VERIFICATION_WINDOW_MS)
      setDeadlineRevision(current => current + 1)
      setStatus('A new verification code was sent. Check your inbox and spam folder.')
      codeInputRef.current?.focus()
    } catch (error) {
      setStatusIsError(true)
      setStatus(getVerificationError(error))
    } finally {
      setResending(false)
    }
  }

  const logoutNow = async () => {
    if (verificationEmail) window.localStorage.removeItem(getDeadlineKey(verificationEmail))
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const confirmLogout = () => {
    openConfirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log Out',
      cancelLabel: 'Cancel',
      pendingLabel: 'Logging out...',
      tone: 'session',
      onConfirm: logoutNow,
    })
  }

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const timeLabel = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-brand" aria-hidden="true">
          <div className="auth-brand-inner">
            <img className="auth-logo" src={APP_ICON_TRANSPARENT_URL} alt="LifeCycle" />
            <h2>LifeCycle</h2>
            <p className="auth-brand-tagline">Browse funeral shops and coordinate service requests.</p>
            <ul className="auth-brand-list">
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Active funeral shop listings</span>
              </li>
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Service and custom tribute requests</span>
              </li>
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Shop payment instructions and receipt review</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="auth-card auth-verification-card" aria-label="Verify email">
          <div className="auth-card-head">
            <h1>Enter Verification Code</h1>
            <p className="auth-subtitle">We sent a {OTP_LENGTH}-digit code to <strong>{verificationEmail || 'your email'}</strong>.</p>
            <p className="auth-subtitle">Code expires in {timeLabel}.</p>

          {status ? <p role="status" className={`auth-message ${statusIsError ? 'auth-message-error' : 'auth-message-info'}`}>{status}</p> : null}
          </div>

          <div className="verification-actions">
            <label className="auth-otp-label" htmlFor="verification-code">Verification code</label>
            <div className="auth-otp-control">
              <div className="auth-otp-boxes" aria-hidden="true">
                {Array.from({ length: OTP_LENGTH }, (_, index) => (
                  <span
                    key={index}
                    className={`auth-otp-digit${code[index] ? ' is-filled' : ''}`}
                  >
                    {code[index] || ''}
                  </span>
                ))}
              </div>
              <input
                ref={codeInputRef}
                id="verification-code"
                className="auth-otp-input"
                aria-label="Email verification code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                value={code}
                maxLength={OTP_LENGTH}
                onChange={event => {
                  setCode(event.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))
                  if (statusIsError) setStatus('')
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') void verifyCode()
                }}
                autoFocus
              />
            </div>
            <button
              type="button"
              className="solid-btn auth-submit"
              onClick={() => void verifyCode()}
              disabled={checking || code.length !== OTP_LENGTH}
            >
              {checking ? 'Verifying...' : 'Verify Email'}
            </button>
            <button
              type="button"
              className="ghost-btn auth-submit"
              onClick={() => void resendVerification()}
              disabled={resending || resendCooldown > 0 || !verificationEmail}
            >
              {resending ? 'Sending...' : resendCooldown > 0 ? `Resend Code in ${resendCooldown}s` : 'Resend Code'}
            </button>
            <button type='button' className='ghost-btn auth-submit' onClick={confirmLogout}>
              Logout Now
            </button>
          </div>
        </section>
      </div>
      {confirmDialog}
    </main>
  )
}

export default VerifyEmailPage
