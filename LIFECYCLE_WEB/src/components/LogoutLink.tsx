import type { ComponentProps, MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useLogoutConfirmation } from '@/components/logoutConfirmationContext'

type LogoutLinkProps = Omit<ComponentProps<typeof Link>, 'to'>

export default function LogoutLink({ children, onClick, ...props }: LogoutLinkProps) {
  const { requestLogout: openLogoutConfirmation } = useLogoutConfirmation()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()

    openLogoutConfirmation()
  }

  return <Link {...props} to='/auth/logout' onClick={handleClick}>{children}</Link>
}
