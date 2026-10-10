import { useCallback, useMemo, useState } from 'react'

type ConfirmTone = 'primary' | 'success' | 'warning' | 'danger' | 'session'

type ConfirmConfig = {
  title: string
  message: string
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  pendingLabel?: string
  tone?: ConfirmTone
  onConfirm?: () => void | Promise<void>
}

function renderToneIcon(tone: ConfirmTone) {
  switch (tone) {
    case 'session':
      return (
        <svg viewBox='0 0 24 24' width='27' height='27' fill='none' stroke='currentColor' strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'>
          <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
          <path d='M16 17l5-5-5-5' />
          <path d='M21 12H9' />
        </svg>
      )
    case 'success':
      return (
        <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )
    case 'warning':
      return (
        <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'danger':
      return (
        <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
  }
}

export function useConfirmDialog() {
  const [config, setConfig] = useState<ConfirmConfig | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')

  const closeConfirm = useCallback(() => {
    if (submitting) return
    setConfig(null)
    setActionError('')
  }, [submitting])

  const openConfirm = useCallback((nextConfig: ConfirmConfig) => {
    setActionError('')
    setConfig({
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      pendingLabel: 'Working...',
      tone: 'primary',
      ...nextConfig,
    })
  }, [])

  const confirmDialog = useMemo(() => {
    if (!config) return null

    const tone = config.tone || 'primary'

    return (
      <div className="info-modal-overlay" role="presentation" onClick={closeConfirm}>
        <div
          className={`info-modal-card confirm-modal-card ${tone}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          onClick={(event) => event.stopPropagation()}
        >
          {tone === 'session' ? (
            <div className='confirm-session-copy'>
              <h3 id="confirm-dialog-title" className="confirm-modal-title">
                {config.title}
              </h3>
              <p id="confirm-dialog-message" className="confirm-modal-message">
                {config.message}
              </p>
            </div>
          ) : (
            <div className="confirm-modal-header">
              <span className="confirm-modal-icon" aria-hidden="true">
                {renderToneIcon(tone)}
              </span>
              <div className="confirm-modal-heading">
                <h3 id="confirm-dialog-title" className="confirm-modal-title">
                  {config.title}
                </h3>
                <p id="confirm-dialog-message" className="confirm-modal-message">
                  {config.message}
                </p>
              </div>
            </div>
          )}
          {config.details?.length ? (
            <ul className="confirm-modal-list">
              {config.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {actionError ? <p className='confirm-modal-error' role='alert'>{actionError}</p> : null}
          <div className="confirm-modal-actions">
            <button type="button" className="confirm-modal-cancel" onClick={closeConfirm} disabled={submitting}>
              {config.cancelLabel}
            </button>
            <button
              type="button"
              className="confirm-modal-confirm"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true)
                try {
                  await config.onConfirm?.()
                  setConfig(null)
                  setActionError('')
                } catch {
                  setActionError(
                    tone === 'session'
                      ? 'Could not log out. Please check your connection and try again.'
                      : 'Could not complete this action. Please try again.',
                  )
                } finally {
                  setSubmitting(false)
                }
              }}
            >
              {submitting ? (
                <>
                  <span className="confirm-modal-spinner" aria-hidden="true" />
                  {config.pendingLabel}
                </>
              ) : (
                config.confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }, [actionError, closeConfirm, config, submitting])

  return { openConfirm, closeConfirm, confirmDialog }
}
