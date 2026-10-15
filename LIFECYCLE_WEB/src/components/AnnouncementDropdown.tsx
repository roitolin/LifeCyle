import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import './AnnouncementDropdown.css'

type AnnouncementAudience = 'all' | 'users' | 'funeral_shops'
type Announcement = {
  id: string
  title: string
  body: string
  audience: AnnouncementAudience
  isPinned: boolean
  createdAt: string
  expiresAt: string | null
}

function getTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const elapsed = Date.now() - date.getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return minutes + 'm ago'
  if (hours < 24) return hours + 'h ago'
  if (days < 7) return days + 'd ago'
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function MegaphoneIcon() {
  return (
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <path d='m3 11 18-5v12L3 14v-3Z' />
      <path d='m6 14 1 6h4l-1-5' />
    </svg>
  )
}

type AnnouncementPanelProps = {
  announcements: Announcement[]
  loading: boolean
  loadFailed: boolean
  onRetry: () => Promise<void>
}

function AnnouncementPanel({ announcements, loading, loadFailed, onRetry }: AnnouncementPanelProps) {
  return (
    <div className='web-announcement-panel' role='dialog' aria-label='Announcements' aria-modal='false'>
      <div className='web-announcement-heading'>
        <div className='web-announcement-heading-icon'><MegaphoneIcon /></div>
        <div>
          <strong>Announcements</strong>
          <span>Important updates from LifeCycle</span>
        </div>
      </div>
      <div className='web-announcement-list'>
        {loading && announcements.length === 0 ? (
          <div className='web-announcement-state'>Loading announcements...</div>
        ) : loadFailed ? (
          <div className='web-announcement-state'>
            <strong>Announcements unavailable</strong>
            <span>Please try again in a moment.</span>
            <button type='button' onClick={() => void onRetry()}>Try again</button>
          </div>
        ) : announcements.length === 0 ? (
          <div className='web-announcement-state'>
            <strong>No announcements</strong>
            <span>New updates will appear here.</span>
          </div>
        ) : announcements.map((announcement) => (
          <article className={'web-announcement-item' + (announcement.isPinned ? ' is-pinned' : '')} key={announcement.id}>
            <div className='web-announcement-meta'>
              <span>{announcement.isPinned ? 'PINNED' : 'UPDATE'}</span>
              <time dateTime={announcement.createdAt}>{getTimeLabel(announcement.createdAt)}</time>
            </div>
            <h3>{announcement.title}</h3>
            <p>{announcement.body}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

export default function AnnouncementDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [audience, setAudience] = useState<AnnouncementAudience>('users')
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let active = true
    const applySession = async (id: string | null) => {
      if (!active) return
      setUserId(null)
      if (!id) {
        setAudience('users')
        setAnnouncements([])
        setIsOpen(false)
        return
      }
      const { data } = await supabase.from('users').select('role').eq('id', id).maybeSingle()
      if (active) {
        setAudience(data?.role === 'funeral_admin' ? 'funeral_shops' : 'users')
        setUserId(id)
      }
    }
    void supabase.auth.getSession().then(({ data }) => applySession(data.session?.user?.id ?? null))
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user?.id ?? null)
    })
    return () => {
      active = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const loadAnnouncements = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setLoadFailed(false)
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, body, audience, isPinned, createdAt, expiresAt')
      .eq('status', 'active')
      .in('audience', ['all', audience])
      .or(`expiresAt.is.null,expiresAt.gt.${new Date().toISOString()}`)
      .order('isPinned', { ascending: false })
      .order('createdAt', { ascending: false })
      .limit(8)
    if (error) setLoadFailed(true)
    else setAnnouncements((data || []) as Announcement[])
    setLoading(false)
  }, [audience, userId])

  useEffect(() => {
    if (!userId) return
    const loadFrame = window.requestAnimationFrame(() => {
      void loadAnnouncements()
    })
    const channel = supabase
      .channel('web-header-announcements-' + userId + '-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        void loadAnnouncements()
      })
      .subscribe()
    return () => {
      window.cancelAnimationFrame(loadFrame)
      void supabase.removeChannel(channel)
    }
  }, [loadAnnouncements, userId])

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const toggleDropdown = () => {
    if (!userId) {
      navigate('/login?next=' + encodeURIComponent(location.pathname + location.search))
      return
    }
    setIsOpen((current) => !current)
  }

  return (
    <div className='web-announcement' ref={dropdownRef}>
      <button
        type='button'
        className={'web-announcement-trigger' + (isOpen ? ' is-active' : '')}
        onClick={toggleDropdown}
        aria-haspopup='dialog'
        aria-expanded={isOpen}
        title='Announcements'
      >
        <MegaphoneIcon />
        <span>Announcements</span>
        {announcements.some((item) => item.isPinned) ? <i aria-label='Pinned announcement available' /> : null}
      </button>
      {isOpen ? (
        <AnnouncementPanel
          announcements={announcements}
          loading={loading}
          loadFailed={loadFailed}
          onRetry={loadAnnouncements}
        />
      ) : null}
    </div>
  )
}
