import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { getSupabaseEmailRedirectTo } from '@/lib/supabaseAuthRedirect'
import { normalizeEmail } from '@/utils/inputSecurity'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import PageBackButton from '@/components/PageBackButton'

type Gender = 'male' | 'female' | 'other' | ''

const PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~"
const PASSWORD_REQUIREMENTS = [
  { id: 'length', label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { id: 'lowercase', label: 'One lowercase letter (a-z)', test: (value: string) => /[a-z]/.test(value) },
  { id: 'uppercase', label: 'One uppercase letter (A-Z)', test: (value: string) => /[A-Z]/.test(value) },
  { id: 'number', label: 'One number (0-9)', test: (value: string) => /[0-9]/.test(value) },
  { id: 'symbol', label: 'One special character (!@#$...)', test: (value: string) => Array.from(value).some((character) => PASSWORD_SYMBOLS.includes(character)) },
] as const
const STRONG_PASSWORD_MESSAGE =
  'Use 8 or more characters with lowercase and uppercase letters, a number, and a special character.'

function getPasswordChecks(value: string) {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    label: requirement.label,
    met: requirement.test(value),
  }))
}

function isStrongPassword(value: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value))
}

function PasswordStrengthChecklist({ password }: { password: string }) {
  const checks = getPasswordChecks(password)
  const passedCount = checks.filter((check) => check.met).length
  const level = password.length === 0 ? 0 : passedCount === checks.length ? 3 : passedCount >= 3 ? 2 : 1
  const tone = level === 3 ? 'strong' : level === 2 ? 'medium' : level === 1 ? 'weak' : 'empty'
  const label = level === 3 ? 'Strong' : level === 2 ? 'Medium' : level === 1 ? 'Weak' : 'Not started'

  return (
    <section className={`password-strength-card is-${tone}`} aria-live="polite">
      <div className="password-strength-heading">
        <strong>Password strength</strong>
        <span>{label}</span>
      </div>
      <div
        className="password-strength-track"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={checks.length}
        aria-valuenow={passedCount}
        aria-valuetext={`${label}: ${passedCount} of ${checks.length} requirements met`}
      >
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={`password-strength-segment${segment <= level ? ' is-active' : ''}`} />
        ))}
      </div>
      <ul className="password-requirements">
        {checks.map((check) => (
          <li key={check.id} className={check.met ? 'is-met' : ''}>
            <span className="password-requirement-icon" aria-hidden="true">{check.met ? '\u2713' : '\u00d7'}</span>
            <span>{check.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function getRegisterErrorMessage(errorCode: string): string {
  if (errorCode === 'auth/email-already-in-use') return 'Email already in use.'
  if (errorCode === 'auth/weak-password' || errorCode === 'weak_password') return STRONG_PASSWORD_MESSAGE
  if (errorCode === 'auth/invalid-email') return 'Please enter a valid email address.'
  if (errorCode === 'auth/network-request-failed') return 'Network error. Please check your internet connection.'
  return 'Registration failed. Please try again.'
}

function RegisterPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [gender, setGender] = useState<Gender>('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const passwordIsStrong = isStrongPassword(password)
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  const redirectAfterRegister = (() => {
    const search = new URLSearchParams(location.search)
    const next = search.get('next') || ''
    return next.startsWith('/') ? next : ''
  })()

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!fullName.trim() || !gender || !dateOfBirth || !email.trim() || !password.trim()) {
      setError('Please fill in all fields.')
      return
    }

    if (!passwordIsStrong) {
      setError(STRONG_PASSWORD_MESSAGE)
      return
    }

    if (!passwordsMatch) {
      setError('Passwords do not match.')
      return
    }

    setError('')
    setLoading(true)

    try {
      const normalizedEmail = normalizeEmail(email)
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: getSupabaseEmailRedirectTo(),
          data: {
            fullName: fullName.trim(),
            gender,
            dateOfBirth: new Date(dateOfBirth).toISOString(),
          },
        },
      })
      if (signUpError) throw signUpError

      const user = authData.user
      if (!user) throw new Error('Supabase did not return a user for this registration.')

      const verificationParams = new URLSearchParams({ email: normalizedEmail })
      if (redirectAfterRegister) verificationParams.set('next', redirectAfterRegister)
      const target = `/verify-email?${verificationParams.toString()}`
      navigate(target)
    } catch (caughtError) {
      const errorCode =
        typeof caughtError === 'object' && caughtError !== null && 'code' in caughtError
          ? String(caughtError.code)
          : ''
      setError(getRegisterErrorMessage(errorCode))
    } finally {
      setLoading(false)
    }
  }

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

        <section className="auth-card" aria-label="Register form">
          <div className="page-back-row auth-page-back"><PageBackButton onClick={goBack} /></div>

          <div className="auth-card-head">
            <h1>Create Account</h1>
            <p className="auth-subtitle">Set up your family or funeral service profile.</p>

          {error ? <p className="auth-message auth-message-error">{error}</p> : null}
          </div>

          <form onSubmit={handleRegister} className="auth-form">
            <label htmlFor="register-fullname">Full Name</label>
            <input
              id="register-fullname"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
            />

            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <label htmlFor="register-password">Password</label>
            <div className="password-field">
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                aria-describedby="register-password-strength"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 3L21 21" strokeWidth="1.8" strokeLinecap="round" />
                    <path
                      d="M10.58 10.58C10.21 10.95 10 11.46 10 12C10 13.1 10.9 14 12 14C12.54 14 13.05 13.79 13.42 13.42"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M9.88 5.09C10.56 4.89 11.27 4.79 12 4.79C16.5 4.79 20.27 8.06 21.25 12C20.91 13.36 20.18 14.6 19.15 15.55M14.12 18.91C13.44 19.11 12.73 19.21 12 19.21C7.5 19.21 3.73 15.94 2.75 12C3.31 9.75 4.78 7.83 6.77 6.65"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M2.75 12C3.73 8.06 7.5 4.79 12 4.79C16.5 4.79 20.27 8.06 21.25 12C20.27 15.94 16.5 19.21 12 19.21C7.5 19.21 3.73 15.94 2.75 12Z"
                      strokeWidth="1.8"
                    />
                    <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
                  </svg>
                )}
              </button>
            </div>

            <div id="register-password-strength">
              <PasswordStrengthChecklist password={password} />
            </div>

            <label htmlFor="register-confirm-password">Confirm Password</label>
            <input
              id="register-confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
              aria-describedby="register-password-match"
              required
            />
            <p
              id="register-password-match"
              className={`password-match-message${passwordsMatch ? ' is-match' : ''}`}
              aria-live="polite"
            >
              {confirmPassword.length === 0
                ? 'Re-enter your password.'
                : passwordsMatch
                  ? 'Passwords match.'
                  : 'Passwords do not match.'}
            </p>

            <label htmlFor="register-gender">Gender</label>
            <select
              id="register-gender"
              value={gender}
              onChange={(event) => setGender(event.target.value as Gender)}
              required
            >
              <option value="">Select gender...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>

            <label htmlFor="register-dob">Date of Birth</label>
            <input
              id="register-dob"
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              required
            />

            <button type="submit" className="solid-btn auth-submit" disabled={loading || !passwordIsStrong || !passwordsMatch}>
              {loading ? 'Registering...' : 'Sign up'}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account? <Link to={redirectAfterRegister ? `/login?next=${encodeURIComponent(redirectAfterRegister)}` : '/login'}>Login</Link>
          </p>
        </section>
      </div>
    </main>
  )
}

export default RegisterPage
