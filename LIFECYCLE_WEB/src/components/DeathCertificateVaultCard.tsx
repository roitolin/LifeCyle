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
    <section className="box-border rounded-[14px] border border-[#dbe4df] bg-white p-5 [--dc-brand:#315f50] [--dc-ink:#22312d] [--dc-muted:#68756f] [&_*]:box-border" aria-label="Document checklist and secure vault">
      <header className="mb-4 grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
        <div className="grid size-[42px] place-items-center rounded-xl bg-[#eaf1ed] font-black text-[var(--dc-brand)]" aria-hidden="true">▣</div>
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--dc-muted)]">Documents</span>
          <h2 className="my-0.5 text-[17px] font-bold text-[var(--dc-ink)]">Checklist & secure vault</h2>
          <p className="m-0 text-xs leading-[1.5] text-[var(--dc-muted)]">LifeCycle currently supports the Death Certificate only.</p>
        </div>
        <strong className="text-xs text-[var(--dc-brand)] max-[640px]:col-start-2 max-[640px]:justify-self-start">{ready ? '1 of 1 ready' : '0 of 1 ready'}</strong>
      </header>

      {loading ? <div className="py-6 text-center text-[var(--dc-muted)]">Loading document checklist…</div> : (
        <>
          <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-3.5 max-[640px]:grid-cols-[auto_minmax(0,1fr)] ${ready ? 'border-[#bfd3c9] bg-[#eef4f1]' : 'border-[#e0e6e2] bg-[#fafcfb]'}`}>
            <span className="grid size-[34px] place-items-center rounded-[10px] bg-[#eaf1ed] font-black text-[var(--dc-brand)]" aria-hidden="true">{ready ? '✓' : '1'}</span>
            <div>
              <strong className="text-[13px] text-[var(--dc-ink)]">Death Certificate</strong>
              <p className="m-0 text-xs leading-[1.5] text-[var(--dc-muted)]">{status?.[1] || (role === 'customer' ? 'Request the certificate from your funeral shop.' : 'Waiting for the customer to request this document.')}</p>
            </div>
            <span className="rounded-full bg-[#e7eeea] px-[9px] py-[5px] text-[10px] font-extrabold text-[var(--dc-brand)] max-[640px]:col-start-2 max-[640px]:justify-self-start">{status?.[0] || 'Not requested'}</span>
          </div>

          {ready && document ? (
            <div className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[#cfddd6] p-3.5 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
              <span className="grid size-[34px] place-items-center rounded-[10px] bg-[#eaf1ed] font-black text-[var(--dc-brand)]" aria-hidden="true">🔒</span>
              <div>
                <strong className="text-[13px] text-[var(--dc-ink)]">{document.original_file_name || 'Death Certificate'}</strong>
                <p className="m-0 text-xs leading-[1.5] text-[var(--dc-muted)]">Private · customer and assigned shop only</p>
              </div>
              <button type="button" className="min-h-[38px] cursor-pointer rounded-[9px] border border-[#c8d5cf] bg-white px-[13px] font-[inherit] text-xs font-extrabold text-[var(--dc-brand)] disabled:cursor-wait disabled:opacity-60 max-[640px]:col-start-2 max-[640px]:justify-self-start" disabled={busy} onClick={() => void openDocument()}>Open securely</button>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-[9px] [&_button]:min-h-[38px] [&_button]:cursor-pointer [&_button]:rounded-[9px] [&_button]:px-[13px] [&_button]:font-[inherit] [&_button]:text-xs [&_button]:font-extrabold [&_button:disabled]:cursor-wait [&_button:disabled]:opacity-60">
            {role === 'customer' && !document ? (
              <button type="button" className="border border-[var(--dc-brand)] bg-[var(--dc-brand)] text-white" disabled={busy} onClick={() => void run(
                () => requestDeathCertificate(serviceRequestId),
                'Your request was sent to the funeral shop.',
              )}>Request Death Certificate</button>
            ) : null}

            {role === 'shop' && document?.status === 'requested' ? (
              <button type="button" className="border border-[#c8d5cf] bg-white text-[var(--dc-brand)]" disabled={busy} onClick={() => void run(
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
                <button type="button" className="border border-[var(--dc-brand)] bg-[var(--dc-brand)] text-white" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                  {ready ? 'Replace vault file' : 'Upload to secure vault'}
                </button>
              </>
            ) : null}
          </div>

          <footer className="mt-[13px] flex items-center gap-[7px] text-[11px] text-[var(--dc-muted)]"><span className="font-black text-[var(--dc-brand)]" aria-hidden="true">✓</span>Private links expire after 60 seconds.</footer>
        </>
      )}
      {alertDialog}
    </section>
  )
}
