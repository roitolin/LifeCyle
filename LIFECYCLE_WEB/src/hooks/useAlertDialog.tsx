import { useCallback, useMemo, useState } from 'react'

type AlertTone = 'info' | 'warning' | 'danger'

type AlertConfig = {
  title: string
  message: string
  details?: string[]
  tone?: AlertTone
  okLabel?: string
  onClose?: () => void
}

const toneMeta: Record<AlertTone, { kicker: string; className: string }> = {
  info: { kicker: 'Quick Notice', className: 'primary' },
  warning: { kicker: 'Heads Up', className: 'warning' },
  danger: { kicker: 'Action Needed', className: 'danger' },
}

function renderAlertIcon(tone: AlertTone) {
  switch (tone) {
    case 'warning':
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      )
    case 'danger':
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      )
  }
}

export function useAlertDialog() {
  const [config, setConfig] = useState<AlertConfig | null>(null)

  const closeAlert = useCallback(() => {
    setConfig(null)
  }, [])

  const openAlert = useCallback((nextConfig: AlertConfig) => {
    setConfig({ okLabel: 'OK', tone: 'info', ...nextConfig })
  }, [])

  const alertDialog = useMemo(() => {
    if (!config) return null

    const tone = toneMeta[config.tone || 'info']

    const handleOk = () => {
      const onClose = config.onClose
      closeAlert()
      onClose?.()
    }

    return (
      <div className="alert-modal-overlay" role="presentation" onClick={handleOk}>
        <div
          className={`alert-modal-card ${tone.className}`}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-message"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="alert-modal-icon" aria-hidden="true">
            {renderAlertIcon(config.tone || 'info')}
          </div>
          <span className="alert-modal-kicker">{tone.kicker}</span>
          <h3 id="alert-dialog-title" className="alert-modal-title">{config.title}</h3>
          <p id="alert-dialog-message" className="alert-modal-message">{config.message}</p>
          {config.details?.length ? (
            <ul className="alert-modal-list">
              {config.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="alert-modal-btn" onClick={handleOk}>
            {config.okLabel}
          </button>
        </div>
      </div>
    )
  }, [closeAlert, config])

  return { openAlert, closeAlert, alertDialog }
}
