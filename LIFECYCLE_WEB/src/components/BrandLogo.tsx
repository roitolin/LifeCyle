import { Link } from 'react-router-dom'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'

type BrandLogoProps = {
  to?: string
  compact?: boolean
  className?: string
}

export default function BrandLogo({ to = '/funeral', compact = false, className = '' }: BrandLogoProps) {
  const rootClasses = [
    'lc-brand group inline-flex shrink-0 items-center rounded-[14px] text-[var(--lc-brand-ink)] no-underline outline-none',
    '[--lc-brand-ink:#172033] [--lc-brand-soft:#64748b]',
    'focus-visible:outline-[3px] focus-visible:outline-[rgba(51,65,85,0.24)] focus-visible:outline-offset-[5px]',
    compact ? 'lc-brand--compact gap-2.5' : 'gap-3',
    className,
  ].filter(Boolean).join(' ')

  const markClasses = [
    'lc-brand__mark block shrink-0 object-contain',
    'shadow-[0_8px_20px_rgba(23,32,51,0.16)] transition-[transform,box-shadow] duration-[180ms] ease-out',
    'group-hover:-translate-y-px group-hover:shadow-[0_11px_24px_rgba(23,32,51,0.2)] motion-reduce:transition-none',
    compact ? 'size-[42px] rounded-xl' : 'size-[50px] rounded-[14px]',
  ].join(' ')

  return (
    <Link to={to} className={rootClasses} aria-label='LifeCycle home'>
      <img className={markClasses} src={APP_ICON_TRANSPARENT_URL} alt='' />

      <span className='lc-brand__wordmark inline-flex min-w-0 flex-col justify-center' aria-hidden='true'>
        <span className={`lc-brand__name block whitespace-nowrap font-[Sora,Manrope,sans-serif] font-semibold leading-[1.05] tracking-[-0.045em] ${compact ? 'text-[22px]' : 'text-[26px]'}`}>
          <span>Life</span><strong className='font-extrabold'>Cycle</strong>
        </span>
        <span className={`lc-brand__tagline block whitespace-nowrap font-[Manrope,sans-serif] text-[11px] font-bold uppercase leading-none tracking-[0.19em] text-[var(--lc-brand-soft)] ${compact ? 'mt-[3px]' : 'mt-1'}`}>
          Funeral Services
        </span>
      </span>
    </Link>
  )
}
