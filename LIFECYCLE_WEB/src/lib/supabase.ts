import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'

const requireEnv = (name: string): string => {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

let primaryClient: SupabaseClient | null = null
let refreshInFlight: Promise<Session | null> | null = null

const isAuthRequest = (request: Request) =>
  new URL(request.url).pathname.includes('/auth/v1/')

const isExpiredJwtResponse = async (response: Response) => {
  if (response.status !== 401) return false

  try {
    return /\bjwt\b.*\bexpired\b|\bexpired\b.*\bjwt\b/i.test(
      await response.clone().text(),
    )
  } catch {
    return false
  }
}

const sessionExpiredResponse = () =>
  new Response(
    JSON.stringify({
      code: 'AUTH_REQUIRED',
      message: 'Please sign in again.',
    }),
    {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Content-Type': 'application/json' },
    },
  )

const refreshCurrentSession = () => {
  if (!primaryClient) return Promise.resolve(null)
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = primaryClient.auth
    .refreshSession()
    .then(({ data, error }) => (error ? null : data.session))
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null
    })

  return refreshInFlight
}

// Recover a request sent just as a suspended browser tab wakes with an
// expired access token. Requests are retried at most once.
const fetchWithExpiredJwtRecovery: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const response = await fetch(request.clone())
  if (
    !primaryClient ||
    isAuthRequest(request) ||
    !(await isExpiredJwtResponse(response))
  ) {
    return response
  }

  const session = await refreshCurrentSession()
  if (!session) {
    await primaryClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return sessionExpiredResponse()
  }

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${session.access_token}`)
  const retryResponse = await fetch(new Request(request, { headers }))
  if (!(await isExpiredJwtResponse(retryResponse))) return retryResponse

  await primaryClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
  return sessionExpiredResponse()
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithExpiredJwtRecovery,
    },
  },
)

primaryClient = supabase

// Isolated auth client used exclusively for verifying passwords without
// writing session cookies/localStorage or firing global onAuthStateChange events that would refresh the UI.
export const isolatedAuthClient = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
)
