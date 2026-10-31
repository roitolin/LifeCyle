import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type SocialProvider = 'google' | 'facebook'

type SocialAuthButtonsProps = {
  next?: string
  disabled?: boolean
  onError: (message: string) => void
}

const providerLabel: Record<SocialProvider, string> = {
  google: 'Google',
  facebook: 'Facebook',
}

async function ensureProviderIsEnabled(provider: SocialProvider) {
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '')
  if (!supabaseUrl || !publishableKey) {
    throw new Error('Social sign-in configuration is missing from this web build.')
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('Unable to check social sign-in availability. Please try again.')
  }

  const settings = await response.json() as { external?: Partial<Record<SocialProvider, boolean>> }
  if (!settings.external?.[provider]) {
    throw new Error(`${providerLabel[provider]} sign-in is not available yet. Please use email and password for now.`)
  }
}

function getSocialAuthErrorMessage(error: unknown, provider: SocialProvider) {
  const message = error instanceof Error ? error.message : String(error || '')

  if (/provider.*not enabled|unsupported provider/i.test(message)) {
    return `${providerLabel[provider]} sign-in is not configured yet. Please contact LifeCycle support.`
  }
  if (/network|fetch|connection|timeout/i.test(message)) {
    return 'Check your internet connection and try again.'
  }

  return message || `Unable to continue with ${providerLabel[provider]}. Please try again.`
}

function GoogleIcon() {
  return (
    <svg className="social-auth-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.259c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.333A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.281-1.706V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.333Z" />
      <path fill="#EA4335" d="M9 3.58c1.322 0 2.508.454 3.442 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.333C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg className="social-auth-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path fill="#fff" d="M13.5 20v-7h2.35l.35-2.73h-2.7V8.53c0-.79.22-1.33 1.35-1.33h1.44V4.76c-.25-.03-1.1-.1-2.1-.1-2.08 0-3.51 1.27-3.51 3.61v2H8.32V13h2.36v7h2.82Z" />
    </svg>
  )
}

export default function SocialAuthButtons({ next = '', disabled = false, onError }: SocialAuthButtonsProps) {
  const [activeProvider, setActiveProvider] = useState<SocialProvider | null>(null)

  const signIn = async (provider: SocialProvider) => {
    setActiveProvider(provider)
    onError('')

    try {
      await ensureProviderIsEnabled(provider)
      const callbackParams = new URLSearchParams({ oauth: '1' })
      if (next) callbackParams.set('next', next)
      const redirectTo = `${window.location.origin}/login?${callbackParams.toString()}`
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          scopes: provider === 'facebook' ? 'email,public_profile' : undefined,
          queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
        },
      })
      if (error) throw error
      if (!data.url) throw new Error('The sign-in provider did not return a login page.')

      window.location.assign(data.url)
    } catch (error) {
      setActiveProvider(null)
      onError(getSocialAuthErrorMessage(error, provider))
    }
  }

  const isBusy = activeProvider !== null

  return (
    <section className="social-auth" aria-label="Social account sign in">
      <div className="social-auth-divider" aria-hidden="true">
        <span>or continue with</span>
      </div>
      <div className="social-auth-buttons">
        <button
          type="button"
          className="social-auth-button"
          disabled={disabled || isBusy}
          onClick={() => void signIn('google')}
        >
          {activeProvider === 'google' ? <span className="social-auth-spinner" aria-hidden="true" /> : <GoogleIcon />}
          <span>{activeProvider === 'google' ? 'Opening Google...' : 'Continue with Google'}</span>
        </button>
        <button
          type="button"
          className="social-auth-button"
          disabled={disabled || isBusy}
          onClick={() => void signIn('facebook')}
        >
          {activeProvider === 'facebook' ? <span className="social-auth-spinner" aria-hidden="true" /> : <FacebookIcon />}
          <span>{activeProvider === 'facebook' ? 'Opening Facebook...' : 'Continue with Facebook'}</span>
        </button>
      </div>
    </section>
  )
}
