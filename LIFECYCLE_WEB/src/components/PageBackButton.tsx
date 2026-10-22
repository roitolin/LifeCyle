import { useNavigate } from 'react-router-dom'
import './PageBackButton.css'

type PageBackButtonProps = {
  label?: string
  to?: string
  fallbackTo?: string
  className?: string
  onClick?: () => void
}

export default function PageBackButton({
  label = 'Back',
  to,
  fallbackTo = '/funeral',
  className = '',
  onClick,
}: PageBackButtonProps) {
  const navigate = useNavigate()

  const goBack = () => {
    if (onClick) {
      onClick()
      return
    }
    if (to) {
      navigate(to)
      return
    }
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(fallbackTo)
  }

  return (
    <button
      type="button"
      className={`page-back-button${className ? ` ${className}` : ''}`}
      onClick={goBack}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M19 12H5" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
      <span>{label}</span>
    </button>
  )
}
