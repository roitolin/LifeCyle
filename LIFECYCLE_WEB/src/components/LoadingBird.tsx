type LoadingBirdProps = {
  compact?: boolean
  fullScreen?: boolean
}

export default function LoadingBird({ compact = false, fullScreen = false }: LoadingBirdProps) {
  const dotClass = `${compact ? 'size-1.5' : 'size-2'} animate-brand-loader-dot rounded-full bg-[#315f50] opacity-35 motion-reduce:animate-none motion-reduce:opacity-65`

  return (
    <div
      role='status'
      aria-label='Loading, please wait'
      className={`flex w-full flex-col items-center justify-center bg-[#f8f6f2] ${compact ? 'min-h-24' : 'min-h-[180px]'} ${fullScreen ? 'min-h-screen min-h-dvh' : ''}`}
    >
      <span className='flex h-[13px] items-center gap-[7px]' aria-hidden='true'>
        <i className={dotClass} />
        <i className={`${dotClass} [animation-delay:140ms]`} />
        <i className={`${dotClass} [animation-delay:280ms]`} />
      </span>
    </div>
  )
}
