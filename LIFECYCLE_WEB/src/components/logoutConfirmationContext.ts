import { createContext, useContext } from 'react'

export type LogoutConfirmationContextValue = {
  requestLogout: () => void
}

export const LogoutConfirmationContext = createContext<LogoutConfirmationContextValue | null>(null)

export function useLogoutConfirmation() {
  const context = useContext(LogoutConfirmationContext)
  if (!context) throw new Error('useLogoutConfirmation must be used inside LogoutConfirmationProvider')
  return context
}
