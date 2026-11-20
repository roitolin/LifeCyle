import { useEffect, useState } from 'react'
import './LoadingStatus.css'

type LoadingStatusProps = {
  compact?: boolean
  fullScreen?: boolean
  label?: string
}

export default function LoadingStatus({ compact = false, fullScreen = false, label = 'Loading…' }: LoadingStatusProps) {
  const [visible, setVisible] = useState(false)
  const size = fullScreen ? ' is-full-screen' : compact ? ' is-compact' : ''

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 240)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className={`lc-loading-status${size}`} role="status">
      <span className={visible ? undefined : 'sr-only'}>{label}</span>
    </div>
  )
}
