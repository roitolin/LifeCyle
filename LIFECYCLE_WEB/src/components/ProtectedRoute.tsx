import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { ensureOwnUserProfile } from '@/lib/userProfile'
import LoadingBird from '@/components/LoadingBird'
import {
  registerWebAccountSession,
  verifyWebAccountSession,
} from '@/utils/accountActivity'

type ProtectedRouteProps = {
  redirectTo?: string
  allowedRoles?: string[]
  redirectUnauthorizedTo?: string
}

function ProtectedRoute({
  redirectTo = '/login',
  allowedRoles,
  redirectUnauthorizedTo = '/app',
}: ProtectedRouteProps) {
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [userRole, setUserRole] = useState('')
  const [banDialog, setBanDialog] = useState<{ reason: string; banEndsLabel: string } | null>(null)
  const [checking, setChecking] = useState(true)

  const toDate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const converted = (value as { toDate?: () => Date }).toDate?.()
      return converted && !Number.isNaN(converted.getTime()) ? converted : null
    }
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  useEffect(() => {
    const syncUser = async (nextUser: User | null) => {
      setUser(nextUser)
      if (!nextUser) {
        setUserRole('')
        setChecking(false)
        return
      }

      setChecking(true)
      void registerWebAccountSession()
      let data
      try {
        data = await ensureOwnUserProfile(nextUser)
      } catch {
        setUserRole('')
        setChecking(false)
        return
      }
      const profile = data as
          | {
              role?: string
              disabled?: boolean
              banReason?: string | null
              bannedUntil?: unknown
            }
          | undefined
        const disabled = Boolean(profile?.disabled)
        const bannedUntil = toDate(profile?.bannedUntil)
        const hasValidBanEnd = bannedUntil !== null

        if (disabled && hasValidBanEnd && bannedUntil.getTime() <= Date.now()) {
          void supabase.from('users').update({
            disabled: false,
            banReason: null,
            bannedBy: null,
            bannedAt: null,
            bannedUntil: null,
          }).eq('id', nextUser.id)
        }

        if (disabled && (!hasValidBanEnd || bannedUntil.getTime() > Date.now())) {
          setBanDialog({
            reason: String(profile?.banReason || '').trim() || 'No reason provided by admin.',
            banEndsLabel: hasValidBanEnd ? bannedUntil.toLocaleString(undefined, { hour12: true }) : 'No end date (permanent)',
          })
          setUser(null)
          setUserRole('')
          setChecking(false)
          void supabase.auth.signOut()
          return
        }

        setBanDialog(null)
        setUserRole(String(profile?.role || 'user').toLowerCase())
        setChecking(false)
    }

    let syncedUserId: string | null = null
    void supabase.auth.getSession().then(({ data }) => {
      syncedUserId = data.session?.user?.id ?? null
      void syncUser(data.session?.user ?? null)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase emits TOKEN_REFRESHED (and sometimes duplicate SIGNED_IN or USER_UPDATED)
      // when it silently refreshes the JWT or updates user data. If the user hasn't changed we
      // only need to update the user object — no need for a full profile
      // re-fetch which would flash a loading spinner.
      if (
        session?.user?.id &&
        syncedUserId === session.user.id &&
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')
      ) {
        setUser(session.user)
        return
      }
      syncedUserId = session?.user?.id ?? null
      void syncUser(session?.user ?? null)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user?.id) return undefined

    let checkingSession = false
    const verifySession = async () => {
      if (checkingSession) return
      checkingSession = true
      try {
        const health = await verifyWebAccountSession()
        if (health === 'revoked') {
          await supabase.auth.signOut({ scope: 'local' })
        }
      } finally {
        checkingSession = false
      }
    }

    const interval = window.setInterval(() => void verifySession(), 120_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void verifySession()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user?.id])

  if (checking) {
    return <LoadingBird fullScreen />
  }

  if (!user) {
    if (banDialog) {
      return <Navigate to="/login" replace state={{ banDialog }} />
    }
    const target =
      redirectTo === '/'
        ? '/'
        : `${redirectTo}?next=${encodeURIComponent(location.pathname + location.search)}`
    return <Navigate to={target} replace />
  }

  if (!user.email_confirmed_at) {
    const verifyTarget = `/verify-email?next=${encodeURIComponent(location.pathname + location.search)}`
    return <Navigate to={verifyTarget} replace />
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    return <Navigate to={redirectUnauthorizedTo} replace />
  }

  return <Outlet />
}

export default ProtectedRoute

