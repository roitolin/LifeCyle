import { useCallback, useEffect, useRef, useState } from 'react'
import './MobileMediaPermissionGate.css'

const SESSION_PERMISSION_KEY = 'lifecycle.mobile-media-access'
const bypassedInputs = new WeakSet<HTMLInputElement>()

function isMobileBrowser() {
  return window.matchMedia('(max-width: 768px)').matches
    || window.matchMedia('(hover: none) and (pointer: coarse)').matches
}

function hasSessionPermission() {
  try {
    return window.sessionStorage.getItem(SESSION_PERMISSION_KEY) === 'allowed'
  } catch {
    return false
  }
}

function rememberSessionPermission() {
  try {
    window.sessionStorage.setItem(SESSION_PERMISSION_KEY, 'allowed')
  } catch {
    // The permission still applies to this one user-initiated picker action.
  }
}

export default function MobileMediaPermissionGate() {
  const [pendingInput, setPendingInput] = useState<HTMLInputElement | null>(null)
  const allowButtonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => setPendingInput(null), [])

  const allow = useCallback(() => {
    if (!pendingInput) return
    const input = pendingInput
    rememberSessionPermission()
    bypassedInputs.add(input)
    setPendingInput(null)
    input.click()
  }, [pendingInput])

  useEffect(() => {
    const interceptImagePicker = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)
        || target.type !== 'file'
        || target.disabled
        || !target.accept.toLowerCase().includes('image')
        || !isMobileBrowser()) {
        return
      }

      if (bypassedInputs.has(target)) {
        bypassedInputs.delete(target)
        return
      }
      if (hasSessionPermission()) return

      event.preventDefault()
      event.stopImmediatePropagation()
      setPendingInput(target)
    }

    document.addEventListener('click', interceptImagePicker, true)
    return () => document.removeEventListener('click', interceptImagePicker, true)
  }, [])

  useEffect(() => {
    if (!pendingInput) return
    allowButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close, pendingInput])

  if (!pendingInput) return null

  return (
    <div className='media-permission-overlay' role='presentation' onClick={close}>
      <section
        className='media-permission-dialog'
        role='alertdialog'
        aria-modal='true'
        aria-labelledby='media-permission-title'
        aria-describedby='media-permission-description'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='media-permission-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24'>
            <path d='M4 7h3l1.4-2h7.2L17 7h3v12H4z' />
            <circle cx='12' cy='13' r='3.5' />
          </svg>
        </div>
        <h2 id='media-permission-title'>Allow photo access?</h2>
        <p id='media-permission-description'>
          Allow LifeCycle to open your camera or photo library. Only the photo you choose will be shared.
        </p>
        <div className='media-permission-actions'>
          <button ref={allowButtonRef} type='button' onClick={allow}>Allow access</button>
          <button type='button' onClick={close}>Don&apos;t allow</button>
        </div>
      </section>
    </div>
  )
}
