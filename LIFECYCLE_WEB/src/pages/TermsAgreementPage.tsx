import { useEffect, useMemo, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ensureOwnUserProfile } from '@/lib/userProfile'
import { getTermsReturnPath, needsTermsAgreement } from '@/lib/termsAgreement'
import { termsSections } from '@/data/termsSections'
import LoadingBird from '@/components/LoadingBird'
import './TermsAgreementPage.css'

const EFFECTIVE_DATE = 'April 2, 2026'

function defaultDestination(role: string | null | undefined) {
  return role === 'super_admin' || role === 'admin' ? '/admin/dashboard' : '/funeral'
}

export default function TermsAgreementPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const documentRef = useRef<HTMLDivElement>(null)
  const [user, setUser] = useState<User | null>(null)
  const [destination, setDestination] = useState('/funeral')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [hasReachedEnd, setHasReachedEnd] = useState(false)
  const [accepted, setAccepted] = useState(false)

  const requestedDestination = useMemo(
    () => new URLSearchParams(location.search).get('next') || '',
    [location.search],
  )

  useEffect(() => {
    let active = true

    const loadAgreement = async () => {
      try {
        const { data, error: authError } = await supabase.auth.getUser()
        const currentUser = data.user
        if (!currentUser) {
          navigate('/login', { replace: true })
          return
        }
        if (authError) throw authError
        if (!currentUser.email_confirmed_at) {
          navigate('/verify-email', { replace: true })
          return
        }

        const profile = await ensureOwnUserProfile(currentUser)
        if (!active) return
        const nextPath = getTermsReturnPath(requestedDestination, defaultDestination(profile.role))
        if (!needsTermsAgreement(profile)) {
          navigate(nextPath, { replace: true })
          return
        }
        setUser(currentUser)
        setDestination(nextPath)
      } catch {
        if (active) setError('We could not load your agreement status. Check your connection and retry.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadAgreement()
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate('/login', { replace: true })
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [navigate, requestedDestination])

  useEffect(() => {
    if (!user) return
    const documentElement = documentRef.current
    if (!documentElement) return
    const checkShortDocument = () => {
      if (documentElement.scrollHeight <= documentElement.clientHeight + 24) {
        setProgress(100)
        setHasReachedEnd(true)
      }
    }
    checkShortDocument()
    const observer = new ResizeObserver(checkShortDocument)
    observer.observe(documentElement)
    return () => observer.disconnect()
  }, [user])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget
    const distance = Math.max(element.scrollHeight - element.clientHeight, 1)
    const scrolled = Math.min(1, Math.max(0, element.scrollTop / distance))
    setProgress(Math.round(scrolled * 100))
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 24) {
      setHasReachedEnd(true)
      setProgress(100)
    }
  }

  const acceptAgreement = async () => {
    if (!user || !hasReachedEnd || !accepted || saving) return
    setSaving(true)
    setError('')
    try {
      const acceptedAt = new Date().toISOString()
      const { data, error: saveError } = await supabase
        .from('users')
        .update({ termsAccepted: true, termsAcceptedAt: acceptedAt, updatedAt: acceptedAt })
        .eq('id', user.id)
        .select('termsAccepted, termsAcceptedAt')
        .single()
      if (saveError) throw saveError
      if (data?.termsAccepted !== true) throw new Error('The agreement was not saved.')
      navigate(destination, { replace: true })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'The agreement could not be saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  const signOut = async () => {
    setSaving(true)
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      navigate('/login', { replace: true })
    } catch {
      setError('We could not sign you out. Please retry.')
      setSaving(false)
    }
  }

  if (loading) return <LoadingBird fullScreen />

  if (!user) {
    return (
      <main className="terms-page terms-load-error" role="alert">
        <h1>Agreement unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>Retry</button>
      </main>
    )
  }

  const ownerName = String(user.user_metadata?.fullName || user.user_metadata?.full_name || user.email || 'there')
    .trim().split(/\s+/)[0]

  return (
    <main className="terms-page">
      <div className="terms-shell">
        <div className="terms-hero">
          <span className="terms-eyebrow">ONE MORE STEP</span>
          <h1>Review the LifeCycle agreement</h1>
          <p>Signed in as {ownerName}. Read every section before confirming your agreement.</p>
        </div>

        <section className="terms-card" aria-label="LifeCycle agreement">
          <div className="terms-card-header">
            <div>
              <h2>LifeCycle Agreement</h2>
              <span>Effective {EFFECTIVE_DATE}</span>
            </div>
            <span className="terms-progress-value" aria-label={`${progress}% read`}>{progress}%</span>
          </div>
          <div className="terms-progress-track" aria-hidden="true">
            <div style={{ width: `${progress}%` }} />
          </div>

          <div
            ref={documentRef}
            className="terms-document"
            role="region"
            aria-label="Agreement text"
            tabIndex={0}
            onScroll={handleScroll}
          >
            <p className="terms-introduction">
              This agreement explains the responsibilities of families, account owners, and funeral-service providers when using LifeCycle.
            </p>
            {termsSections.map((section, index) => (
              <section key={section.title} className="terms-section">
                <h3>{index + 1}. {section.title}</h3>
                {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.bulletPoints ? (
                  <ul>{section.bulletPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                ) : null}
              </section>
            ))}
            <div className="terms-end-marker">
              <strong>You reached the end</strong>
              <span>Confirm your review below to continue.</span>
            </div>
            <label className={`terms-consent${hasReachedEnd ? '' : ' is-disabled'}`}>
              <input
                type="checkbox"
                checked={accepted}
                disabled={!hasReachedEnd}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>I reviewed this agreement and consent to follow it while using LifeCycle.</span>
            </label>
          </div>

          <div className="terms-footer">
            <div className="terms-footer-status" role="status">
              {hasReachedEnd
                ? accepted ? 'Ready to continue' : 'Confirm your review above'
                : 'Scroll through every section to continue'}
              {' · '}
              <Link
                to={`/privacy-policy?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
                target="_blank"
                rel="noreferrer"
              >Privacy Policy</Link>
            </div>
            {error ? <p className="terms-error" role="alert">{error}</p> : null}
            <div className="terms-actions">
              <button type="button" className="terms-signout" disabled={saving} onClick={() => void signOut()}>
                Sign out
              </button>
              <button type="button" className="terms-continue" disabled={!hasReachedEnd || !accepted || saving} onClick={() => void acceptAgreement()}>
                {saving ? 'Saving...' : 'Agree and continue'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
