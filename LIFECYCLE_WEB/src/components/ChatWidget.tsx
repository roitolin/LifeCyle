import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { auth } from '@/lib/supabaseAuth'
import './ChatWidget.css'

type Conversation = {
  id: string
  participants: string[]
  hiddenFor?: string[]
  updatedAt?: string
  lastMessage?: {
    id?: string
    text?: string
    senderId?: string
    timestamp?: string
    readBy?: string[]
  }
}

type ChatMessage = {
  id: string
  conversationId?: string
  text?: string
  imageUrl?: string
  senderId?: string
  timestamp?: string
  readBy?: string[]
  deliveredTo?: string[]
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

function getDefaultAvatar(gender?: string) {
  if (String(gender || '').toLowerCase() === 'female') return '/Female_Default_Profile.png'
  return '/Male_Default_Profile.png'
}

function getChatDisplayName(info?: UserInfo | null) {
  return info?.fullName?.trim()
    || info?.shopName?.trim()
    || info?.email?.trim()
    || 'User'
}

function getChatAvatar(info?: UserInfo | null) {
  return info?.photoURL
    || info?.shopImageUrl
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

function isMissingDeliveryReceipts(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === 'PGRST202'
    || error.code === 'PGRST204'
    || error.code === '42703'
    || error.code === '42883'
    || /acknowledge_chat_deliveries|mark_chat_messages_seen|deliveredTo/i.test(error.message || '')
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

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({})
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [headerDropdownOpen, setHeaderDropdownOpen] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
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

  // Auth listener
  useEffect(() => {
    const uid = auth.currentUser?.uid || null
    setUserId(uid)
    const { data: l } = supabase.auth.onAuthStateChange((_, s) => {
      setUserId(s?.user?.id ?? null)
    })
    return () => l.subscription.unsubscribe()
  }, [])

  // Acknowledge incoming messages even while the widget is minimized. This is
  // what lets the sender distinguish a stored message from one delivered to an
  // active recipient client.
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
      const customEvent = e as CustomEvent<{ userId: string }>
      const otherId = customEvent.detail?.userId
      if (otherId && userId) {
        setOpen(true)
        
        // Find if conversation already exists in DB
        const { data: existingConvs } = await supabase.from('conversations')
          .select('id')
          .contains('participants', [userId, otherId])
          .limit(1)
          
        let convId = existingConvs?.[0]?.id
        
        if (!convId) {
          // Create new conversation, Supabase generates the UUID
          const { data: newConv, error } = await supabase.from('conversations').insert({
             participants: [userId, otherId].sort(),
             updatedAt: new Date().toISOString()
          }).select('id').maybeSingle()
          
          if (newConv?.id) {
            convId = newConv.id
          } else {
            console.error('Error creating conversation:', error)
            return
          }
        }
        
        setActiveConvId(convId)
        void loadConversationsRef.current?.()
        
        // Ensure user info exists
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
      }
    }
    
    window.addEventListener('open-chat', handleOpenChat)
    return () => window.removeEventListener('open-chat', handleOpenChat)
  }, [userId])

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
  }, [])

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

      // Hydrate user info
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

      // Unread counts
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
      .channel('chat-widget-convs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        void loadConversations()
      })
      .subscribe()
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
        .from('messages')
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
        const loadedIds = new Set(mergedLoaded.map(message => message.id))
        const realtimeOnly = current.filter(message =>
          message.conversationId === conversationToLoad && !loadedIds.has(message.id)
        )
        return sortMessagesChronologically([...mergedLoaded, ...realtimeOnly]).slice(-100)
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
    if (activeConvId) void loadMessages()
    else setLoadingMessages(false)
    return () => {
      messageLoadGenerationRef.current += 1
    }
  }, [activeConvId, loadMessages])

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
    if (!activeConvId) return
    const channel = supabase
      .channel(`chat-widget-msgs-${activeConvId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversationId=eq.${activeConvId}`
      }, (payload) => {
        const eventType = String(payload.eventType || '')
        if (eventType === 'DELETE') {
          const deletedId = String((payload.old as Partial<ChatMessage> | undefined)?.id || '')
          if (deletedId) setMessages(current => current.filter(message => message.id !== deletedId))
          return
        }

        const changedMessage = payload.new as ChatMessage
        if (!changedMessage?.id || changedMessage.conversationId !== activeConvId) return
        if (eventType === 'INSERT' && (changedMessage.senderId === userId || pinToLatestRef.current)) {
          pinToLatestRef.current = true
        }
        setMessages(current => {
          const existing = current.find(message => message.id === changedMessage.id)
          if (existing && JSON.stringify(existing) === JSON.stringify(changedMessage)) return current
          return upsertChatMessage(current, changedMessage)
        })
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void loadMessages(false)
      })
    return () => { void supabase.removeChannel(channel) }
  }, [activeConvId, loadMessages, userId])

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

  // Helper: group messages by date and insert separators
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

  // Send message
  const sendMessage = async () => {
    if (!userId || !activeConvId || !chatInput.trim() || sending) return
    setSending(true)
    const text = chatInput.trim()
    setChatInput('')
    try {
      const { data: insertedMessage, error } = await supabase.from('messages').insert({
        conversationId: activeConvId,
        senderId: userId,
        text,
        readBy: [userId],
      }).select('*').single()
      if (error) throw error
      if (!insertedMessage) throw new Error('The sent message was not returned by the server.')

      const sentMessage = insertedMessage as ChatMessage
      const sentAt = sentMessage.timestamp || new Date().toISOString()
      pinToLatestRef.current = true
      initialConversationScrollRef.current = false
      setMessages(current => upsertChatMessage(current, sentMessage))

      await supabase.from('conversations').update({
        lastMessage: { id: sentMessage.id, text, senderId: userId, timestamp: sentAt, readBy: [userId] },
        updatedAt: sentAt,
      }).eq('id', activeConvId).lte('updatedAt', sentAt)

      void loadMessages(false)
      void loadConversations(false)
    } catch (error) {
      console.error('Error sending message:', error)
      setChatInput(current => current || text)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0)

  const activeConv = conversations.find(c => c.id === activeConvId)
  const otherUserId = activeConv?.participants.find(p => p !== userId) ?? null
  const otherUser = otherUserId ? userInfoMap[otherUserId] : null
  const otherName = getChatDisplayName(otherUser)
  const otherAvatar = getChatAvatar(otherUser)
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

  const filteredConvs = searchText
    ? conversations.filter(c => {
      const otherId = c.participants.find(p => p !== userId)
      const info = otherId ? userInfoMap[otherId] : null
      const searchableIdentity = [info?.fullName, info?.shopName, info?.email]
        .filter(Boolean)
        .join(' ')
      return searchableIdentity.toLowerCase().includes(searchText.toLowerCase())
    })
    : conversations

  if (!userId) return null

  return (
    <>
      {/* Floating Chat Button */}
      {!open && (
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
        <div className={`cw-panel ${isCollapsed ? 'collapsed' : ''}`}>
          
          {/* Sidebar (Left) */}
          <div className="cw-sidebar">
            <div className="cw-sidebar-header">
              <span className="cw-sidebar-title">
                Chat <span className="cw-sidebar-count">({conversations.length})</span>
              </span>
              <div className="cw-sidebar-actions">
                <button 
                  className="cw-icon-btn cw-icon-dark" 
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  title={isCollapsed ? "Show chat window" : "Show chat list only"}
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
                <button className="cw-icon-btn cw-icon-dark" onClick={() => { setOpen(false); setActiveConvId(null) }} aria-label="Minimize" title="Minimize">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <path d="M8 10l4 4 4-4" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="cw-search">
              <div className="cw-search-inner">
                <svg className="cw-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input
                  type="text"
                  placeholder="Search name"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="cw-search-input"
                />
              </div>
              <div className="cw-search-filter">
                All <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>

            <div className="cw-conv-list">
              {loading && conversations.length === 0 && <div className="cw-empty">Loading conversations...</div>}
              {!loading && filteredConvs.length === 0 && (
                <div className="cw-empty" style={{marginTop: '20px'}}>No conversations yet</div>
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
                    className={`cw-conv-item ${unread > 0 ? 'unread' : ''} ${isActive ? 'active' : ''}`}
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
                <p className="cw-welcome-title">Welcome to LifeCycle Chat</p>
                <p className="cw-welcome-sub">Select a conversation to start chatting</p>
              </div>
            ) : (
              <>
                <div className="cw-main-header" ref={dropdownRef}>
                  <div className="cw-main-header-left">
                    <img src={otherAvatar} alt="" className="cw-header-avatar" />
                    <span className="cw-main-title" onClick={() => setHeaderDropdownOpen(!headerDropdownOpen)}>
                      {otherName} <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </span>
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" style={{flexShrink: 0, marginTop: 2}}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <div className="cw-safety-text">
                      Safety tip: Always chat and complete transactions inside LifeCycle to protect yourself from scams. Do not share your personal information or contact unless it is necessary.
                      <div className="cw-safety-links">
                        <span className="cw-safety-link cw-link-blue">Learn More</span>
                        <span className="cw-safety-separator">|</span>
                        <span className="cw-safety-link cw-link-red">Report User</span>
                      </div>
                    </div>
                  </div>

                  {loadingMessages && <div className="cw-empty">Loading...</div>}
                  {!loadingMessages && messages.length === 0 && (
                    <div className="cw-empty" style={{ marginTop: '20px' }}>No messages yet. Say hello!</div>
                  )}
                  
                  {messages.map((msg, idx) => {
                    const mine = msg.senderId === userId
                    const showSeenAvatar = mine && msg.id === latestSeenOutgoingMessageId
                    const showDeliveryLabel = mine && msg.id === latestOutgoingMessageId && !showSeenAvatar
                    const deliveryLabel = otherUserId && msg.deliveredTo?.includes(otherUserId)
                      ? 'Delivered'
                      : 'Sent'
                    const dateLabel = getDateLabel(msg.timestamp)
                    const prevDateLabel = idx > 0 ? getDateLabel(messages[idx - 1].timestamp) : ''
                    const showDateSep = dateLabel && dateLabel !== prevDateLabel
                    return (
                      <div key={msg.id} className={`cw-msg-row ${mine ? 'cw-msg-row-mine' : 'cw-msg-row-other'}`}>
                        {showDateSep && (
                          <div className="cw-date-separator">
                            <span>{dateLabel}</span>
                          </div>
                        )}
                        <div className={`cw-msg ${mine ? 'cw-msg-mine' : 'cw-msg-other'}`}>
                          {!mine && <img src={otherAvatar} alt="" className="cw-msg-avatar" />}
                          <div className={`cw-msg-bubble ${mine ? 'cw-bubble-mine' : 'cw-bubble-other'}`}>
                            {msg.imageUrl && (
                              <img
                                src={msg.imageUrl}
                                alt=""
                                className="cw-msg-image"
                                onLoad={() => {
                                  if (pinToLatestRef.current) scrollToLatest('auto')
                                }}
                              />
                            )}
                            {msg.text && <p className="cw-msg-text">{msg.text}</p>}
                            <span className="cw-msg-time">{formatMsgTime(msg.timestamp)}</span>
                          </div>
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

                <div className="cw-input-area">
                  <div className="cw-input-bar">
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="Type a message here"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void sendMessage() }}
                      className="cw-input"
                    />
                  </div>
                  <div className="cw-input-tools">
                    {/* Emoji */}
                    <button className="cw-tool-btn" title="Emoji"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg></button>
                    {/* Image */}
                    <button className="cw-tool-btn" title="Image"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></button>
                    {/* Video */}
                    <button className="cw-tool-btn" title="Video"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="6" width="13" height="12" rx="2"></rect><path d="M15 10l5-3v10l-5-3"></path></svg></button>
                    {/* Sticker */}
                    <button className="cw-tool-btn" title="Sticker"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><path d="M12 8v4l3 3"></path></svg></button>
                    {/* Order */}
                    <button className="cw-tool-btn" title="Order"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg></button>
                    <div style={{flex: 1}} />
                    <button
                      className="cw-send-btn"
                      onClick={() => void sendMessage()}
                      disabled={sending || !chatInput.trim()}
                      aria-label="Send"
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
