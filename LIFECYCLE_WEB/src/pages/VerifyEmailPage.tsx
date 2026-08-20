import { useEffect, useMemo, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { getSupabaseEmailRedirectTo } from '@/lib/supabaseAuthRedirect'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'

const VERIFICATION_WINDOW_MS = 30 * 60 * 1000

function getRoleRedirect(role: string) {
  if (role === 'super_admin') return '/admin/dashboard'
  if (role === 'funeral_admin') return '/admin/funeral-shops'
  return role === 'admin' ? '/admin' : '/app'
}

function getDeadlineKey(uid: string) {
  return `verification_deadline_${uid}`
}

function VerifyEmailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [remainingMs, setRemainingMs] = useState(VERIFICATION_WINDOW_MS)
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [status, setStatus] = useState('')

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const raw = params.get('next') || ''
    return raw.startsWith('/') ? raw : ''
  }, [location.search])

  useEffect(() => {
    const exchangeVerificationCode = async () => {
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      if (!code) return

      setChecking(true)
      setStatus('')
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) throw error
        params.delete('code')
        const nextSearch = params.toString()
        window.history.replaceState(null, '', `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`)
        setStatus('Email verified. Redirecting...')
      } catch {
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
      if (!nextUser) {
        navigate('/login', { replace: true })
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      if (!nextUser) {
        navigate('/login', { replace: true })
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [navigate])

  useEffect(() => {
    const autoForwardVerifiedUser = async () => {
      if (!user?.email_confirmed_at) return
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      const role = String(profile?.role || 'user').toLowerCase()
      window.localStorage.removeItem(getDeadlineKey(user.id))
      navigate(nextPath || getRoleRedirect(role), { replace: true })
    }
    void autoForwardVerifiedUser()
  }, [navigate, nextPath, user])

  useEffect(() => {
    if (!user) return

    const key = getDeadlineKey(user.id)
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
      navigate('/login?verifyExpired=1', { replace: true })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [navigate, user])

  const refreshVerification = async () => {
    if (!user) return
    setChecking(true)
    setStatus('')
    try {
      const { data } = await supabase.auth.getUser()
      const refreshed = data.user
      if (!refreshed?.email_confirmed_at) {
        setStatus('Email is still not verified. Please check your inbox and click the verification link.')
        return
      }

      const { data: profile } = await supabase.from('users').select('role').eq('id', refreshed.id).maybeSingle()
      const role = String(profile?.role || 'user').toLowerCase()
      window.localStorage.removeItem(getDeadlineKey(refreshed.id))
      navigate(nextPath || getRoleRedirect(role), { replace: true })
    } finally {
      setChecking(false)
    }
  }

  const resendVerification = async () => {
    if (!user) return
    setResending(true)
    setStatus('')
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: user.email || '',
        options: {
          emailRedirectTo: getSupabaseEmailRedirectTo(),
        },
      })
      if (error) throw error
      setStatus('Verification email sent again. Please check your inbox.')
    } catch {
      setStatus('Failed to resend verification email. Please try again.')
    } finally {
      setResending(false)
    }
  }

  const logoutNow = async () => {
    if (user) {
      window.localStorage.removeItem(getDeadlineKey(user.id))
    }
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
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
            <p className="auth-brand-tagline">Compassionate funeral service coordination for every Philippine family.</p>
            <ul className="auth-brand-list">
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Verified and accredited funeral shops</span>
              </li>
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Personalised service and tribute requests</span>
              </li>
              <li>
                <svg className="auth-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Secure payments with GCash, Maya &amp; cards</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="auth-card" aria-label="Verify email">
          <div className="auth-card-head">
            <h1>Verify Your Email</h1>
            <p className="auth-subtitle">You are logged in as: <strong>{user?.email || 'Unknown email'}</strong></p>
            <p className="auth-subtitle">Session expires in {timeLabel}. You will be logged out if still unverified.</p>

          {status ? <p className="auth-message auth-message-info">{status}</p> : null}
          </div>

          <div className="verification-actions">
            <button
              type="button"
              className="solid-btn auth-submit"
              onClick={() => void refreshVerification()}
              disabled={checking}
            >
              {checking ? 'Checking...' : "I've Verified My Email"}
            </button>
            <button
              type="button"
              className="ghost-btn auth-submit"
              onClick={() => void resendVerification()}
              disabled={resending}
            >
              {resending ? 'Sending...' : 'Resend Verification Email'}
            </button>
            <button type="button" className="ghost-btn auth-submit" onClick={() => void logoutNow()}>
              Logout Now
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

export default VerifyEmailPage
