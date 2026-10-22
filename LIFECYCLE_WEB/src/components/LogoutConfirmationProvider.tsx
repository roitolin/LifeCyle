import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { supabase } from '@/lib/supabase'
import { LogoutConfirmationContext } from '@/components/logoutConfirmationContext'
import {
  markWebAccountSessionSignedOut,
  recordWebAccountLoginActivity,
} from '@/utils/accountActivity'

import { forgetWebRememberedAccount } from '@/utils/webDeviceAccounts'
export function LogoutConfirmationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const logout = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const accountId = data.session?.user.id || null
    await Promise.allSettled([
      markWebAccountSessionSignedOut(),
      recordWebAccountLoginActivity('logout'),
    ])
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
    navigate('/funeral', { replace: true })
    if (accountId) forgetWebRememberedAccount(accountId)
  }, [navigate])

  const requestLogout = useCallback(() => {
    openConfirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      confirmLabel: 'Log Out',
      cancelLabel: 'Cancel',
      pendingLabel: 'Logging out...',
      tone: 'session',
      onConfirm: logout,
    })
  }, [logout, openConfirm])

  const value = useMemo(() => ({ requestLogout }), [requestLogout])

  return (
    <LogoutConfirmationContext.Provider value={value}>
      {children}
      {confirmDialog}
    </LogoutConfirmationContext.Provider>
  )
}
