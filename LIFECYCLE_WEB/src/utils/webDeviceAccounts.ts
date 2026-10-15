import type { Session } from '@supabase/supabase-js'

export type WebRememberedAccount = {
  id: string
  email: string
  fullName: string
  photoURL: string | null
  lastUsedAt: string
}

type AccountProfile = Record<string, unknown> | null | undefined

const REMEMBERED_ACCOUNTS_KEY = 'lifecycle_remembered_accounts'
const MAX_REMEMBERED_ACCOUNTS = 6

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeAccount(value: unknown): WebRememberedAccount | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WebRememberedAccount>
  if (!isNonEmptyString(candidate.id) || !isNonEmptyString(candidate.email)) return null

  return {
    id: candidate.id.trim(),
    email: candidate.email.trim(),
    fullName: isNonEmptyString(candidate.fullName)
      ? candidate.fullName.trim()
      : candidate.email.trim().split('@')[0],
    photoURL: isNonEmptyString(candidate.photoURL) ? candidate.photoURL.trim() : null,
    lastUsedAt: isNonEmptyString(candidate.lastUsedAt)
      ? candidate.lastUsedAt
      : new Date(0).toISOString(),
  }
}

function writeAccounts(accounts: WebRememberedAccount[]) {
  window.localStorage.setItem(
    REMEMBERED_ACCOUNTS_KEY,
    JSON.stringify(accounts.slice(0, MAX_REMEMBERED_ACCOUNTS)),
  )
}

export function getWebRememberedAccounts(): WebRememberedAccount[] {
  const stored = window.localStorage.getItem(REMEMBERED_ACCOUNTS_KEY)
  if (!stored) return []

  try {
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normalizeAccount)
      .filter((account): account is WebRememberedAccount => Boolean(account))
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
  } catch {
    return []
  }
}

export function rememberWebAccount(session: Session, profile?: AccountProfile) {
  const id = session.user.id.trim()
  const email = String(session.user.email || '').trim()
  if (!id || !email) return

  const existing = getWebRememberedAccounts()
  const previous = existing.find((account) => account.id === id)
  const metadata = session.user.user_metadata || {}
  const fullName = String(
    profile?.fullName ||
      metadata.fullName ||
      metadata.name ||
      previous?.fullName ||
      email.split('@')[0],
  ).trim()
  const photoURL = String(
    profile?.photoURL ||
      metadata.photoURL ||
      metadata.avatar_url ||
      previous?.photoURL ||
      '',
  ).trim()

  const account: WebRememberedAccount = {
    id,
    email,
    fullName: fullName || email.split('@')[0],
    photoURL: photoURL || null,
    lastUsedAt: new Date().toISOString(),
  }

  writeAccounts([account, ...existing.filter((item) => item.id !== id)])
}

export function forgetWebRememberedAccount(accountId: string) {
  const normalizedId = accountId.trim()
  if (!normalizedId) return
  writeAccounts(getWebRememberedAccounts().filter((account) => account.id !== normalizedId))
}
