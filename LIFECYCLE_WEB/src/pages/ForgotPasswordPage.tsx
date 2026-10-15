import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthBrandPanel from '@/components/AuthBrandPanel'
import PageBackButton from '@/components/PageBackButton'
import { supabase } from '@/lib/supabase'
import { getSupabasePasswordResetRedirectTo } from '@/lib/supabaseAuthRedirect'
import { normalizeEmail } from '@/utils/inputSecurity'

function getResetRequestErrorMessage(errorCode: string): string {
  if (errorCode === 'auth/invalid-email' || errorCode === 'email_address_invalid') {
    return 'Please enter a valid email address.'
  }
  if (errorCode === 'auth/too-many-requests' || errorCode === 'over_email_send_rate_limit') {
    return 'Too many requests. Please wait a moment and try again.'
  }
  if (errorCode === 'auth/network-request-failed') {
    return 'Network error. Please check your internet connection.'
  }
  return 'Unable to send a reset link right now. Please try again.'
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = normalizeEmail(email)

    if (!normalizedEmail) {
      setError('Please enter your email address.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: getSupabasePasswordResetRedirectTo(),
      })
      if (resetError) throw resetError
      setSent(true)
    } catch (caughtError) {
      const errorCode =
        typeof caughtError === 'object' && caughtError !== null && 'code' in caughtError
          ? String(caughtError.code)
          : ''
      setError(getResetRequestErrorMessage(errorCode))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className='auth-page'>
      <div className='auth-layout'>
        <AuthBrandPanel />

        <section className='auth-card' aria-label='Password recovery form'>
          <div className='page-back-row auth-page-back'><PageBackButton to='/login' /></div>

          <div className='auth-card-head'>
            <h1>Forgot Password?</h1>
            <p className='auth-subtitle'>Enter your email and we will send you a secure reset link.</p>
            {sent ? (
              <p className='auth-message auth-message-info' role='status'>
                If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.
              </p>
            ) : null}
            {error ? <p className='auth-message auth-message-error' role='alert'>{error}</p> : null}
          </div>

          {!sent ? (
            <form onSubmit={handleSubmit} className='auth-form'>
              <label htmlFor='recovery-email'>Email</label>
              <input
                id='recovery-email'
                type='email'
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete='email'
                autoFocus
                required
              />
              <button type='submit' className={`solid-btn auth-submit${loading ? ' auth-submit-loading' : ''}`} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
            <button type='button' className='ghost-btn auth-submit' onClick={() => setSent(false)}>
              Send Again
            </button>
          )}

          <p className='auth-switch'>
            Remember your password? <Link to='/login'>Back to Login</Link>
          </p>
        </section>
      </div>
    </main>
  )
}

export default ForgotPasswordPage
