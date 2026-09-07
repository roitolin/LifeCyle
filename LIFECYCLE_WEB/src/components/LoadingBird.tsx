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
      <span className='brand-loader-dots' aria-hidden='true'>
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
