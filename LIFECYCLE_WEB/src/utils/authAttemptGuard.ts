type AttemptState = {
  windowStartMs: number
  failedCount: number
  blockedUntilMs: number
}

const PREFIX = 'auth_attempt_guard_v1'
const WINDOW_MS = 10 * 60 * 1000
const MAX_FAILED_IN_WINDOW = 5
const BLOCK_MS = 10 * 60 * 1000

const nowMs = () => Date.now()

const normalizeKeyPart = (value: string) => String(value || '').trim().toLowerCase()

const keyFor = (identifier: string) => `${PREFIX}:${normalizeKeyPart(identifier)}`

const parseState = (raw: string | null): AttemptState | null => {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as AttemptState
    if (
      typeof data.windowStartMs !== 'number' ||
      typeof data.failedCount !== 'number' ||
      typeof data.blockedUntilMs !== 'number'
    ) {
      return null
    }
    return data
  } catch {
    return null
  }
}

const getStore = (): Storage | null => {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export const getLoginBlockState = (identifier: string): { blocked: boolean; retryAfterSeconds: number } => {
  const store = getStore()
  if (!store) return { blocked: false, retryAfterSeconds: 0 }

  const state = parseState(store.getItem(keyFor(identifier)))
  if (!state) return { blocked: false, retryAfterSeconds: 0 }

  const remainingMs = state.blockedUntilMs - nowMs()
  if (remainingMs <= 0) return { blocked: false, retryAfterSeconds: 0 }

  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
  }
}

export const recordFailedLoginAttempt = (identifier: string) => {
  const store = getStore()
  if (!store) return

  const now = nowMs()
  const current = parseState(store.getItem(keyFor(identifier)))

  if (!current || now - current.windowStartMs > WINDOW_MS) {
    const next: AttemptState = {
      windowStartMs: now,
      failedCount: 1,
      blockedUntilMs: 0,
    }
    store.setItem(keyFor(identifier), JSON.stringify(next))
    return
  }

  const nextFailedCount = current.failedCount + 1
  const blockedUntilMs = nextFailedCount >= MAX_FAILED_IN_WINDOW ? now + BLOCK_MS : current.blockedUntilMs
  const next: AttemptState = {
    windowStartMs: current.windowStartMs,
    failedCount: nextFailedCount,
    blockedUntilMs,
  }
  store.setItem(keyFor(identifier), JSON.stringify(next))
}

export const clearLoginAttempts = (identifier: string) => {
  const store = getStore()
  if (!store) return
  store.removeItem(keyFor(identifier))
}
