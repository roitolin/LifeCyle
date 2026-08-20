import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { APP_ICON_TRANSPARENT_URL } from '@/assets/appIconAssets'
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'
import { toDate, toMillis } from './adminHelpers'

type Conversation = {
  id: string
  participants: string[]
  hiddenFor?: string[]
  updatedAt?: unknown
  lastMessage?: {
    text?: string
    senderId?: string
    timestamp?: unknown
    readBy?: string[]
  }
}

type ChatMessage = {
  id: string
  text?: string
  senderId?: string
  timestamp?: unknown
  readBy?: string[]
}

type UserInfo = {
  fullName?: string
  email?: string
  photoURL?: string
  gender?: string
}

function getDefaultAvatar(gender?: string) {
  if (String(gender || '').toLowerCase() === 'female') return '/Female_Default_Profile.png'
  return '/Male_Default_Profile.png'
}

function formatTime(value: unknown) {
  const parsed = toDate(value)
  if (!parsed) return ''
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

function AdminSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [userInfoMap, setUserInfoMap] = useState<Record<string, UserInfo>>({})
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [chatInput, setChatInput] = useState('')
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const adminId = auth.currentUser?.uid || ''
  const activeConversationId = searchParams.get('conversation') || ''
  const activeConversation = conversations.find((item) => item.id === activeConversationId) || null

  const hydrateConversationMeta = useCallback(async (list: Conversation[]) => {
    if (!adminId) return

    const otherIds = Array.from(
      new Set(
        list
          .map((item) => item.participants?.find((participantId) => participantId !== adminId))
          .filter(Boolean) as string[],
      ),
    )

    const nextUserInfo: Record<string, UserInfo> = {}
    await Promise.all(
      otherIds.map(async (otherId) => {
        try {
          const userSnap = await getDoc(doc(db, 'users', otherId))
          nextUserInfo[otherId] = (userSnap.data() as UserInfo) || {}
        } catch {
          nextUserInfo[otherId] = {}
        }
      }),
    )
    setUserInfoMap(nextUserInfo)

    const nextUnread: Record<string, number> = {}
    await Promise.all(
      list.map(async (conversationItem) => {
        const otherId = conversationItem.participants.find((participantId) => participantId !== adminId)
        if (!otherId) {
          nextUnread[conversationItem.id] = 0
          return
        }

        const messagesSnap = await getDocs(
          query(collection(db, 'conversations', conversationItem.id, 'messages'), where('senderId', '==', otherId)),
        )
        let unread = 0
        messagesSnap.docs.forEach((messageDoc: any) => {
          const messageData = messageDoc.data() as { readBy?: string[] }
          if (!Array.isArray(messageData.readBy) || !messageData.readBy.includes(adminId)) unread += 1
        })
        nextUnread[conversationItem.id] = unread
      }),
    )
    setUnreadCounts(nextUnread)
  }, [adminId])

  useEffect(() => {
    if (!adminId) {
      setConversations([])
      setMessages([])
      setUnreadCounts({})
      setUserInfoMap({})
      setLoading(false)
      return
    }

    setLoading(true)
    const conversationsQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', adminId))
    const unsubscribe = onSnapshot(
      conversationsQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<Conversation, 'id'>) }))
          .filter((item: any) => !item.hiddenFor?.includes(adminId))
          .sort((a: any, b: any) => toMillis(b.updatedAt) - toMillis(a.updatedAt))

        setConversations(list)
        void hydrateConversationMeta(list)

        if (activeConversationId && !list.some((item: any) => item.id === activeConversationId)) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.delete('conversation')
            return next
          })
        } else if (!activeConversationId && list[0]?.id) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('conversation', list[0].id)
            return next
          })
        }

        setLoading(false)
      },
      () => {
        setConversations([])
        setUnreadCounts({})
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [activeConversationId, adminId, hydrateConversationMeta, setSearchParams])

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([])
      setLoadingMessages(false)
      return
    }

    setLoadingMessages(true)
    const messagesQuery = query(collection(db, 'conversations', activeConversationId, 'messages'), orderBy('timestamp', 'asc'))
    const unsubscribe = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const list = snapshot.docs.map((itemDoc: any) => ({ id: itemDoc.id, ...(itemDoc.data() as Omit<ChatMessage, 'id'>) }))
        setMessages(list)
        setLoadingMessages(false)
      },
      () => {
        setMessages([])
        setLoadingMessages(false)
      },
    )

    return () => unsubscribe()
  }, [activeConversationId])

  const conversationItems = useMemo(() => {
    return conversations.map((item) => {
      const otherId = item.participants.find((participantId) => participantId !== adminId) || ''
      const profile = userInfoMap[otherId]
      const title = profile?.fullName || profile?.email || `User ${otherId.slice(0, 6)}`
      return {
        ...item,
        otherId,
        title,
        avatarSrc: profile?.photoURL?.trim() || getDefaultAvatar(profile?.gender),
        preview: item.lastMessage?.text || 'No messages yet',
        time: formatTime(item.lastMessage?.timestamp),
        unread: unreadCounts[item.id] || 0,
      }
    })
  }, [conversations, adminId, userInfoMap, unreadCounts])

  const setConversationReadState = async (conversationId: string, otherUserId: string, shouldRead: boolean) => {
    if (!adminId) return

    const messagesRef = collection(db, 'conversations', conversationId, 'messages')
    const messagesSnap = await getDocs(query(messagesRef, where('senderId', '==', otherUserId)))

    const batch = writeBatch()
    messagesSnap.docs.forEach((itemDoc: any) => {
      if (shouldRead) batch.update(itemDoc.ref, { readBy: arrayUnion(adminId) })
      else batch.update(itemDoc.ref, { readBy: arrayRemove(adminId) })
    })
    await batch.commit()

    const conversationRef = doc(db, 'conversations', conversationId)
    if (shouldRead) {
      await updateDoc(conversationRef, { 'lastMessage.readBy': arrayUnion(adminId) })
    } else {
      await updateDoc(conversationRef, { 'lastMessage.readBy': arrayRemove(adminId) })
    }

  }

  const deleteConversation = async (conversationId: string) => {
    if (!adminId) return
    const conversationRef = doc(db, 'conversations', conversationId)
    await updateDoc(conversationRef, { hiddenFor: arrayUnion(adminId) })

    const messagesRef = collection(db, 'conversations', conversationId, 'messages')
    const messagesSnap = await getDocs(messagesRef)
    if (!messagesSnap.empty) {
      const batch = writeBatch()
      messagesSnap.docs.forEach((itemDoc: any) => batch.delete(itemDoc.ref))
      await batch.commit()
    }

    await deleteDoc(conversationRef)
    if (conversationId === activeConversationId) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('conversation')
        return next
      })
    }
  }

  const confirmDeleteConversation = (conversationId: string, title: string) => {
    openConfirm({
      title: 'Delete Conversation',
      message: `Delete the conversation with ${title}? This will permanently remove the conversation and all of its messages.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => void deleteConversation(conversationId),
    })
  }

  const sendMessage = async () => {
    if (!adminId || !activeConversationId || !chatInput.trim() || sending) return

    const text = chatInput.trim()
    setSending(true)
    try {
      await addDoc(collection(db, 'conversations', activeConversationId, 'messages'), {
        text,
        senderId: adminId,
        timestamp: serverTimestamp(),
        readBy: [adminId],
      })

      await updateDoc(doc(db, 'conversations', activeConversationId), {
        updatedAt: serverTimestamp(),
        hiddenFor: arrayRemove(
          adminId,
          activeConversation?.participants.find((participantId) => participantId !== adminId) || '',
        ),
        lastMessage: {
          text,
          senderId: adminId,
          timestamp: serverTimestamp(),
          readBy: [adminId],
        },
      })

      const receiverId = activeConversation?.participants.find((participantId) => participantId !== adminId) || ''
      if (receiverId) {
        await addDoc(collection(db, 'notifications'), {
          userId: receiverId,
          type: 'support_message',
          title: 'New Support Reply',
          body: text.length > 100 ? `${text.slice(0, 100)}...` : text,
          read: false,
          createdAt: serverTimestamp(),
          data: { conversationId: activeConversationId, otherUserId: adminId },
        })
      }

      setChatInput('')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="panel">
      <h2>Support Inbox</h2>
      <p className="panel-sub">Open conversations and reply directly to users.</p>

      <div className="admin-support-grid">
        <div className="admin-support-list">
          {loading ? <p className="panel-sub">Loading conversations...</p> : null}
          {!loading && conversationItems.length === 0 ? <p className="panel-sub">No support conversations yet.</p> : null}
          {conversationItems.map((item) => {
            const active = item.id === activeConversationId
            return (
              <article key={item.id} className={`admin-conversation-card${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="admin-conversation-main"
                  onClick={() => {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev)
                      next.set('conversation', item.id)
                      return next
                    })
                  }}
                >
                  <img src={item.avatarSrc} alt={item.title} className="chat-avatar" />
                  <div className="admin-conversation-copy">
                    <h3>{item.title}</h3>
                    <p>{item.preview}</p>
                    <span>{item.time}</span>
                  </div>
                </button>

                <div className="request-actions" style={{ marginTop: '6px' }}>
                  <Link to={`/admin/users/${item.otherId}`} className="ghost-btn btn-link table-action">View Profile</Link>
                  <button type="button" className="ghost-btn table-action" onClick={() => void setConversationReadState(item.id, item.otherId, true)}>Read</button>
                  <button type="button" className="ghost-btn table-action" onClick={() => void setConversationReadState(item.id, item.otherId, false)}>Unread</button>
                  <button type="button" className="ghost-btn table-action" onClick={() => confirmDeleteConversation(item.id, item.title)}>Delete</button>
                  {item.unread > 0 ? <span className="feed-badge-pill">Unread: {item.unread}</span> : null}
                </div>
              </article>
            )
          })}
        </div>

        <div className="admin-support-thread">
          {!activeConversation ? <p className="panel-sub">Select a conversation to view thread.</p> : null}
          {activeConversation ? (
            <>
              <div className="messages-thread-list admin-thread-list">
                {loadingMessages ? <p className="panel-sub">Loading chat...</p> : null}
                {!loadingMessages && messages.length === 0 ? <p className="panel-sub">No messages yet.</p> : null}
                {messages.map((item) => {
                  const mine = item.senderId === adminId
                  const otherProfile = activeConversation?.participants
                    ?.find((participantId) => participantId !== adminId)
                    ? userInfoMap[activeConversation.participants.find((participantId) => participantId !== adminId) || '']
                    : null
                  const avatarSrc = mine
                    ? auth.currentUser?.photoURL || APP_ICON_TRANSPARENT_URL
                    : otherProfile?.photoURL?.trim() || getDefaultAvatar(otherProfile?.gender)
                  return (
                    <div key={item.id} className={`thread-row${mine ? ' mine' : ''}`}>
                      {!mine ? <img src={avatarSrc} alt="" className="chat-avatar thread-avatar" /> : null}
                      <article className={`thread-bubble${mine ? ' mine' : ''}`}>
                        <p>{item.text || ''}</p>
                        <span>{formatTime(item.timestamp)}</span>
                      </article>
                      {mine ? <img src={avatarSrc} alt="" className="chat-avatar thread-avatar" /> : null}
                    </div>
                  )
                })}
              </div>

              <div className="messages-thread-input">
                <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Type a message..." />
                <button type="button" className="message-send-icon-btn" onClick={() => void sendMessage()} disabled={sending || !chatInput.trim()} aria-label="Send message">
                  {sending ? (
                    <span className="message-send-dots" aria-hidden="true">...</span>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 20L21 12L3 4L3.01 10L16 12L3.01 14L3 20Z" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {confirmDialog}
    </section>
  )
}

export default AdminSupportPage

