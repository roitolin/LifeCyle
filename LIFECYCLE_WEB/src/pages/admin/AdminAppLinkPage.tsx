import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import {
  fetchAdminAppDownloadSettings,
  normalizeAppDownloadUrl,
  saveAdminAppDownloadSettings,
  validateAppDownloadUrlInput,
} from '@/utils/appDownloadLink'
import './AdminAppLinkPage.css'

export default function AdminAppLinkPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const [downloadUrl, setDownloadUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [savedUrl, setSavedUrl] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminAppDownloadSettings()
      setTableMissing(result.tableMissing)
      setSavedUrl(result.settings.downloadUrl)
      setDownloadUrl(result.settings.downloadUrl)
      setIsActive(result.settings.downloadUrl ? result.settings.isActive : true)
      setUpdatedAt(result.settings.updatedAt)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load app download link settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`web-admin-app-download-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_download_settings' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  const draftValidUrl = normalizeAppDownloadUrl(downloadUrl)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (saving || loading || tableMissing) return

    const validation = validateAppDownloadUrlInput(downloadUrl)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    if (!validation.url) {
      setError('Enter a download URL before saving.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const updated = await saveAdminAppDownloadSettings({
        downloadUrl: validation.url,
        isActive,
      })
      setSavedUrl(updated.downloadUrl)
      setDownloadUrl(updated.downloadUrl)
      setIsActive(updated.isActive)
      setUpdatedAt(updated.updatedAt)
      openAlert({
        title: 'Link Saved',
        message: 'Download link settings have been updated.',
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save link.')
    } finally {
      setSaving(false)
    }
  }

  const confirmRemove = () => {
    if (!savedUrl || saving || tableMissing) return
    openConfirm({
      title: 'Remove download link?',
      message: 'This will clear the saved download URL from the welcome page.',
      confirmLabel: 'Remove',
      tone: 'warning',
      onConfirm: async () => {
        setSaving(true)
        setError('')
        try {
          const updated = await saveAdminAppDownloadSettings({
            downloadUrl: null,
            isActive: false,
          })
          setSavedUrl('')
          setDownloadUrl('')
          setIsActive(true)
          setUpdatedAt(updated.updatedAt)
          openAlert({
            title: 'Link Removed',
            message: 'The download link has been cleared.',
            tone: 'info',
            okLabel: 'Done',
          })
        } catch (removeError) {
          setError(removeError instanceof Error ? removeError.message : 'Unable to remove link.')
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return (
    <section className="panel app-link-page">
      <header className="app-link-header">
        <h2>Install App Link</h2>
        <p className="panel-sub">
          Set the download URL for the Install Our App button on the welcome page.
        </p>
      </header>

      {tableMissing ? (
        <div className="app-link-migration-notice" role="status">
          <strong>Database migration needed</strong>
          <p>
            Apply <code>supabase/migrations/20261108110500_app_download_settings.sql</code> before saving.
          </p>
        </div>
      ) : null}

      <div className="app-link-card">
        <form onSubmit={save}>
          <div className="app-link-body">
            <div className="app-link-field">
              <label htmlFor="app-download-url">Download URL</label>
              <input
                id="app-download-url"
                type="url"
                value={downloadUrl}
                onChange={(event) => {
                  setDownloadUrl(event.target.value)
                  if (error) setError('')
                }}
                placeholder="https://..."
                maxLength={2048}
                disabled={loading || tableMissing}
                autoComplete="url"
              />
            </div>

            <label className="app-link-checkbox">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={loading || saving || tableMissing}
              />
              <span>Enable link on welcome page</span>
            </label>

            {error ? <p className="auth-message auth-message-error">{error}</p> : null}

            {updatedAt ? (
              <p className="app-link-updated">
                Last updated: {new Date(updatedAt).toLocaleString('en-PH', { hour12: true })}
              </p>
            ) : null}
          </div>

          <div className="app-link-footer">
            <div className="app-link-secondary-actions">
              {draftValidUrl ? (
                <a
                  href={draftValidUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ghost-btn app-link-btn"
                >
                  Open link
                </a>
              ) : null}

              {savedUrl ? (
                <button
                  type="button"
                  className="ghost-btn app-link-btn app-link-remove-btn"
                  onClick={confirmRemove}
                  disabled={loading || saving || tableMissing}
                >
                  Remove
                </button>
              ) : null}
            </div>

            <button
              type="submit"
              className="solid-btn app-link-btn"
              disabled={loading || saving || tableMissing}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {alertDialog}
      {confirmDialog}
    </section>
  )
}
