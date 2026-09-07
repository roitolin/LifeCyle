import { Link } from 'react-router-dom'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import './BrandLogo.css'

type BrandLogoProps = {
  to?: string
  compact?: boolean
  className?: string
}

export default function BrandLogo({ to = '/funeral', compact = false, className = '' }: BrandLogoProps) {
  const classes = ['lc-brand', compact ? 'lc-brand--compact' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <Link to={to} className={classes} aria-label="LifeCycle home">
      <img className="lc-brand__mark" src={APP_ICON_TRANSPARENT_URL} alt="" />

      <span className="lc-brand__wordmark" aria-hidden="true">
        <span className="lc-brand__name">
          <span>Life</span><strong>Cycle</strong>
        </span>
        <span className="lc-brand__tagline">Funeral Services</span>
      </span>
    </Link>
  )
}
