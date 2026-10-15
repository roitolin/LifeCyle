import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { logWebAdminActivity } from '@/utils/adminActivity'
import './AdminOperations.css'

type AnnouncementStatus = 'active' | 'archived'
type AnnouncementFilter = AnnouncementStatus | 'expired'
type AnnouncementAudience = 'all' | 'users' | 'funeral_shops'
type AnnouncementDuration = '1d' | '3d' | '7d' | '14d' | '30d' | 'none'

type Announcement = {
  id: string
  title: string
  body: string
  audience: AnnouncementAudience
  status: AnnouncementStatus
  isPinned: boolean
  recipientCount: number
  createdBy: string
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

const audienceMeta: Record<AnnouncementAudience, { label: string; description: string }> = {
  all: { label: 'Everyone', description: 'Families and funeral-shop accounts' },
  users: { label: 'Families', description: 'Standard user accounts only' },
  funeral_shops: { label: 'Funeral shops', description: 'Funeral-admin accounts only' },
}

const durationOptions: Array<{ value: AnnouncementDuration; label: string }> = [
  { value: '1d', label: '1 day' },
  { value: '3d', label: '3 days' },
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: 'none', label: 'Until archived' },
]

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString('en-PH', { hour12: true })
}

function expirationFor(duration: AnnouncementDuration): string | null {
  if (duration === 'none') return null
  const days = Number(duration.replace('d', ''))
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

function hasExpired(announcement: Announcement): boolean {
  if (!announcement.expiresAt) return false
  const timestamp = new Date(announcement.expiresAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function expirationLabel(announcement: Announcement): string {
  if (!announcement.expiresAt) return 'Active until archived'
  if (hasExpired(announcement)) return `Expired ${formatDate(announcement.expiresAt)}`
  return `Expires ${formatDate(announcement.expiresAt)}`
}

export default function AdminAnnouncementsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [updatingId, setUpdatingId] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<AnnouncementFilter>('active')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<AnnouncementAudience>('all')
  const [duration, setDuration] = useState<AnnouncementDuration>('7d')
  const [isPinned, setIsPinned] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await supabase.from('announcements').select('*').order('isPinned', { ascending: false }).order('createdAt', { ascending: false })
      if (loadError) throw loadError
      setAnnouncements((data || []) as Announcement[])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load announcements.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase.channel(`web-admin-announcements-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => void load()).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [load])

  const visible = useMemo(() => announcements.filter((announcement) => {
    const expired = hasExpired(announcement)
    if (filter === 'expired') return announcement.status === 'active' && expired
    if (filter === 'active') return announcement.status === 'active' && !expired
    return announcement.status === 'archived'
  }), [announcements, filter])

  const counts = useMemo(() => ({
    active: announcements.filter((item) => item.status === 'active' && !hasExpired(item)).length,
    expired: announcements.filter((item) => item.status === 'active' && hasExpired(item)).length,
    archived: announcements.filter((item) => item.status === 'archived').length,
  }), [announcements])

  const publish = async (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanBody = body.trim()
    if (!cleanTitle || !cleanBody) {
      openAlert({ title: 'Message Required', message: 'Enter both an announcement title and message.', tone: 'warning' })
      return
    }
    if (cleanTitle.length > 120 || cleanBody.length > 2000) {
      openAlert({ title: 'Announcement Too Long', message: 'Use at most 120 title characters and 2,000 message characters.', tone: 'warning' })
      return
    }

    setPublishing(true)
    setError('')
    try {
      const expiresAt = expirationFor(duration)
      const { data, error: publishError } = await supabase.rpc('publish_announcement', {
        p_title: cleanTitle,
        p_body: cleanBody,
        p_audience: audience,
        p_is_pinned: isPinned,
        p_expires_at: expiresAt,
      })
      if (publishError) throw publishError
      const result = data as { recipientCount?: number } | null
      const durationLabel = durationOptions.find((item) => item.value === duration)?.label.toLowerCase()
      setTitle('')
      setBody('')
      setAudience('all')
      setDuration('7d')
      setIsPinned(false)
      await load()
      openAlert({ title: 'Announcement Published', message: `Published for ${durationLabel} and queued ${Number(result?.recipientCount || 0).toLocaleString()} notification${result?.recipientCount === 1 ? '' : 's'}.`, tone: 'info', okLabel: 'Done' })
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'The announcement could not be published.')
    } finally { setPublishing(false) }
  }

  const updateAnnouncement = async (announcement: Announcement, changes: Partial<Pick<Announcement, 'status' | 'isPinned' | 'expiresAt'>>) => {
    if (updatingId) return
    setUpdatingId(announcement.id)
    setError('')
    try {
      const { data, error: updateError } = await supabase.from('announcements').update({ ...changes, updatedAt: new Date().toISOString() }).eq('id', announcement.id).eq('updatedAt', announcement.updatedAt).select('*').maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('Another administrator already changed this announcement. Refresh and try again.')
      setAnnouncements((current) => current.map((item) => item.id === announcement.id ? data as Announcement : item))
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update the announcement.')
    } finally { setUpdatingId('') }
  }

  const changeStatus = (announcement: Announcement) => {
    const nextStatus: AnnouncementStatus = announcement.status === 'active' ? 'archived' : 'active'
    const reactivatingExpired = nextStatus === 'active' && hasExpired(announcement)
    openConfirm({
      title: nextStatus === 'archived' ? 'Archive this announcement?' : 'Reactivate this announcement?',
      message: nextStatus === 'archived' ? 'It will be removed from active announcement feeds, but its delivery record will remain available.' : reactivatingExpired ? 'It will become visible again and remain active until you archive it.' : 'It will become visible again in active announcement feeds.',
      confirmLabel: nextStatus === 'archived' ? 'Archive' : 'Reactivate',
      tone: nextStatus === 'archived' ? 'warning' : 'success',
      onConfirm: () => updateAnnouncement(announcement, { status: nextStatus, ...(reactivatingExpired ? { expiresAt: null } : {}) }),
    })
  }

  const deleteAnnouncement = (announcement: Announcement) => {
    openConfirm({
      title: 'Delete this announcement permanently?',
      message: `Delete "${announcement.title}"? This cannot be undone.`,
      details: ['It will disappear from every announcement feed immediately.', 'Notifications already delivered to recipients will remain in their notification history.'],
      confirmLabel: 'Delete announcement',
      tone: 'danger',
      onConfirm: async () => {
        if (updatingId) return
        setUpdatingId(announcement.id)
        setError('')
        try {
          const { data, error: deleteError } = await supabase.from('announcements').delete().eq('id', announcement.id).eq('updatedAt', announcement.updatedAt).select('id').maybeSingle()
          if (deleteError) throw deleteError
          if (!data) throw new Error('Another administrator already changed this announcement. Refresh and try again.')
          setAnnouncements((current) => current.filter((item) => item.id !== announcement.id))
          void logWebAdminActivity({ action: 'announcement_deleted', targetType: 'announcement', targetId: announcement.id, summary: `Deleted announcement "${announcement.title}".`, metadata: { audience: announcement.audience, createdAt: announcement.createdAt } })
          openAlert({ title: 'Announcement Deleted', message: 'The announcement was permanently removed.', tone: 'info', okLabel: 'Done' })
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete the announcement.')
        } finally { setUpdatingId('') }
      },
    })
  }

  return (
    <section className="panel operations-page announcements-page">
      <header className="operations-page-header"><div><h2>Announcements</h2><p className="panel-sub">Publish time-limited updates and manage broadcast history.</p></div></header>
      <div className="announcements-layout">
        <form className="announcement-composer" onSubmit={publish}>
          <div className="operations-section-heading"><h3>New announcement</h3></div>
          <label className="operations-field"><span>Title <small>{title.length}/120</small></span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Example: Holiday service schedule" /></label>
          <label className="operations-field"><span>Message <small>{body.length}/2000</small></span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={7} placeholder="Write the update recipients should receive..." /></label>
          <label className="operations-field"><span>Audience</span><select value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}>{(Object.keys(audienceMeta) as AnnouncementAudience[]).map((option) => <option value={option} key={option}>{audienceMeta[option].label} - {audienceMeta[option].description}</option>)}</select></label>
          <label className="operations-field"><span>Display duration</span><select value={duration} onChange={(event) => setDuration(event.target.value as AnnouncementDuration)}>{durationOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small className="operations-field-help">The announcement disappears automatically when this period ends.</small></label>
          <label className="operations-check-row"><input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} /><span><strong>Pin above other active announcements</strong></span></label>
          <button className="operations-primary-btn announcement-publish-btn" type="submit" disabled={publishing}>{publishing ? 'Publishing...' : 'Publish announcement'}</button>
        </form>

        <div className="announcement-history">
          <div className="operations-section-heading announcement-history-head"><div><h3>Published announcements</h3><p>{announcements.length} announcement{announcements.length === 1 ? '' : 's'} on record</p></div><div className="operations-filter-tabs compact" role="tablist" aria-label="Announcement status"><button type="button" className={filter === 'active' ? 'is-active' : ''} onClick={() => setFilter('active')}>Active <span>{counts.active}</span></button><button type="button" className={filter === 'expired' ? 'is-active' : ''} onClick={() => setFilter('expired')}>Expired <span>{counts.expired}</span></button><button type="button" className={filter === 'archived' ? 'is-active' : ''} onClick={() => setFilter('archived')}>Archived <span>{counts.archived}</span></button></div></div>
          {error ? <p className="auth-message auth-message-error">{error}</p> : null}
          {loading ? <div className="operations-state">Loading announcements...</div> : null}
          {!loading && visible.length === 0 ? <div className="operations-empty small"><h3>No {filter} announcements</h3></div> : null}
          <div className="announcement-list">
            {visible.map((announcement) => <article className="announcement-card" key={announcement.id}>
              <div className="announcement-card-head"><div className="announcement-badges"><span>{audienceMeta[announcement.audience]?.label || 'Everyone'}</span>{announcement.isPinned ? <span className="is-pinned">Pinned</span> : null}{hasExpired(announcement) ? <span className="is-expired">Expired</span> : null}</div><time>{formatDate(announcement.createdAt)}</time></div>
              <h3>{announcement.title}</h3><p>{announcement.body}</p><div className={`announcement-expiry${hasExpired(announcement) ? ' is-expired' : ''}`}>{expirationLabel(announcement)}</div>
              <footer><span>{Number(announcement.recipientCount || 0).toLocaleString()} recipients</span><div>{announcement.status === 'active' && !hasExpired(announcement) ? <button type="button" onClick={() => void updateAnnouncement(announcement, { isPinned: !announcement.isPinned })} disabled={updatingId === announcement.id}>{announcement.isPinned ? 'Unpin' : 'Pin'}</button> : null}<button type="button" onClick={() => changeStatus(announcement)} disabled={updatingId === announcement.id}>{announcement.status === 'active' ? 'Archive' : 'Reactivate'}</button><button type="button" className="is-danger" onClick={() => deleteAnnouncement(announcement)} disabled={updatingId === announcement.id}>Delete</button></div></footer>
            </article>)}
          </div>
        </div>
      </div>
      {alertDialog}{confirmDialog}
    </section>
  )
}
