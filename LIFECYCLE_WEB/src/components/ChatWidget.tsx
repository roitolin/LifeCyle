import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadChatMediaWeb, type ChatMediaType } from '@/lib/supabaseStorage'
import { getDefaultProfileAvatar } from '@/utils/profileAvatar'
import { SkeletonBlock, SkeletonRegion } from './ContentSkeleton'
import './ChatWidget.css'

type Conversation = {
  id: string
  participants: string[]
  shopId?: string | null
  hiddenFor?: string[]
  updatedAt?: string
  lastMessage?: {
    id?: string
    text?: string
    mediaType?: ChatMediaType | null
    senderId?: string
    timestamp?: string
    readBy?: string[]
  }
}

let nextChatChannelId = 0

type ChatMessage = {
  id: string
  conversationId?: string
  text?: string
  imageUrl?: string
  mediaUrl?: string | null
  mediaType?: ChatMediaType | null
  mediaDuration?: number | null
  mediaName?: string | null
  senderId?: string
  replyToId?: string | null
  timestamp?: string
  readBy?: string[]
  deliveredTo?: string[]
}

type PendingMediaAttachment = {
  file: File
  previewUrl: string
  mediaType: ChatMediaType
  fileName: string
  durationSeconds?: number | null
}

type UserInfo = {
  fullName?: string
  email?: string
  photoURL?: string
  gender?: string
  shopName?: string
  shopImageUrl?: string
}

type ChatPartnerProfile = UserInfo & {
  id: string
}

const QUICK_EMOJIS = [
  '😊', '🙏', '❤️', '🕊️', '🌹', '👍', '😢', '🤍',
  '😔', '✨', '🌸', '💐', '🕯️', '🤝', '🙌', '😌',
]

const QUICK_STICKERS = [
  { emoji: '🙏', label: 'Thank you' },
  { emoji: '🕊️', label: 'Peace' },
  { emoji: '🤍', label: 'Condolences' },
  { emoji: '💐', label: 'Sympathy' },
  { emoji: '🕯️', label: 'In memory' },
  { emoji: '👍', label: 'Okay' },
  { emoji: '🤝', label: 'Confirmed' },
  { emoji: '🌸', label: 'Blessings' },
]

const VOICE_WAVE_BARS = [0.35, 0.62, 0.45, 0.88, 0.55, 0.95, 0.4, 0.75, 0.9, 0.5, 0.82, 0.6, 0.92, 0.48, 0.7, 0.52, 0.65, 0.4]

function getDefaultAvatar(gender?: string) {
  return getDefaultProfileAvatar(gender)
}

function getChatDisplayName(info?: UserInfo | null) {
  return info?.shopName?.trim()
    || info?.fullName?.trim()
    || info?.email?.trim()
    || 'User'
}

function getChatAvatar(info?: UserInfo | null) {
  return info?.shopImageUrl
    || info?.photoURL
    || getDefaultAvatar(info?.gender)
}

function formatTime(value: string | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' })
}

function formatMsgTime(value: string | undefined) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

function getMessagePreviewLabel(msg?: Partial<ChatMessage> | null) {
  if (!msg) return ''
  if (msg.text && msg.text.trim()) return msg.text.trim()
  const type = msg.mediaType || (msg.imageUrl ? 'image' : null)
  if (type === 'image') return 'Photo'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Voice message'
  if (type === 'file') return msg.mediaName || 'File'
  return ''
}

function isMissingDeliveryReceipts(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === 'PGRST202'
    || error.code === 'PGRST204'
    || error.code === '42703'
    || error.code === '42883'
    || /acknowledge_chat_deliveries|mark_chat_messages_seen|deliveredTo/i.test(error.message || '')
}

function isMissingShopInboxColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === 'PGRST204'
    || error.code === '42703'
    || /shopId.*(column|schema cache|does not exist)/i.test(error.message || '')
}

async function findOrCreateConversation(userId: string, otherId: string) {
  const participants = [userId, otherId].sort()
  let existingResult = await supabase
    .from('conversations')
    .select('id')
    .contains('participants', participants)
    .eq('shopId', otherId)
    .limit(1)

  if (existingResult.error && isMissingShopInboxColumn(existingResult.error)) {
    existingResult = await supabase
      .from('conversations')
      .select('id')
      .contains('participants', participants)
      .limit(1)
  }
  if (existingResult.error) throw existingResult.error
  if (existingResult.data?.[0]?.id) return String(existingResult.data[0].id)

  const conversation = {
    participants,
    shopId: otherId,
    updatedAt: new Date().toISOString(),
  }
  let createResult = await supabase
    .from('conversations')
    .insert(conversation)
    .select('id')
    .maybeSingle()

  if (createResult.error && isMissingShopInboxColumn(createResult.error)) {
    createResult = await supabase
      .from('conversations')
      .insert({ participants, updatedAt: conversation.updatedAt })
      .select('id')
      .maybeSingle()
  }
  if (createResult.error) throw createResult.error
  if (!createResult.data?.id) throw new Error('The conversation could not be created.')
  return String(createResult.data.id)
}

function mergeReceiptIds(...lists: Array<string[] | undefined>) {
  return [...new Set(lists.flatMap(list => list ?? []))]
}

function messageTimestampMs(message: ChatMessage) {
  const timestamp = new Date(message.timestamp || '').getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortMessagesChronologically(messages: ChatMessage[]) {
  return [...messages].sort((left, right) => {
    const timestampDifference = messageTimestampMs(left) - messageTimestampMs(right)
    return timestampDifference || left.id.localeCompare(right.id)
  })
}

function upsertChatMessage(messages: ChatMessage[], changedMessage: ChatMessage) {
  const withoutChanged = messages.filter(message => message.id !== changedMessage.id)
  return sortMessagesChronologically([...withoutChanged, changedMessage]).slice(-100)
}

async function markChatMessagesSeen(
  conversationId: string,
  userId: string,
  messageIds: string[],
) {
  if (messageIds.length === 0) return

  const { error: rpcError } = await supabase.rpc('mark_chat_messages_seen', {
    target_conversation_id: conversationId,
    target_message_ids: messageIds,
  })
  if (!rpcError) return
  if (!isMissingDeliveryReceipts(rpcError)) throw rpcError

  const { data, error: fetchError } = await supabase
    .from('messages')
    .select('id, readBy')
    .eq('conversationId', conversationId)
    .neq('senderId', userId)
    .in('id', messageIds)
  if (fetchError) throw fetchError

  for (const message of data ?? []) {
    const readBy = mergeReceiptIds(message.readBy, [userId])
    const { error: updateError } = await supabase
      .from('messages')
      .update({ readBy })
      .eq('id', message.id)
      .eq('conversationId', conversationId)
    if (updateError) throw updateError
  }
}

function VoiceMessagePlayer({
  src,
  durationSeconds,
  mine,
}: {
  src: string
  durationSeconds?: number | null
  mine: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState<number>(durationSeconds && durationSeconds > 0 ? durationSeconds : 0)

  useEffect(() => {
    const audio = new Audio(src)
    audio.preload = 'metadata'
    audioRef.current = audio

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration)
      }
    }
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0)
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration)
      }
    }
    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }
    const onPause = () => setPlaying(false)
    const onPlay = () => setPlaying(true)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)

    return () => {
      audio.pause()
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
      audioRef.current = null
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      void audio.play().catch(() => setPlaying(false))
    }
  }

  const totalDuration = duration > 0 ? duration : (durationSeconds || 0)
  const progress = totalDuration > 0 ? Math.min(1, currentTime / totalDuration) : 0
  const displayedTime = playing || currentTime > 0 ? currentTime : totalDuration

  return (
    <div className={`cw-voice-player ${mine ? 'cw-voice-mine' : 'cw-voice-other'}`}>
      <button
        type="button"
        className="cw-voice-play-btn"
        onClick={togglePlay}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l10.5-6.5L8 5.5z" fill="currentColor" />
          </svg>
        )}
      </button>
      <div
        className="cw-voice-waveform"
        onClick={(event) => {
          const audio = audioRef.current
          if (!audio || !totalDuration) return
          const rect = event.currentTarget.getBoundingClientRect()
          const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
          audio.currentTime = ratio * totalDuration
          setCurrentTime(audio.currentTime)
        }}
      >
        {VOICE_WAVE_BARS.map((height, index) => {
          const filled = index / VOICE_WAVE_BARS.length <= progress
          return (
            <span
              key={index}
              className={`cw-voice-bar ${filled ? 'filled' : ''}`}
              style={{ height: `${Math.round(height * 22)}px` }}
            />
          )
        })}
      </div>
      <span className="cw-voice-duration">{formatDuration(displayedTime)}</span>
    </div>
  )
}

type ChatWidgetProps = {
  embedded?: boolean
  onClose?: () => void
}

export default function ChatWidget({ embedded = false, onClose }: ChatWidgetProps) {
  const [open, setOpen] = useState(embedded)
  const [userId, setUserId] = useState<string | null>(null)
  const [isShopAccount, setIsShopAccount] = useState(false)
  const [inboxMode, setInboxMode] = useState<'personal' | 'shop'>(embedded ? 'shop' : 'personal')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({})
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [pendingMedia, setPendingMedia] = useState<PendingMediaAttachment | null>(null)
  const [emojiTrayOpen, setEmojiTrayOpen] = useState(false)
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [chatError, setChatError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [headerDropdownOpen, setHeaderDropdownOpen] = useState(false)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingStartMsRef = useRef<number>(0)
  const discardRecordingRef = useRef(false)
  const loadConversationsRef = useRef<((showLoader?: boolean) => Promise<void>) | null>(null)
  const conversationsRef = useRef<Conversation[]>([])
  const userInfoMapRef = useRef<Record<string, UserInfo>>({})
  const pinToLatestRef = useRef(true)
  const initialConversationScrollRef = useRef(true)
  const scrollFrameRef = useRef<number | null>(null)
  const conversationLoadGenerationRef = useRef(0)
  const messageLoadGenerationRef = useRef(0)

  const scrollToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (container) container.scrollTo({
        top: container.scrollHeight,
        behavior: reducedMotion ? 'auto' : behavior,
      })
      scrollFrameRef.current = null
    })
  }, [])

  const clearPendingMedia = useCallback(() => {
    setPendingMedia(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return null
    })
  }, [])

  const cleanupRecordingResources = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    mediaRecorderRef.current = null
    setIsRecordingVoice(false)
    setRecordingSeconds(0)
  }, [])

  // Auth listener
  useEffect(() => {
    let mounted = true
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (mounted) setUserId(data.session?.user?.id ?? null)
      })
      .catch(() => {
        if (mounted) setUserId(null)
      })
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => {
      if (mounted) setUserId(s?.user?.id ?? null)
    })
    return () => {
      mounted = false
      l.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!userId) {
      setIsShopAccount(false)
      return () => { active = false }
    }

    void supabase
      .from('funeral_shops')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsShopAccount(Boolean(data?.id))
      })

    return () => { active = false }
  }, [userId])

  // Acknowledge incoming messages even while the widget is minimized.
  useEffect(() => {
    if (!userId) return

    let mounted = true
    let acknowledgeAll = false
    let retryAfter = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const pendingConversationIds = new Set<string>()

    const acknowledge = async (conversationIds: string[] | null) => {
      if (!mounted
        || Date.now() < retryAfter
        || document.visibilityState !== 'visible') return

      const { error } = await supabase.rpc('acknowledge_chat_deliveries', {
        target_conversation_ids: conversationIds,
      })
      if (!mounted) return
      if (error && isMissingDeliveryReceipts(error)) {
        retryAfter = Date.now() + 60_000
        return
      }
      if (error) {
        console.warn('Unable to acknowledge chat delivery:', error.message)
        return
      }
      retryAfter = 0
    }

    const flushAcknowledgements = () => {
      timer = null
      const ids = acknowledgeAll ? null : [...pendingConversationIds]
      acknowledgeAll = false
      pendingConversationIds.clear()
      if (ids === null || ids.length > 0) void acknowledge(ids)
    }

    const queueAcknowledgement = (conversationId?: string) => {
      if (conversationId) pendingConversationIds.add(conversationId)
      else acknowledgeAll = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(flushAcknowledgements, 80)
    }

    void acknowledge(null)
    const channel = supabase
      .channel(`chat-widget-deliveries-${userId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        const message = payload.new as ChatMessage
        if (message.senderId === userId || !message.conversationId) return
        queueAcknowledgement(message.conversationId)
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') {
          void acknowledge(null)
        }
      })

    const handleActivity = () => {
      if (document.visibilityState === 'visible') queueAcknowledgement()
    }
    document.addEventListener('visibilitychange', handleActivity)
    window.addEventListener('focus', handleActivity)

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleActivity)
      window.removeEventListener('focus', handleActivity)
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Global event listener to open chat
  useEffect(() => {
    const handleOpenChat = async (e: Event) => {
      const customEvent = e as CustomEvent<{ userId?: string; inbox?: 'personal' | 'shop' }>
      const otherId = customEvent.detail?.userId
      if (customEvent.detail?.inbox) setInboxMode(customEvent.detail.inbox)
      if (otherId && userId) {
        setOpen(true)
        setInboxMode('personal')
        setChatError('')

        try {
          const convId = await findOrCreateConversation(userId, otherId)
          setActiveConvId(convId)
          await loadConversationsRef.current?.()
        } catch (error) {
          console.error('Unable to open chat:', error)
          setActiveConvId(null)
          setChatError('Chat could not be opened. Check your connection and try again.')
          return
        }

        if (!userInfoMapRef.current[otherId]) {
          Promise.all([
            supabase.rpc('get_chat_partner_profiles', { target_ids: [otherId] }).maybeSingle(),
            supabase.from('funeral_shops').select('id, shopName, shopImageUrl').eq('id', otherId).maybeSingle()
          ]).then(([{ data: profileData }, { data: shopData }]) => {
            const profile = profileData as ChatPartnerProfile | null
            if (profile) {
              setUserInfoMap(prev => {
                const next = {
                  ...prev,
                  [otherId]: {
                    fullName: profile.fullName,
                    email: profile.email,
                    photoURL: profile.photoURL,
                    gender: profile.gender,
                    shopName: shopData?.shopName,
                    shopImageUrl: shopData?.shopImageUrl
                  }
                }
                userInfoMapRef.current = next
                return next
              })
            }
          })
        }
      } else if (!otherId) {
        setOpen(true)
        setActiveConvId(null)
        setChatError('')
      }
    }

    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [userId])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    cleanupRecordingResources()
    clearPendingMedia()
  }, [cleanupRecordingResources, clearPendingMedia])

  // Load conversations
  const loadConversations = useCallback(async (showLoader = false) => {
    if (!userId) return
    const generation = ++conversationLoadGenerationRef.current
    if (showLoader) setLoading(true)
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .contains('participants', [userId])
        .order('updatedAt', { ascending: false })
      if (error) throw error
      if (generation !== conversationLoadGenerationRef.current) return

      const convs: Conversation[] = (data ?? []).filter(
        (c: any) => !Array.isArray(c.hiddenFor) || !c.hiddenFor.includes(userId)
      )
      setConversations(convs)
      setChatError('')

      const otherIds = Array.from(
        new Set(convs.flatMap(c => c.participants.filter(p => p !== userId)))
      )
      const missing = otherIds.filter(id => !userInfoMapRef.current[id])
      if (missing.length > 0) {
        const [{ data: users }, { data: shops }] = await Promise.all([
          supabase.rpc('get_chat_partner_profiles', { target_ids: missing }),
          supabase.from('funeral_shops').select('id, shopName, shopImageUrl').in('id', missing)
        ])
        if (users) {
          setUserInfoMap(previous => {
            const map: Record<string, UserInfo> = { ...previous }
            users.forEach((u: any) => {
              const shop = shops?.find((s: any) => s.id === u.id)
              map[u.id] = {
                fullName: u.fullName,
                email: u.email,
                photoURL: u.photoURL,
                gender: u.gender,
                shopName: shop?.shopName,
                shopImageUrl: shop?.shopImageUrl
              }
            })
            userInfoMapRef.current = map
            return map
          })
        }
      }

      const counts: Record<string, number> = {}
      convs.forEach(c => {
        const last = c.lastMessage
        if (last && last.senderId !== userId && !last.readBy?.includes(userId)) {
          counts[c.id] = 1
        }
      })
      setUnreadCounts(counts)
    } catch (error) {
      if (generation === conversationLoadGenerationRef.current) {
        console.error('Unable to load conversations:', error)
        setChatError('Conversations could not be loaded. Please try again.')
      }
    } finally {
      if (showLoader) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadConversationsRef.current = loadConversations
  }, [loadConversations])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    userInfoMapRef.current = userInfoMap
  }, [userInfoMap])

  useEffect(() => {
    if (userId && open) void loadConversations(true)
  }, [userId, open, loadConversations])

  // Subscribe to conversation changes
  useEffect(() => {
    if (!userId || !open) return
    const channel = supabase
      .channel(`chat-widget-convs-${++nextChatChannelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', select: ['id'] }, () => {
        void loadConversations()
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void loadConversations()
      })
    return () => { void supabase.removeChannel(channel) }
  }, [userId, open, loadConversations])

  // Load messages for active conversation
  const loadMessages = useCallback(async (showLoader = true) => {
    if (!activeConvId) return
    const conversationToLoad = activeConvId
    const generation = ++messageLoadGenerationRef.current
    if (showLoader) setLoadingMessages(true)
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversationId', conversationToLoad)
        .order('timestamp', { ascending: false })
        .limit(100)
      if (error) throw error
      if (generation !== messageLoadGenerationRef.current) return

      const loadedMessages = ([...(data ?? [])].reverse() as ChatMessage[])
      setMessages(current => {
        const currentById = new Map(current.map(message => [message.id, message]))
        const mergedLoaded = loadedMessages.map(message => {
          const newerReceipt = currentById.get(message.id)
          if (!newerReceipt) return message
          return {
            ...message,
            readBy: mergeReceiptIds(message.readBy, newerReceipt.readBy),
            deliveredTo: mergeReceiptIds(message.deliveredTo, newerReceipt.deliveredTo),
          }
        })
        return sortMessagesChronologically(mergedLoaded).slice(-100)
      })
    } catch (error) {
      if (generation === messageLoadGenerationRef.current) {
        console.error('Unable to load chat messages:', error)
      }
    } finally {
      if (generation === messageLoadGenerationRef.current) setLoadingMessages(false)
    }
  }, [activeConvId])

  useEffect(() => {
    messageLoadGenerationRef.current += 1
    initialConversationScrollRef.current = true
    pinToLatestRef.current = true
    setMessages([])
    setReplyingTo(null)
    setEmojiTrayOpen(false)
    setStickerTrayOpen(false)
    clearPendingMedia()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      discardRecordingRef.current = true
      mediaRecorderRef.current.stop()
    } else {
      cleanupRecordingResources()
    }
    if (activeConvId) void loadMessages()
    else setLoadingMessages(false)
    return () => {
      messageLoadGenerationRef.current += 1
    }
  }, [activeConvId, cleanupRecordingResources, clearPendingMedia, loadMessages])

  // Mark message rows as seen only while the conversation is actually visible.
  useEffect(() => {
    if (!userId || !activeConvId || !open || isCollapsed) return

    const markVisibleMessagesSeen = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return

      const unreadMessages = messages.filter(message =>
        message.senderId !== userId && !message.readBy?.includes(userId)
      )
      if (unreadMessages.length > 0) {
        const unreadIds = new Set(unreadMessages.map(message => message.id))
        setMessages(current => current.map(message =>
          unreadIds.has(message.id)
            ? { ...message, readBy: [...(message.readBy ?? []), userId] }
            : message
        ))
        void markChatMessagesSeen(
          activeConvId,
          userId,
          unreadMessages.map(message => message.id),
        ).catch(error => {
          console.warn('Unable to mark chat messages as seen:', error?.message || error)
        })
      }

      const conversation = conversationsRef.current.find(item => item.id === activeConvId)
      const lastMessage = conversation?.lastMessage
      if (lastMessage && lastMessage.senderId !== userId && !lastMessage.readBy?.includes(userId)) {
        void supabase.from('conversations').update({
          lastMessage: { ...lastMessage, readBy: [...(lastMessage.readBy ?? []), userId] },
        })
          .eq('id', activeConvId)
          .eq('updatedAt', conversation?.updatedAt ?? '')
      }
    }

    markVisibleMessagesSeen()
    document.addEventListener('visibilitychange', markVisibleMessagesSeen)
    window.addEventListener('focus', markVisibleMessagesSeen)
    return () => {
      document.removeEventListener('visibilitychange', markVisibleMessagesSeen)
      window.removeEventListener('focus', markVisibleMessagesSeen)
    }
  }, [activeConvId, isCollapsed, messages, open, userId])

  // Subscribe to inserts and receipt updates for the active conversation.
  useEffect(() => {
    if (!open || !userId || !activeConvId) return
    const channel = supabase
      .channel(`chat-widget-msgs-${activeConvId}-${++nextChatChannelId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversationId=eq.${activeConvId}`,
        select: ['id', 'conversationId', 'senderId']
      }, (payload) => {
        const eventType = String(payload.eventType || '')
        if (eventType === 'DELETE') {
          const deletedId = String((payload.old as Partial<ChatMessage> | undefined)?.id || '')
          if (deletedId) {
            setMessages(current => current.filter(message => message.id !== deletedId))
            setReplyingTo(current => current?.id === deletedId ? null : current)
          }
          return
        }

        const changedMessage = payload.new as ChatMessage
        if (!changedMessage?.id || changedMessage.conversationId !== activeConvId) return
        if (eventType === 'INSERT' && (changedMessage.senderId === userId || pinToLatestRef.current)) {
          pinToLatestRef.current = true
        }
        void loadMessages(false)
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void loadMessages(false)
      })
    return () => { void supabase.removeChannel(channel) }
  }, [activeConvId, loadMessages, open, userId])

  // Auto-scroll to bottom
  useLayoutEffect(() => {
    if (!open || !activeConvId || loadingMessages || !pinToLatestRef.current) return
    const behavior = initialConversationScrollRef.current ? 'auto' : 'smooth'
    scrollToLatest(behavior)
    initialConversationScrollRef.current = false
  }, [activeConvId, isCollapsed, loadingMessages, messages, open, scrollToLatest])

  // Close header dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setHeaderDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const getDateLabel = (ts: string | undefined) => {
    if (!ts) return ''
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (msgDate.getTime() === today.getTime()) return 'Today'
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday'
    return d.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: 'numeric' })
  }

  const dispatchMessagePayload = useCallback(async (payload: {
    text?: string
    mediaFile?: File | Blob | null
    mediaType?: ChatMediaType
    mediaName?: string
    mediaDuration?: number | null
  }) => {
    if (!userId || !activeConvId || sending) return
    const cleanText = (payload.text ?? '').trim()
    if (!cleanText && !payload.mediaFile) return

    setSending(true)
    setChatError('')
    try {
      let uploaded: {
        mediaUrl: string
        mediaType: ChatMediaType
        mediaName: string
        mediaDuration?: number | null
      } | null = null

      if (payload.mediaFile) {
        uploaded = await uploadChatMediaWeb(payload.mediaFile, {
          mediaType: payload.mediaType,
          fileName: payload.mediaName,
          durationSeconds: payload.mediaDuration,
        })
      }

      const insertRow: Record<string, unknown> = {
        conversationId: activeConvId,
        senderId: userId,
        text: cleanText,
        readBy: [userId],
        replyToId: replyingTo?.id ?? null,
      }
      if (uploaded) {
        insertRow.mediaUrl = uploaded.mediaUrl
        insertRow.mediaType = uploaded.mediaType
        insertRow.mediaName = uploaded.mediaName
        if (uploaded.mediaDuration && uploaded.mediaDuration > 0) {
          insertRow.mediaDuration = Math.round(uploaded.mediaDuration * 10) / 10
        }
      }

      const { data: insertedMessage, error } = await supabase
        .from('messages')
        .insert(insertRow)
        .select('*')
        .single()
      if (error) throw error
      if (!insertedMessage) throw new Error('The sent message was not returned by the server.')

      const sentMessage: ChatMessage = {
        ...(insertedMessage as ChatMessage),
        text: cleanText,
        mediaUrl: uploaded?.mediaUrl ?? (insertedMessage as ChatMessage).mediaUrl ?? null,
        mediaType: uploaded?.mediaType ?? (insertedMessage as ChatMessage).mediaType ?? null,
        mediaName: uploaded?.mediaName ?? (insertedMessage as ChatMessage).mediaName ?? null,
        mediaDuration: uploaded?.mediaDuration ?? (insertedMessage as ChatMessage).mediaDuration ?? null,
      }
      const sentAt = sentMessage.timestamp || new Date().toISOString()
      pinToLatestRef.current = true
      initialConversationScrollRef.current = false
      setMessages(current => upsertChatMessage(current, sentMessage))
      setReplyingTo(null)

      const previewLabel = getMessagePreviewLabel(sentMessage) || 'Encrypted message'
      await supabase.from('conversations').update({
        lastMessage: {
          id: sentMessage.id,
          text: previewLabel,
          mediaType: sentMessage.mediaType ?? null,
          senderId: userId,
          timestamp: sentAt,
          readBy: [userId],
        },
        updatedAt: sentAt,
      }).eq('id', activeConvId).lte('updatedAt', sentAt)

      void loadMessages(false)
      void loadConversations(false)
    } catch (error: any) {
      console.error('Error sending message:', error)
      setChatError(error?.message || 'Your message was not sent. Please try again.')
      throw error
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [activeConvId, loadConversations, loadMessages, replyingTo, sending, userId])

  const sendMessage = async () => {
    if (!userId || !activeConvId || sending) return
    const text = chatInput.trim()
    const attachment = pendingMedia
    if (!text && !attachment) return

    setChatInput('')
    setEmojiTrayOpen(false)
    setStickerTrayOpen(false)
    if (attachment) setPendingMedia(null)

    try {
      await dispatchMessagePayload({
        text,
        mediaFile: attachment?.file ?? null,
        mediaType: attachment?.mediaType,
        mediaName: attachment?.fileName,
        mediaDuration: attachment?.durationSeconds ?? null,
      })
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    } catch {
      if (text) setChatInput(current => current || text)
      if (attachment) setPendingMedia(attachment)
    }
  }

  const sendQuickText = async (quickText: string) => {
    if (!userId || !activeConvId || sending) return
    setEmojiTrayOpen(false)
    setStickerTrayOpen(false)
    try {
      await dispatchMessagePayload({ text: quickText })
    } catch {
      // Error banner already updated in dispatchMessagePayload
    }
  }

  const handleSelectMediaFile = (event: React.ChangeEvent<HTMLInputElement>, forceType?: ChatMediaType) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const mime = file.type.toLowerCase()
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    let mediaType: ChatMediaType = forceType || 'file'
    if (!forceType) {
      if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext)) {
        mediaType = 'image'
      } else if (mime.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', '3gp'].includes(ext)) {
        mediaType = 'video'
      } else if (mime.startsWith('audio/') || ['m4a', 'mp3', 'wav', 'ogg', 'aac'].includes(ext)) {
        mediaType = 'audio'
      }
    }

    clearPendingMedia()
    const previewUrl = URL.createObjectURL(file)
    setEmojiTrayOpen(false)
    setStickerTrayOpen(false)

    if (mediaType === 'video' || mediaType === 'audio') {
      const mediaEl = document.createElement(mediaType)
      mediaEl.preload = 'metadata'
      mediaEl.onloadedmetadata = () => {
        const dur = Number.isFinite(mediaEl.duration) && mediaEl.duration > 0 ? mediaEl.duration : null
        setPendingMedia(prev => prev ? { ...prev, durationSeconds: dur } : prev)
      }
      mediaEl.src = previewUrl
    }

    setPendingMedia({
      file,
      previewUrl,
      mediaType,
      fileName: file.name,
      durationSeconds: null,
    })
    inputRef.current?.focus()
  }

  const startVoiceRecording = async () => {
    if (sending || isRecordingVoice) return
    setEmojiTrayOpen(false)
    setStickerTrayOpen(false)
    setChatError('')

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setChatError('Voice recording is not supported in this browser.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      recordedChunksRef.current = []
      discardRecordingRef.current = false

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ]
      const supportedMimeType = preferredTypes.find(type => {
        try {
          return MediaRecorder.isTypeSupported(type)
        } catch {
          return false
        }
      }) || ''

      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)

      mediaRecorderRef.current = recorder
      recordingStartMsRef.current = Date.now()
      setRecordingSeconds(0)
      setIsRecordingVoice(true)

      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartMsRef.current) / 1000)
        setRecordingSeconds(elapsed)
      }, 250)

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data)
        }
      }

      recorder.onstop = () => {
        const wasDiscarded = discardRecordingRef.current
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartMsRef.current) / 1000))
        const mimeType = recorder.mimeType || supportedMimeType || 'audio/webm'
        const chunks = [...recordedChunksRef.current]
        recordedChunksRef.current = []
        cleanupRecordingResources()

        if (wasDiscarded || chunks.length === 0) return

        const ext = mimeType.includes('mp4') || mimeType.includes('m4a')
          ? 'm4a'
          : mimeType.includes('ogg')
            ? 'ogg'
            : 'webm'
        const audioBlob = new Blob(chunks, { type: mimeType.split(';')[0] || 'audio/webm' })
        if (audioBlob.size < 100) return

        void dispatchMessagePayload({
          text: '',
          mediaFile: audioBlob,
          mediaType: 'audio',
          mediaName: `voice-${Date.now()}.${ext}`,
          mediaDuration: durationSec,
        }).catch(() => {
          // Error banner already shown
        })
      }

      recorder.start(200)
    } catch (error: any) {
      cleanupRecordingResources()
      setChatError(
        error?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser settings to send voice messages.'
          : 'Unable to access microphone for voice recording.'
      )
    }
  }

  const cancelVoiceRecording = () => {
    discardRecordingRef.current = true
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    } else {
      cleanupRecordingResources()
    }
  }

  const finishAndSendVoiceRecording = () => {
    discardRecordingRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0)

  const activeConv = conversations.find(c => c.id === activeConvId)
  const otherUserId = activeConv?.participants.find(p => p !== userId) ?? null
  const otherUser = otherUserId ? userInfoMap[otherUserId] : null
  const otherName = getChatDisplayName(otherUser)
  const otherAvatar = getChatAvatar(otherUser)
  const messageById = useMemo(
    () => new Map(messages.map(message => [message.id, message])),
    [messages]
  )
  const latestOutgoingMessageId = useMemo(
    () => [...messages].reverse().find(message => message.senderId === userId)?.id ?? null,
    [messages, userId]
  )
  const latestSeenOutgoingMessageId = useMemo(
    () => [...messages].reverse().find(message =>
      message.senderId === userId
      && !!otherUserId
      && message.readBy?.includes(otherUserId)
    )?.id ?? null,
    [messages, otherUserId, userId]
  )

  const personalConversations = conversations.filter(conversation => conversation.shopId !== userId)
  const shopConversations = conversations.filter(conversation => conversation.shopId === userId)
  const visibleConversations = isShopAccount && inboxMode === 'shop'
    ? shopConversations
    : personalConversations

  const filteredConvs = searchText
    ? visibleConversations.filter(c => {
      const otherId = c.participants.find(p => p !== userId)
      const info = otherId ? userInfoMap[otherId] : null
      const searchableIdentity = [info?.fullName, info?.shopName, info?.email]
        .filter(Boolean)
        .join(' ')
      return searchableIdentity.toLowerCase().includes(searchText.toLowerCase())
    })
    : visibleConversations

  const selectInbox = (nextMode: 'personal' | 'shop') => {
    setInboxMode(nextMode)
    setActiveConvId(null)
    setSearchText('')
    setHeaderDropdownOpen(false)
  }

  const hasSendableDraft = Boolean(chatInput.trim() || pendingMedia)

  if (!userId) return null

  return (
    <>
      {/* Floating Chat Button */}
      {!embedded && !open && (
        <button className="cw-fab" onClick={() => setOpen(true)} aria-label="Open Chat">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="cw-fab-label">Chat</span>
          {totalUnread > 0 && <span className="cw-fab-badge">{totalUnread}</span>}
        </button>
      )}

      {/* Chat Panel Split View */}
      {open && (
        <div className={`cw-panel${embedded ? ' cw-panel-embedded' : ''} ${isCollapsed ? 'collapsed' : ''} ${activeConvId ? 'has-active-conversation' : ''} ${replyingTo ? 'has-reply' : ''}`}>
          {/* Sidebar (Left) */}
          <div className="cw-sidebar">
            <div className="cw-sidebar-header">
              <span className="cw-sidebar-title">
                {isShopAccount && inboxMode === 'shop' ? 'Shop inbox' : 'Chat'} <span className="cw-sidebar-count">({visibleConversations.length})</span>
              </span>
              <div className="cw-sidebar-actions">
                <button
                  className="cw-icon-btn cw-icon-dark"
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  title={isCollapsed ? 'Show chat window' : 'Show chat list only'}
                >
                  {isCollapsed ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 4 H6 a2 2 0 0 0 -2 2 v12 a2 2 0 0 0 2 2 H20" />
                      <path d="M20 4 v16" strokeDasharray="3 3" />
                      <path d="M15 12 H9" />
                      <path d="M12 9 l-3 3 3 3" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4 h14 a2 2 0 0 1 2 2 v12 a2 2 0 0 1 -2 2 H4" />
                      <path d="M4 4 v16" strokeDasharray="3 3" />
                      <path d="M9 12 h6" />
                      <path d="M12 9 l3 3 -3 3" />
                    </svg>
                  )}
                </button>
                <button
                  className="cw-icon-btn cw-icon-dark"
                  onClick={() => {
                    setActiveConvId(null)
                    if (embedded) onClose?.()
                    else setOpen(false)
                  }}
                  aria-label={embedded ? 'Close messages' : 'Minimize'}
                  title={embedded ? 'Close messages' : 'Minimize'}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <path d="M8 10l4 4 4-4" />
                  </svg>
                </button>
              </div>
            </div>

            {chatError && (
              <div className="cw-error" role="alert">
                <span>{chatError}</span>
                <button
                  type="button"
                  onClick={() => {
                    setChatError('')
                    void loadConversations(true)
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {isShopAccount && (
              <div className="cw-inbox-tabs" role="tablist" aria-label="Message inboxes">
                <button
                  type="button"
                  role="tab"
                  aria-selected={inboxMode === 'personal'}
                  className={inboxMode === 'personal' ? 'active' : ''}
                  onClick={() => selectInbox('personal')}
                >
                  Personal
                  {personalConversations.some(conversation => unreadCounts[conversation.id]) && <span />}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={inboxMode === 'shop'}
                  className={inboxMode === 'shop' ? 'active' : ''}
                  onClick={() => selectInbox('shop')}
                >
                  Shop inbox
                  {shopConversations.some(conversation => unreadCounts[conversation.id]) && <span />}
                </button>
              </div>
            )}

            <div className="cw-search">
              <div className="cw-search-inner">
                <svg className="cw-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  type="text"
                  placeholder={isShopAccount && inboxMode === 'shop' ? 'Search customers' : 'Search conversations'}
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="cw-search-input"
                />
              </div>
              <div className="cw-search-filter">{isShopAccount && inboxMode === 'shop' ? 'Customers' : 'All'}</div>
            </div>

            <div className="cw-conv-list">
              {loading && conversations.length === 0 && (
                <SkeletonRegion label="Loading conversations">
                  {[0, 1, 2].map(index => (
                    <div className="cw-conv-item cw-conv-placeholder" key={index}>
                      <div className="cw-conv-avatar-wrap"><SkeletonBlock className="cw-conv-avatar" /></div>
                      <div className="cw-conv-info">
                        <div className="cw-conv-top"><SkeletonBlock className="lc-skeleton-short" /><SkeletonBlock className="cw-skeleton-time" /></div>
                        <div className="cw-conv-bottom"><SkeletonBlock /></div>
                      </div>
                    </div>
                  ))}
                </SkeletonRegion>
              )}
              {!loading && filteredConvs.length === 0 && (
                <div className="cw-empty" style={{ marginTop: '20px' }}>
                  {isShopAccount && inboxMode === 'shop' ? 'No customer messages yet' : 'No conversations yet'}
                </div>
              )}
              {filteredConvs.map(conv => {
                const otherId = conv.participants.find(p => p !== userId)
                const info = otherId ? userInfoMap[otherId] : null
                const name = getChatDisplayName(info)
                const avatar = getChatAvatar(info)
                const lastText = conv.lastMessage?.text || ''
                const time = formatTime(conv.lastMessage?.timestamp ?? conv.updatedAt)
                const unread = unreadCounts[conv.id] || 0
                const isActive = activeConvId === conv.id

                return (
                  <div
                    key={conv.id}
                    className={`cw-conv-item lc-content-reveal ${unread > 0 ? 'unread' : ''} ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveConvId(conv.id)}
                  >
                    <div className="cw-conv-avatar-wrap">
                      <img src={avatar} alt="" className="cw-conv-avatar" />
                    </div>
                    <div className="cw-conv-info">
                      <div className="cw-conv-top">
                        <span className="cw-conv-name">{name}</span>
                        <span className="cw-conv-time">{time}</span>
                      </div>
                      <div className="cw-conv-bottom">
                        <span className="cw-conv-preview">{lastText.length > 35 ? lastText.slice(0, 35) + '…' : lastText || 'No messages yet'}</span>
                        {unread > 0 && <span className="cw-conv-badge">{unread}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Main Chat Area (Right) */}
          <div className="cw-main">
            {!activeConvId ? (
              <div className="cw-welcome">
                <div className="cw-welcome-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                </div>
                <p className="cw-welcome-title">{isShopAccount && inboxMode === 'shop' ? 'Shop inbox' : 'Chat'}</p>
                <p className="cw-welcome-sub">
                  {isShopAccount && inboxMode === 'shop' ? 'Select a customer message to read and reply' : 'Select a conversation to start chatting'}
                </p>
              </div>
            ) : (
              <>
                <div className="cw-main-header" ref={dropdownRef}>
                  <div className="cw-main-header-left">
                    <button
                      type="button"
                      className="cw-mobile-back"
                      onClick={() => {
                        setHeaderDropdownOpen(false)
                        setActiveConvId(null)
                      }}
                      aria-label="Back to conversations"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m15 18-6-6 6-6" />
                      </svg>
                    </button>
                    <img src={otherAvatar} alt="" className="cw-header-avatar" />
                    <div className="cw-main-identity">
                      <span className="cw-main-title" onClick={() => setHeaderDropdownOpen(!headerDropdownOpen)}>
                        {otherName} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </span>
                      <small>{activeConv?.shopId === userId ? 'Customer' : activeConv?.shopId === otherUserId ? 'Funeral shop' : 'Conversation'}</small>
                    </div>
                  </div>
                  {headerDropdownOpen && (
                    <div className="cw-header-dropdown">
                      <div className="cw-dropdown-profile">
                        <img src={otherAvatar} alt="" className="cw-dropdown-avatar" />
                        <span className="cw-dropdown-name">{otherName}</span>
                      </div>
                      <div className="cw-dropdown-divider" />
                      <div className="cw-dropdown-item">
                        <span>Mute</span>
                        <div className="cw-toggle off"><div className="cw-toggle-knob" /></div>
                      </div>
                      <div className="cw-dropdown-item">
                        <span>Block user</span>
                        <div className="cw-toggle off"><div className="cw-toggle-knob" /></div>
                      </div>
                      <div className="cw-dropdown-divider" />
                      <div className="cw-dropdown-item cw-dropdown-clickable" onClick={() => setHeaderDropdownOpen(false)}>
                        <span>View Profile</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  ref={messagesContainerRef}
                  className="cw-messages"
                  onScroll={(event) => {
                    const container = event.currentTarget
                    pinToLatestRef.current =
                      container.scrollHeight - container.scrollTop - container.clientHeight < 72
                  }}
                >
                  <div className="cw-messages-spacer" />
                  <div className="cw-safety-tip">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <div className="cw-safety-text">
                      Safety tip: Always chat and complete transactions inside LifeCycle to protect yourself from scams. Do not share your personal information or contact unless it is necessary.
                    </div>
                  </div>

                  {loadingMessages && messages.length === 0 && (
                    <SkeletonRegion label="Loading messages">
                      <div className="cw-message-placeholders">
                        <div className="cw-msg cw-skeleton-incoming">
                          <SkeletonBlock className="cw-msg-avatar" />
                          <SkeletonBlock className="cw-skeleton-bubble" />
                        </div>
                        <div className="cw-msg cw-skeleton-outgoing"><SkeletonBlock className="cw-skeleton-bubble" /></div>
                        <div className="cw-msg cw-skeleton-incoming">
                          <SkeletonBlock className="cw-msg-avatar" />
                          <SkeletonBlock className="cw-skeleton-bubble" />
                        </div>
                      </div>
                    </SkeletonRegion>
                  )}
                  {!loadingMessages && messages.length === 0 && (
                    <div className="cw-empty" style={{ marginTop: '20px' }}>No messages yet. Say hello!</div>
                  )}

                  {messages.map((msg, idx) => {
                    const mine = msg.senderId === userId
                    const repliedMessage = msg.replyToId ? messageById.get(msg.replyToId) : null
                    const replyTargetName = repliedMessage
                      ? repliedMessage.senderId === userId
                        ? mine ? 'yourself' : 'you'
                        : mine ? otherName : 'themselves'
                      : ''
                    const replyContextLabel = `${mine ? 'You' : otherName} replied${replyTargetName ? ` to ${replyTargetName}` : ''}`
                    const showSeenAvatar = mine && msg.id === latestSeenOutgoingMessageId
                    const showDeliveryLabel = mine && msg.id === latestOutgoingMessageId && !showSeenAvatar
                    const deliveryLabel = otherUserId && msg.deliveredTo?.includes(otherUserId)
                      ? 'Delivered'
                      : 'Sent'
                    const dateLabel = getDateLabel(msg.timestamp)
                    const prevDateLabel = idx > 0 ? getDateLabel(messages[idx - 1].timestamp) : ''
                    const showDateSep = dateLabel && dateLabel !== prevDateLabel

                    const resolvedMediaUrl = msg.mediaUrl || msg.imageUrl || null
                    const resolvedMediaType: ChatMediaType | null = msg.mediaType
                      || (msg.imageUrl ? 'image' : null)

                    return (
                      <div key={msg.id} className={`cw-msg-row lc-content-reveal ${mine ? 'cw-msg-row-mine' : 'cw-msg-row-other'}`}>
                        {showDateSep && (
                          <div className="cw-date-separator">
                            <span>{dateLabel}</span>
                          </div>
                        )}
                        <div className={`cw-msg ${mine ? 'cw-msg-mine' : 'cw-msg-other'}`}>
                          {!mine && <img src={otherAvatar} alt="" className="cw-msg-avatar" />}
                          <div className={`cw-msg-cluster ${mine ? 'cw-msg-cluster-mine' : 'cw-msg-cluster-other'}`}>
                            {msg.replyToId ? (
                              <div className="cw-reply-context">
                                <div className="cw-reply-context-label">
                                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v4" /></svg>
                                  <span>{replyContextLabel}</span>
                                </div>
                                <div className="cw-reply-quote">
                                  {getMessagePreviewLabel(repliedMessage) || 'Message is no longer available'}
                                </div>
                              </div>
                            ) : null}
                            <div className={`cw-msg-bubble ${mine ? 'cw-bubble-mine' : 'cw-bubble-other'}`}>
                              {resolvedMediaUrl && resolvedMediaType === 'image' && (
                                <button
                                  type="button"
                                  className="cw-msg-image-btn"
                                  onClick={() => setLightboxImageUrl(resolvedMediaUrl)}
                                  aria-label="View full photo"
                                >
                                  <img
                                    src={resolvedMediaUrl}
                                    alt={msg.mediaName || 'Shared photo'}
                                    className="cw-msg-image"
                                    onLoad={() => {
                                      if (pinToLatestRef.current) scrollToLatest('auto')
                                    }}
                                  />
                                </button>
                              )}
                              {resolvedMediaUrl && resolvedMediaType === 'video' && (
                                <video
                                  src={resolvedMediaUrl}
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="cw-msg-video"
                                  onLoadedMetadata={() => {
                                    if (pinToLatestRef.current) scrollToLatest('auto')
                                  }}
                                />
                              )}
                              {resolvedMediaUrl && resolvedMediaType === 'audio' && (
                                <VoiceMessagePlayer
                                  src={resolvedMediaUrl}
                                  durationSeconds={msg.mediaDuration}
                                  mine={mine}
                                />
                              )}
                              {resolvedMediaUrl && resolvedMediaType === 'file' && (
                                <a
                                  href={resolvedMediaUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="cw-msg-file"
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <span>{msg.mediaName || 'Attachment'}</span>
                                </a>
                              )}
                              {msg.text && <p className="cw-msg-text">{msg.text}</p>}
                              <span className="cw-msg-time">{formatMsgTime(msg.timestamp)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="cw-msg-reply-btn"
                            onClick={() => {
                              setReplyingTo(msg)
                              inputRef.current?.focus()
                            }}
                            aria-label={`Reply to ${mine ? 'your message' : otherName}`}
                            title="Reply"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 14-5-5 5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v4" /></svg>
                          </button>
                        </div>
                        {showSeenAvatar ? (
                          <img
                            src={otherAvatar}
                            alt="Seen"
                            title="Seen"
                            className="cw-msg-seen-avatar"
                          />
                        ) : showDeliveryLabel ? (
                          <span className="cw-msg-delivery">{deliveryLabel}</span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                {/* Hidden File Pickers */}
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="cw-hidden-file-input"
                  onChange={e => handleSelectMediaFile(e)}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                  className="cw-hidden-file-input"
                  onChange={e => handleSelectMediaFile(e)}
                />

                <div className="cw-input-area">
                  {replyingTo ? (
                    <div className="cw-reply-composer">
                      <svg className="cw-reply-composer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 14-5-5 5-5" /><path d="M4 9h9a7 7 0 0 1 7 7v4" /></svg>
                      <div className="cw-reply-composer-copy">
                        <strong>Replying to {replyingTo.senderId === userId ? 'yourself' : otherName}</strong>
                        <span>{getMessagePreviewLabel(replyingTo) || 'Message'}</span>
                      </div>
                      <button type="button" className="cw-reply-cancel" onClick={() => setReplyingTo(null)} aria-label="Cancel reply">×</button>
                    </div>
                  ) : null}

                  {pendingMedia ? (
                    <div className="cw-media-preview-bar">
                      <div className="cw-media-preview-thumb-wrap">
                        {pendingMedia.mediaType === 'image' ? (
                          <img src={pendingMedia.previewUrl} alt="" className="cw-media-preview-thumb" />
                        ) : pendingMedia.mediaType === 'video' ? (
                          <video src={pendingMedia.previewUrl} className="cw-media-preview-thumb" muted playsInline />
                        ) : (
                          <div className="cw-media-preview-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="cw-media-preview-meta">
                        <strong>
                          {pendingMedia.mediaType === 'image'
                            ? 'Photo ready to send'
                            : pendingMedia.mediaType === 'video'
                              ? 'Video ready to send'
                              : pendingMedia.mediaType === 'audio'
                                ? 'Audio ready to send'
                                : 'File ready to send'}
                        </strong>
                        <span>{pendingMedia.fileName}</span>
                      </div>
                      <button
                        type="button"
                        className="cw-media-preview-remove"
                        onClick={clearPendingMedia}
                        disabled={sending}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}

                  {emojiTrayOpen ? (
                    <div className="cw-picker-tray" role="dialog" aria-label="Emoji picker">
                      <div className="cw-emoji-grid">
                        {QUICK_EMOJIS.map(emoji => (
                          <button
                            key={emoji}
                            type="button"
                            className="cw-emoji-item"
                            onClick={() => {
                              setChatInput(prev => prev + emoji)
                              inputRef.current?.focus()
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {stickerTrayOpen ? (
                    <div className="cw-picker-tray" role="dialog" aria-label="Stickers and attachments">
                      <div className="cw-sticker-grid">
                        {QUICK_STICKERS.map(item => (
                          <button
                            key={item.label}
                            type="button"
                            className="cw-sticker-item"
                            onClick={() => void sendQuickText(item.emoji)}
                            title={item.label}
                          >
                            <span className="cw-sticker-emoji">{item.emoji}</span>
                            <span className="cw-sticker-label">{item.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="cw-sticker-footer">
                        <button
                          type="button"
                          className="cw-attach-file-btn"
                          onClick={() => {
                            setStickerTrayOpen(false)
                            fileInputRef.current?.click()
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                          </svg>
                          Attach file or document
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {isRecordingVoice ? (
                    <div className="cw-composer-row cw-recording-row">
                      <button
                        type="button"
                        className="cw-composer-icon-btn cw-recording-cancel"
                        onClick={cancelVoiceRecording}
                        aria-label="Cancel voice recording"
                        title="Cancel"
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                          <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1zm1 4a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1zm4 0a1 1 0 0 0-1 1v8a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1z" />
                        </svg>
                      </button>
                      <div className="cw-recording-pill">
                        <span className="cw-recording-dot" />
                        <span className="cw-recording-time">{formatDuration(recordingSeconds)}</span>
                        <div className="cw-recording-wave" aria-hidden="true">
                          {VOICE_WAVE_BARS.slice(0, 12).map((h, i) => (
                            <span
                              key={i}
                              className="cw-recording-wave-bar"
                              style={{ height: `${Math.round(h * 18)}px`, animationDelay: `${i * 90}ms` }}
                            />
                          ))}
                        </div>
                        <span className="cw-recording-label">Recording voice...</span>
                      </div>
                      <button
                        type="button"
                        className="cw-composer-icon-btn cw-composer-send-btn"
                        onClick={finishAndSendVoiceRecording}
                        aria-label="Send voice message"
                        title="Send voice message"
                      >
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                          <path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="cw-composer-row">
                      {/* 1. Microphone (Voice Over) */}
                      <button
                        type="button"
                        className="cw-composer-icon-btn"
                        onClick={() => void startVoiceRecording()}
                        disabled={sending}
                        aria-label="Record voice message"
                        title="Voice message"
                      >
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                          <path d="M12 14a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 14zm5.5-3.5a1 1 0 1 1 2 0 7.5 7.5 0 0 1-6.5 7.43V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.07A7.5 7.5 0 0 1 4.5 10.5a1 1 0 1 1 2 0 5.5 5.5 0 0 0 11 0z" />
                        </svg>
                      </button>

                      {/* 2. Picture / Video Gallery */}
                      <button
                        type="button"
                        className="cw-composer-icon-btn"
                        onClick={() => mediaInputRef.current?.click()}
                        disabled={sending}
                        aria-label="Send photo or video"
                        title="Photo or video"
                      >
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                          <path d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm0 2a1 1 0 0 0-1 1v8.59l3.3-3.3a1 1 0 0 1 1.4 0l2.3 2.3 3.3-3.3a1 1 0 0 1 1.4 0L19 12.59V6a1 1 0 0 0-1-1H6zm2.5 5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                        </svg>
                      </button>

                      {/* 3. Sticker / File Attachment (Folded-corner smiley icon from reference, without GIF) */}
                      <button
                        type="button"
                        className={`cw-composer-icon-btn ${stickerTrayOpen ? 'active' : ''}`}
                        onClick={() => {
                          setStickerTrayOpen(prev => !prev)
                          setEmojiTrayOpen(false)
                        }}
                        disabled={sending}
                        aria-label="Stickers and files"
                        title="Stickers and files"
                      >
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                          <path d="M7 3h10a4 4 0 0 1 4 4v7.5a1.5 1.5 0 0 1-.44 1.06l-5 5A1.5 1.5 0 0 1 14.5 21H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm7 16v-3a2 2 0 0 1 2-2h3l-5 5zM9 10.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm6 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm-6.12 2.42a.85.85 0 0 0-1.26 1.14A5.1 5.1 0 0 0 11.5 15.8a5.1 5.1 0 0 0 2.9-.84.85.85 0 1 0-.96-1.4 3.4 3.4 0 0 1-1.94.54 3.4 3.4 0 0 1-2.62-1.18z" />
                        </svg>
                      </button>

                      {/* 4. Pill Input ("Aa" + Emoji Button inside right) */}
                      <div className="cw-input-pill">
                        <input
                          ref={inputRef}
                          type="text"
                          placeholder="Aa"
                          value={chatInput}
                          disabled={sending}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void sendMessage()
                            }
                          }}
                          className="cw-input"
                        />
                        <button
                          type="button"
                          className={`cw-pill-emoji-btn ${emojiTrayOpen ? 'active' : ''}`}
                          onClick={() => {
                            setEmojiTrayOpen(prev => !prev)
                            setStickerTrayOpen(false)
                          }}
                          aria-label="Choose emoji"
                          title="Emoji"
                        >
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-3.5 7a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zm7 0a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zm-3.5 8.2c-2.52 0-4.63-1.48-5.38-3.55a.85.85 0 0 1 1.6-.58c.52 1.44 2.02 2.43 3.78 2.43s3.26-.99 3.78-2.43a.85.85 0 1 1 1.6.58c-.75 2.07-2.86 3.55-5.38 3.55z" />
                          </svg>
                        </button>
                      </div>

                      {/* 5. Thumbs-up (when empty) or Send button (when text/attachment exists) */}
                      {hasSendableDraft ? (
                        <button
                          type="button"
                          className="cw-composer-icon-btn cw-composer-send-btn"
                          onClick={() => void sendMessage()}
                          disabled={sending}
                          aria-label="Send message"
                          title="Send"
                        >
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                            <path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="cw-composer-icon-btn cw-composer-like-btn"
                          onClick={() => void sendQuickText('👍')}
                          disabled={sending}
                          aria-label="Send thumbs up"
                          title="Like"
                        >
                          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                            <path d="M2 20h2c.55 0 1-.45 1-1v-9c0-.55-.45-1-1-1H2v11zm19.83-7.12c.11-.25.17-.52.17-.8V11c0-1.1-.9-2-2-2h-5.5l.92-4.65c.05-.22.02-.46-.08-.66-.23-.45-.52-.86-.88-1.22L14 2 7.59 8.41C7.21 8.79 7 9.3 7 9.83v7.84A2.33 2.33 0 0 0 9.33 20h8.11c.7 0 1.36-.37 1.72-.97l2.67-6.15z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightboxImageUrl && (
        <div
          className="cw-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
          onClick={() => setLightboxImageUrl(null)}
        >
          <button
            type="button"
            className="cw-lightbox-close"
            onClick={() => setLightboxImageUrl(null)}
            aria-label="Close photo preview"
          >
            ×
          </button>
          <img
            src={lightboxImageUrl}
            alt="Full size preview"
            className="cw-lightbox-img"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
