import { useNavigate } from 'react-router-dom'

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
      type='button'
      className={`page-back-button inline-flex min-h-[38px] cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-[7px] font-[inherit] text-[13px] font-bold leading-[1.4] text-[#53615d] no-underline transition-colors duration-150 hover:text-[#22312d] focus-visible:rounded-[3px] focus-visible:outline-[3px] focus-visible:outline-[rgba(49,95,80,0.2)] focus-visible:outline-offset-[3px] max-[560px]:min-h-11 max-[560px]:text-sm ${className}`}
      onClick={goBack}
      aria-label={label}
    >
      <svg className='size-4 shrink-0 stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
        <path d='M19 12H5' />
        <polyline points='12 19 5 12 12 5' />
      </svg>
      <span>{label}</span>
    </button>
  )
}
