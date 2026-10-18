import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

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
    <svg className='size-[18px] shrink-0 fill-none stroke-current stroke-[1.9] [stroke-linecap:round] [stroke-linejoin:round]' viewBox='0 0 24 24' aria-hidden='true'>
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

type AnnouncementDropdownProps = {
  menuItem?: boolean
}

function AnnouncementPanel({ announcements, loading, loadFailed, onRetry }: AnnouncementPanelProps) {
  return (
    <div className='absolute right-0 top-[calc(100%+8px)] z-[1100] w-[min(390px,calc(100vw-24px))] origin-top-right animate-announcement-in overflow-hidden rounded-xl border border-[#dbe1e8] bg-white text-left text-[#25364c] shadow-[0_16px_38px_rgba(15,23,42,0.18)] motion-reduce:animate-none max-[720px]:fixed max-[720px]:inset-x-2 max-[720px]:top-[52px] max-[720px]:max-h-[calc(100vh-60px)] max-[720px]:w-auto' role='dialog' aria-label='Announcements' aria-modal='false'>
      <div className='!flex !items-center gap-[11px] border-b border-[#e6e8e5] bg-[#fbfaf7] !px-4 !py-3.5'>
        <div className='inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-[#f8f0df] text-[#7b5c31]'><MegaphoneIcon /></div>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <strong className='text-sm font-extrabold text-[#263731]'>Announcements</strong>
          <span className='text-[11px] text-[#77827e]'>Important updates from LifeCycle</span>
        </div>
      </div>
      <div className='max-h-[390px] overflow-y-auto overscroll-contain max-[720px]:max-h-[calc(100vh-130px)]'>
        {loading && announcements.length === 0 ? (
          <div className='!flex min-h-[148px] flex-col items-center justify-center gap-[5px] !px-5 !py-7 text-center text-xs text-[#7a8580]'>Loading announcements...</div>
        ) : loadFailed ? (
          <div className='!flex min-h-[148px] flex-col items-center justify-center gap-[5px] !px-5 !py-7 text-center text-xs text-[#7a8580]'>
            <strong className='text-[13px] text-[#35453f]'>Announcements unavailable</strong>
            <span>Please try again in a moment.</span>
            <button className='mt-[7px] cursor-pointer rounded-[7px] border-0 bg-[#2f4057] px-3 py-[7px] font-[inherit] font-bold text-white' type='button' onClick={() => void onRetry()}>Try again</button>
          </div>
        ) : announcements.length === 0 ? (
          <div className='!flex min-h-[148px] flex-col items-center justify-center gap-[5px] !px-5 !py-7 text-center text-xs text-[#7a8580]'>
            <strong className='text-[13px] text-[#35453f]'>No announcements</strong>
            <span>New updates will appear here.</span>
          </div>
        ) : announcements.map((announcement) => (
          <article className={`border-b border-[#e9edf2] bg-white !px-4 !py-3.5 last:border-b-0 ${announcement.isPinned ? '!pl-[13px] border-l-[3px] border-l-[#c8963f] bg-[#fffcf5]' : ''}`} key={announcement.id}>
            <div className='mb-[5px] flex items-center justify-between gap-3'>
              <span className='text-[9px] font-extrabold tracking-[0.08em] text-[#7b5c31]'>{announcement.isPinned ? 'PINNED' : 'UPDATE'}</span>
              <time className='whitespace-nowrap text-[10px] font-semibold text-[#8b96a6]' dateTime={announcement.createdAt}>{getTimeLabel(announcement.createdAt)}</time>
            </div>
            <h3 className='!m-0 text-[13px] font-extrabold leading-[1.4] text-[#172033]'>{announcement.title}</h3>
            <p className='!mt-1 !mb-0 line-clamp-4 overflow-hidden whitespace-pre-line text-xs leading-[1.55] text-[#5d6b7d]'>{announcement.body}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

export default function AnnouncementDropdown({ menuItem = false }: AnnouncementDropdownProps) {
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
    <div className='relative inline-flex items-center' ref={dropdownRef}>
      <button
        type='button'
        className={menuItem
          ? `sp-announcement-menu-trigger${isOpen ? ' is-active' : ''}`
          : `relative inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border border-transparent bg-transparent !px-2 py-0 font-[inherit] text-inherit transition-colors duration-150 hover:bg-[rgba(255,255,255,0.12)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(255,255,255,0.9)] max-[720px]:w-[34px] max-[720px]:justify-center max-[720px]:!px-0 max-[720px]:[&_span]:sr-only ${isOpen ? 'bg-[rgba(255,255,255,0.12)] text-white' : ''}`}
        onClick={toggleDropdown}
        aria-haspopup='dialog'
        aria-expanded={isOpen}
        title='Announcements'
      >
        <MegaphoneIcon />
        <span className={menuItem ? 'sp-announcement-menu-label' : 'text-[13px] leading-none'}>Announcements</span>
        {announcements.some((item) => item.isPinned) ? <i className='absolute left-[22px] top-1 size-[7px] rounded-full border-[1.5px] border-[#172033] bg-[#f2b84b] max-[720px]:left-[21px]' aria-label='Pinned announcement available' /> : null}
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
