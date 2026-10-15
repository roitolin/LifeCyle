import { useCallback, useEffect, useRef, useState } from 'react'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import {
  deathCertificateAccessUrl,
  loadDeathCertificate,
  requestDeathCertificate,
  startDeathCertificate,
  uploadDeathCertificate,
  type DeathCertificateDocument,
} from '@/utils/deathCertificateVault'
import './DeathCertificateVaultCard.css'

type Props = { serviceRequestId: string; role: 'customer' | 'shop' }

const STATUS_COPY = {
  requested: ['Requested', 'The funeral shop received the document request.'],
  processing: ['Processing', 'The funeral shop is preparing the Death Certificate.'],
  ready: ['Ready in vault', 'The private Death Certificate file is ready.'],
} as const

export default function DeathCertificateVaultCard({ serviceRequestId, role }: Props) {
  const { openAlert, alertDialog } = useAlertDialog()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [document, setDocument] = useState<DeathCertificateDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDocument(await loadDeathCertificate(serviceRequestId))
    } catch (error: any) {
      openAlert({ title: 'Documents Unavailable', message: error?.message || 'The checklist could not be loaded.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setLoading(false)
    }
  }, [openAlert, serviceRequestId])

  useEffect(() => { void load() }, [load])

  const run = async (action: () => Promise<DeathCertificateDocument>, success: string) => {
    if (busy) return
    setBusy(true)
    try {
      setDocument(await action())
      openAlert({ title: 'Death Certificate', message: success, tone: 'info', okLabel: 'Done' })
    } catch (error: any) {
      openAlert({ title: 'Action Failed', message: error?.message || 'The request could not be updated.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setBusy(false)
    }
  }

  const handleFile = async (file: File | null) => {
    if (!file || !document) return
    await run(() => uploadDeathCertificate(document.id, file), 'The Death Certificate is now in the customer’s private vault.')
  }

  const openDocument = async () => {
    if (!document) return
    setBusy(true)
    try {
      const anchor = globalThis.document.createElement('a')
      anchor.href = await deathCertificateAccessUrl(document)
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      anchor.click()
    } catch (error: any) {
      openAlert({ title: 'File Unavailable', message: error?.message || 'A secure file link could not be created.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      setBusy(false)
    }
  }

  const status = document ? STATUS_COPY[document.status] : null
  const ready = document?.status === 'ready'

  return (
    <section className="dc-vault" aria-label="Document checklist and secure vault">
      <header className="dc-vault-head">
        <div className="dc-vault-head-icon" aria-hidden="true">▣</div>
        <div>
          <span>Documents</span>
          <h2>Checklist & secure vault</h2>
          <p>LifeCycle currently supports the Death Certificate only.</p>
        </div>
        <strong>{ready ? '1 of 1 ready' : '0 of 1 ready'}</strong>
      </header>

      {loading ? <div className="dc-vault-loading">Loading document checklist…</div> : (
        <>
          <div className={'dc-check-item' + (ready ? ' is-ready' : '')}>
            <span className="dc-check-mark" aria-hidden="true">{ready ? '✓' : '1'}</span>
            <div>
              <strong>Death Certificate</strong>
              <p>{status?.[1] || (role === 'customer' ? 'Request the certificate from your funeral shop.' : 'Waiting for the customer to request this document.')}</p>
            </div>
            <span className="dc-status">{status?.[0] || 'Not requested'}</span>
          </div>

          {ready && document ? (
            <div className="dc-private-file">
              <span className="dc-lock" aria-hidden="true">🔒</span>
              <div>
                <strong>{document.original_file_name || 'Death Certificate'}</strong>
                <p>Private · customer and assigned shop only</p>
              </div>
              <button type="button" disabled={busy} onClick={() => void openDocument()}>Open securely</button>
            </div>
          ) : null}

          <div className="dc-actions">
            {role === 'customer' && !document ? (
              <button type="button" className="dc-primary" disabled={busy} onClick={() => void run(
                () => requestDeathCertificate(serviceRequestId),
                'Your request was sent to the funeral shop.',
              )}>Request Death Certificate</button>
            ) : null}

            {role === 'shop' && document?.status === 'requested' ? (
              <button type="button" className="dc-secondary" disabled={busy} onClick={() => void run(
                () => startDeathCertificate(document.id),
                'The document is now marked as processing.',
              )}>Mark as processing</button>
            ) : null}

            {role === 'shop' && document ? (
              <>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(event) => {
                  void handleFile(event.target.files?.[0] || null)
                  event.target.value = ''
                }} />
                <button type="button" className="dc-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  {ready ? 'Replace vault file' : 'Upload to secure vault'}
                </button>
              </>
            ) : null}
          </div>

          <footer className="dc-security-note"><span aria-hidden="true">✓</span>Private links expire after 60 seconds.</footer>
        </>
      )}
      {alertDialog}
    </section>
  )
}
