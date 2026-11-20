import { Link } from 'react-router-dom'
import BrandLogo from '@/components/BrandLogo'
import HeaderAccountMenu, { type HeaderAccountProfile } from '@/components/HeaderAccountMenu'
import './AccountTaskHeader.css'

export type AccountHeaderProfile = HeaderAccountProfile

export default function AccountTaskHeader({ title, profile, showShopCenter = false }: {
  title: string
  profile: AccountHeaderProfile | null
  showShopCenter?: boolean
}) {
  return (
    <header className="account-task-header">
      <div className="account-task-header-inner">
        <BrandLogo to="/funeral" compact className="account-task-brand" />
        <h1>{title}</h1>
        <div className="account-task-header-actions">
          <Link className="account-task-help" to="/user/help">Help Centre</Link>
          <HeaderAccountMenu profile={profile} task showShopCenter={showShopCenter} />
        </div>
      </div>
    </header>
  )
}
