import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import './AdminOperations.css'

type AnnouncementStatus = 'active' | 'archived'
type AnnouncementAudience = 'all' | 'users' | 'funeral_shops'

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
}

const audienceMeta: Record<AnnouncementAudience, { label: string; description: string }> = {
  all: { label: 'Everyone', description: 'Families and funeral-shop accounts' },
  users: { label: 'Families', description: 'Standard user accounts only' },
  funeral_shops: { label: 'Funeral shops', description: 'Funeral-admin accounts only' },
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString('en-PH', { hour12: true })
}

export default function AdminAnnouncementsPage() {
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [updatingId, setUpdatingId] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<AnnouncementStatus>('active')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<AnnouncementAudience>('all')
  const [isPinned, setIsPinned] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: loadError } = await supabase
        .from('announcements')
        .select('*')
        .order('isPinned', { ascending: false })
        .order('createdAt', { ascending: false })
      if (loadError) throw loadError
      setAnnouncements((data || []) as Announcement[])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load announcements.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const channel = supabase
      .channel(`web-admin-announcements-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => void load())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  const visible = useMemo(
    () => announcements.filter((announcement) => announcement.status === filter),
    [announcements, filter],
  )

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
      const { data, error: publishError } = await supabase.rpc('publish_announcement', {
        p_title: cleanTitle,
        p_body: cleanBody,
        p_audience: audience,
        p_is_pinned: isPinned,
      })
      if (publishError) throw publishError
      const result = data as { recipientCount?: number } | null
      setTitle('')
      setBody('')
      setAudience('all')
      setIsPinned(false)
      await load()
      openAlert({
        title: 'Announcement Published',
        message: `The announcement was published and ${Number(result?.recipientCount || 0).toLocaleString()} notification${result?.recipientCount === 1 ? '' : 's'} were queued.`,
        tone: 'info',
        okLabel: 'Done',
      })
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'The announcement could not be published.')
    } finally {
      setPublishing(false)
    }
  }

  const updateAnnouncement = async (announcement: Announcement, changes: Partial<Pick<Announcement, 'status' | 'isPinned'>>) => {
    if (updatingId) return
    setUpdatingId(announcement.id)
    setError('')
    try {
      const { data, error: updateError } = await supabase
        .from('announcements')
        .update({ ...changes, updatedAt: new Date().toISOString() })
        .eq('id', announcement.id)
        .eq('updatedAt', announcement.updatedAt)
        .select('*')
        .maybeSingle()
      if (updateError) throw updateError
      if (!data) throw new Error('Another administrator already changed this announcement. Refresh and try again.')
      setAnnouncements((current) => current.map((item) => item.id === announcement.id ? data as Announcement : item))
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update the announcement.')
    } finally {
      setUpdatingId('')
    }
  }

  const changeStatus = (announcement: Announcement) => {
    const nextStatus: AnnouncementStatus = announcement.status === 'active' ? 'archived' : 'active'
    openConfirm({
      title: nextStatus === 'archived' ? 'Archive this announcement?' : 'Reactivate this announcement?',
      message: nextStatus === 'archived'
        ? 'It will be removed from active announcement feeds, but its delivery record will remain available.'
        : 'It will become visible again in active announcement feeds.',
      confirmLabel: nextStatus === 'archived' ? 'Archive' : 'Reactivate',
      tone: nextStatus === 'archived' ? 'warning' : 'success',
      onConfirm: () => updateAnnouncement(announcement, { status: nextStatus }),
    })
  }

  return (
    <section className="panel operations-page announcements-page">
      <header className="operations-page-header">
        <div>
          <h2>Announcements</h2>
          <p className="panel-sub">Publish updates and review broadcast history.</p>
        </div>
      </header>

      <div className="announcements-layout">
        <form className="announcement-composer" onSubmit={publish}>
          <div className="operations-section-heading">
            <h3>New announcement</h3>
          </div>

          <label className="operations-field">
            <span>Title <small>{title.length}/120</small></span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Example: Holiday service schedule" />
          </label>
          <label className="operations-field">
            <span>Message <small>{body.length}/2000</small></span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={7} placeholder="Write the update recipients should receive..." />
          </label>

          <label className="operations-field">
            <span>Audience</span>
            <select value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementAudience)}>
              {(Object.keys(audienceMeta) as AnnouncementAudience[]).map((option) => (
                <option value={option} key={option}>
                  {audienceMeta[option].label} — {audienceMeta[option].description}
                </option>
              ))}
            </select>
          </label>

          <label className="operations-check-row">
            <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
            <span><strong>Pin above other active announcements</strong></span>
          </label>

          <button className="operations-primary-btn announcement-publish-btn" type="submit" disabled={publishing}>
            {publishing ? 'Publishing...' : 'Publish announcement'}
          </button>
        </form>

        <div className="announcement-history">
          <div className="operations-section-heading announcement-history-head">
            <div>
              <h3>Published announcements</h3>
              <p>{announcements.length} announcement{announcements.length === 1 ? '' : 's'} on record</p>
            </div>
            <div className="operations-filter-tabs compact" role="tablist" aria-label="Announcement status">
              <button type="button" className={filter === 'active' ? 'is-active' : ''} onClick={() => setFilter('active')}>Active</button>
              <button type="button" className={filter === 'archived' ? 'is-active' : ''} onClick={() => setFilter('archived')}>Archived</button>
            </div>
          </div>

          {error ? <p className="auth-message auth-message-error">{error}</p> : null}
          {loading ? <div className="operations-state">Loading announcements...</div> : null}
          {!loading && visible.length === 0 ? <div className="operations-empty small"><h3>No {filter} announcements</h3></div> : null}
          <div className="announcement-list">
            {visible.map((announcement) => (
              <article className="announcement-card" key={announcement.id}>
                <div className="announcement-card-head">
                  <div className="announcement-badges">
                    <span>{audienceMeta[announcement.audience]?.label || 'Everyone'}</span>
                    {announcement.isPinned ? <span className="is-pinned">Pinned</span> : null}
                  </div>
                  <time>{formatDate(announcement.createdAt)}</time>
                </div>
                <h3>{announcement.title}</h3>
                <p>{announcement.body}</p>
                <footer>
                  <span>{Number(announcement.recipientCount || 0).toLocaleString()} recipients</span>
                  <div>
                    {announcement.status === 'active' ? (
                      <button type="button" onClick={() => void updateAnnouncement(announcement, { isPinned: !announcement.isPinned })} disabled={updatingId === announcement.id}>
                        {announcement.isPinned ? 'Unpin' : 'Pin'}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => changeStatus(announcement)} disabled={updatingId === announcement.id}>
                      {announcement.status === 'active' ? 'Archive' : 'Reactivate'}
                    </button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </div>
      </div>
      {alertDialog}
      {confirmDialog}
    </section>
  )
}
