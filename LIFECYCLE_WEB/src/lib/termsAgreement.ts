import type { UserProfile } from './userProfile'

export const needsTermsAgreement = (profile: UserProfile) => profile.termsAccepted === false

export const getTermsAgreementPath = (nextPath: string) => {
  const safeNext = nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/terms-agreement')
    ? nextPath
    : '/funeral'
  return `/terms-agreement?next=${encodeURIComponent(safeNext)}`
}

export const getTermsReturnPath = (nextPath: string, fallback: string) =>
  nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/terms-agreement')
    ? nextPath
    : fallback
