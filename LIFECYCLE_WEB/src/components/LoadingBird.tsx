import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import './LoadingBird.css'

type LoadingBirdProps = {
  compact?: boolean
  fullScreen?: boolean
}

export default function LoadingBird({ compact = false, fullScreen = false }: LoadingBirdProps) {
  return (
    <div
      role='status'
      aria-label='Loading, please wait'
      className={`brand-loader${compact ? ' compact' : ''}${fullScreen ? ' full-screen' : ''}`}
    >
      <div className='brand-loader-stage' aria-hidden='true'>
        <span className='brand-loader-halo' />
        <span className='brand-loader-orbit'><i /></span>
        <span className='brand-loader-mark'>
          <img src={APP_ICON_TRANSPARENT_URL} alt='' />
        </span>
      </div>
      {!compact ? <div className='brand-loader-copy'><strong>LIFECYCLE</strong><span>Preparing everything for you</span></div> : null}
    </div>
  )
}
