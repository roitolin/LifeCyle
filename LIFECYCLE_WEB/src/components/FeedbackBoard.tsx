import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@/lib/supabaseDbCompat'
import { auth, db } from '@/lib/supabaseAuth'
import { hasToDate, type TimestampLike } from '@/types/supabase'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'

type RatingDoc = {
  id: string
  userId: string
  userEmail?: string | null
  displayName?: string | null
  isAnonymous?: boolean
  rating: number
  createdAt?: TimestampLike
  updatedAt?: TimestampLike
}

type FeedbackReply = {
  id: string
  userId: string
  userEmail?: string | null
  displayName?: string | null
  isAnonymous?: boolean
  text: string
  createdAt?: TimestampLike
  updatedAt?: TimestampLike
  reactions?: Record<string, string>
}

type FeedbackPost = {
  id: string
  userId: string
  userEmail?: string | null
  displayName?: string | null
  isAnonymous?: boolean
  feedback: string
  createdAt?: TimestampLike
  updatedAt?: TimestampLike
  reactions?: Record<string, string>
  replies: FeedbackReply[]
}

type EditState = {
  type: 'feedback' | 'reply'
  feedbackId: string
  replyId?: string
  initialText: string
} | null

const RATING_VALUES = [1, 2, 3, 4, 5]

function formatDateTime(timestamp: TimestampLike) {
  if (!timestamp) return 'Just now'
  const date = hasToDate(timestamp)
    ? timestamp.toDate()
    : timestamp instanceof Date || typeof timestamp === 'string' || typeof timestamp === 'number'
      ? new Date(timestamp)
      : null
  if (!date) return 'Just now'
  if (Number.isNaN(date.getTime())) return 'Just now'
  return date.toLocaleString(undefined, { hour12: true })
}

function getReactionCount(reactions?: Record<string, string>) {
  return Object.keys(reactions || {}).length
}

function FeedbackBoard() {
  const currentUser = auth.currentUser
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const [role, setRole] = useState('user')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [rating, setRating] = useState(0)
  const [ratingAnonymous, setRatingAnonymous] = useState(false)
  const [savingRating, setSavingRating] = useState(false)
  const [showRatingsList, setShowRatingsList] = useState(true)

  const [feedbackText, setFeedbackText] = useState('')
  const [postAnonymous, setPostAnonymous] = useState(false)
  const [postingFeedback, setPostingFeedback] = useState(false)

  const [ratings, setRatings] = useState<RatingDoc[]>([])
  const [feedbacks, setFeedbacks] = useState<FeedbackPost[]>([])

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [replyInputByPost, setReplyInputByPost] = useState<Record<string, string>>({})
  const [replyAnonymousByPost, setReplyAnonymousByPost] = useState<Record<string, boolean>>({})
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null)

  const [editState, setEditState] = useState<EditState>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [bannerMessage, setBannerMessage] = useState('')

  const isSuperAdmin = useMemo(() => String(role).toLowerCase() === 'super_admin', [role])
  const canModerate = useMemo(() => ['admin', 'super_admin'].includes(String(role).toLowerCase()), [role])

  const canManage = useCallback(
    (ownerUserId: string) => Boolean(currentUser?.uid) && (ownerUserId === currentUser?.uid || canModerate),
    [currentUser?.uid, canModerate],
  )

  const getIdentity = useCallback(async () => {
    if (!currentUser) return null
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid))
    const data = userDoc.data() as { fullName?: string; role?: string } | undefined
    return {
      userId: currentUser.uid,
      userEmail: currentUser.email || null,
      displayName: data?.fullName || currentUser.email || 'User',
      role: String(data?.role || 'user').toLowerCase(),
    }
  }, [currentUser])

  const loadBoard = useCallback(async () => {
    if (!currentUser) {
      setRatings([])
      setFeedbacks([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    try {
      setLoading(true)

      const identity = await getIdentity()
      if (identity?.role) setRole(identity.role)

      const ratingsQuery = query(collection(db, 'app_ratings'), orderBy('updatedAt', 'desc'))
      const ratingsSnap = await getDocs(ratingsQuery)
      const ratingsList = ratingsSnap.docs.map((ratingDoc: any) => ({
        id: ratingDoc.id,
        ...(ratingDoc.data() as Omit<RatingDoc, 'id'>),
      })) as RatingDoc[]
      setRatings(ratingsList)

      const mine = ratingsList.find((item) => item.userId === currentUser.uid)
      if (mine) {
        setRating(Number(mine.rating) || 0)
        setRatingAnonymous(Boolean(mine.isAnonymous))
      } else {
        setRating(0)
        setRatingAnonymous(false)
      }

      const feedbackQuery = query(collection(db, 'app_feedback'), orderBy('createdAt', 'desc'))
      const feedbackSnap = await getDocs(feedbackQuery)

      const feedbackList = await Promise.all(
        feedbackSnap.docs.map(async (feedbackDoc: any) => {
          const feedbackData = feedbackDoc.data() as Omit<FeedbackPost, 'id' | 'replies'>
          const repliesQuery = query(collection(db, 'app_feedback', feedbackDoc.id, 'replies'), orderBy('createdAt', 'asc'))
          const repliesSnap = await getDocs(repliesQuery)
          const replies = repliesSnap.docs.map((replyDoc: any) => ({
            id: replyDoc.id,
            ...(replyDoc.data() as Omit<FeedbackReply, 'id'>),
          })) as FeedbackReply[]

          return {
            id: feedbackDoc.id,
            ...feedbackData,
            replies,
          } as FeedbackPost
        }),
      )

      setFeedbacks(feedbackList)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [currentUser, getIdentity])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  const showBanner = (message: string) => {
    setBannerMessage(message)
    window.setTimeout(() => setBannerMessage(''), 2200)
  }

  const saveMyRating = async () => {
    if (isSuperAdmin) {
      showBanner('Superadmin accounts cannot submit ratings.')
      return
    }

    const identity = await getIdentity()
    if (!identity) return

    setSavingRating(true)
    try {
      if (rating < 1) {
        await deleteDoc(doc(db, 'app_ratings', identity.userId))
        showBanner('Rating removed.')
        await loadBoard()
        return
      }

      await setDoc(
        doc(db, 'app_ratings', identity.userId),
        {
          userId: identity.userId,
          userEmail: identity.userEmail,
          displayName: identity.displayName,
          isAnonymous: ratingAnonymous,
          rating,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      showBanner('Rating saved.')
      await loadBoard()
    } finally {
      setSavingRating(false)
    }
  }

  const removeMyRating = async () => {
    const identity = await getIdentity()
    if (!identity) return
    await deleteDoc(doc(db, 'app_ratings', identity.userId))
    setRating(0)
    setRatingAnonymous(false)
    showBanner('Rating removed.')
    await loadBoard()
  }

  const submitFeedback = async () => {
    if (!feedbackText.trim()) {
      showBanner('Please write feedback first.')
      return
    }

    const identity = await getIdentity()
    if (!identity) return

    setPostingFeedback(true)
    try {
      await addDoc(collection(db, 'app_feedback'), {
        userId: identity.userId,
        userEmail: identity.userEmail,
        displayName: identity.displayName,
        isAnonymous: postAnonymous,
        feedback: feedbackText.trim(),
        reactions: {},
        createdAt: serverTimestamp(),
        updatedAt: null,
      })

      setFeedbackText('')
      setPostAnonymous(false)
      showBanner('Feedback posted.')
      await loadBoard()
    } finally {
      setPostingFeedback(false)
    }
  }

  const toggleFeedbackReaction = async (feedbackItem: FeedbackPost) => {
    if (!currentUser?.uid) return

    const currentReactions = feedbackItem.reactions || {}
    const nextReactions = { ...currentReactions }

    if (nextReactions[currentUser.uid]) delete nextReactions[currentUser.uid]
    else nextReactions[currentUser.uid] = 'like'

    await updateDoc(doc(db, 'app_feedback', feedbackItem.id), {
      reactions: nextReactions,
    })

    await loadBoard()
  }

  const toggleReplyReaction = async (feedbackId: string, reply: FeedbackReply) => {
    if (!currentUser?.uid) return

    const currentReactions = reply.reactions || {}
    const nextReactions = { ...currentReactions }

    if (nextReactions[currentUser.uid]) delete nextReactions[currentUser.uid]
    else nextReactions[currentUser.uid] = 'like'

    await updateDoc(doc(db, 'app_feedback', feedbackId, 'replies', reply.id), {
      reactions: nextReactions,
    })

    await loadBoard()
  }

  const submitReply = async (feedbackId: string) => {
    const replyText = (replyInputByPost[feedbackId] || '').trim()
    if (!replyText) return

    const identity = await getIdentity()
    if (!identity) return

    setReplySubmittingPostId(feedbackId)
    try {
      await addDoc(collection(db, 'app_feedback', feedbackId, 'replies'), {
        userId: identity.userId,
        userEmail: identity.userEmail,
        displayName: identity.displayName,
        isAnonymous: Boolean(replyAnonymousByPost[feedbackId]),
        text: replyText,
        reactions: {},
        createdAt: serverTimestamp(),
        updatedAt: null,
      })

      setReplyInputByPost((prev) => ({ ...prev, [feedbackId]: '' }))
      setReplyAnonymousByPost((prev) => ({ ...prev, [feedbackId]: false }))
      setExpandedReplies((prev) => ({ ...prev, [feedbackId]: true }))
      showBanner('Reply posted.')
      await loadBoard()
    } finally {
      setReplySubmittingPostId(null)
    }
  }

  const promptDeleteFeedback = async (feedbackId: string) => {
    openConfirm({
      title: 'Delete Feedback',
      message: 'Delete this feedback and all replies?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        const repliesSnap = await getDocs(collection(db, 'app_feedback', feedbackId, 'replies'))
        await Promise.all(repliesSnap.docs.map((item: any) => deleteDoc(item.ref)))
        await deleteDoc(doc(db, 'app_feedback', feedbackId))
        showBanner('Feedback deleted.')
        await loadBoard()
      },
    })
  }

  const promptDeleteReply = async (feedbackId: string, replyId: string) => {
    openConfirm({
      title: 'Delete Reply',
      message: 'Delete this reply?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        await deleteDoc(doc(db, 'app_feedback', feedbackId, 'replies', replyId))
        showBanner('Reply deleted.')
        await loadBoard()
      },
    })
  }

  const openEditDialog = (state: EditState) => {
    setEditState(state)
    setEditText(state?.initialText || '')
  }

  const saveEdit = async () => {
    if (!editState || !editText.trim()) return
    setSavingEdit(true)
    try {
      if (editState.type === 'feedback') {
        await updateDoc(doc(db, 'app_feedback', editState.feedbackId), {
          feedback: editText.trim(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await updateDoc(doc(db, 'app_feedback', editState.feedbackId, 'replies', editState.replyId || ''), {
          text: editText.trim(),
          updatedAt: serverTimestamp(),
        })
      }

      setEditState(null)
      setEditText('')
      showBanner('Changes saved.')
      await loadBoard()
    } finally {
      setSavingEdit(false)
    }
  }

  const averageRating = useMemo(() => {
    if (ratings.length === 0) return 0
    const total = ratings.reduce((sum, entry) => sum + (Number(entry.rating) || 0), 0)
    return total / ratings.length
  }, [ratings])

  const ratingByUserId = useMemo(() => {
    const entries: Record<string, number> = {}
    ratings.forEach((entry) => {
      if (entry.userId) entries[entry.userId] = Number(entry.rating) || 0
    })
    return entries
  }, [ratings])

  return (
    <section className="panel feedback-mobile-web">
      <h2>Rate & Feedback</h2>
      <p className="panel-sub">One rating per user, unlimited feedback posts and replies.</p>
      {bannerMessage ? <p className="auth-message auth-message-info">{bannerMessage}</p> : null}

      <article className="feedback-mobile-card">
        <div className="feedback-summary-row">
          <span>Feedback Posts: {feedbacks.length}</span>
          <span>Ratings: {ratings.length}</span>
          <span>Average: {averageRating.toFixed(1)}/5</span>
        </div>

        <h3>Your App Rating</h3>
        {isSuperAdmin ? <p className="panel-sub">Superadmin can read ratings but cannot submit one.</p> : null}

        <p className="panel-sub">Tap the same star again to clear your rating.</p>
        <div className="rating-picker-row" style={{ opacity: isSuperAdmin ? 0.6 : 1 }}>
          {RATING_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              className={`rating-star-btn${value <= rating ? ' active' : ''}`}
              onClick={() => {
                if (isSuperAdmin) return
                if (rating === value) {
                  void removeMyRating()
                  return
                }
                setRating(value)
              }}
              disabled={isSuperAdmin}
              aria-label={`Rate ${value}`}
            >
              {'\u2605'}
            </button>
          ))}
        </div>

        <label className="checkbox-row" htmlFor="rating-anon">
          <input id="rating-anon" type="checkbox" checked={ratingAnonymous} onChange={(event) => setRatingAnonymous(event.target.checked)} disabled={isSuperAdmin} />
          <span>Show this rating as anonymous</span>
        </label>

        <div className="quick-actions" style={{ marginTop: '8px' }}>
          <button type="button" className="solid-btn" onClick={() => void saveMyRating()} disabled={savingRating || isSuperAdmin}>
            {savingRating ? 'Saving...' : 'Save My Rating'}
          </button>
        </div>

        <hr className="feedback-divider" />

        <div className="feedback-section-head">
          <h3>Community Ratings</h3>
          <button type="button" className="ghost-btn table-action" onClick={() => setShowRatingsList((prev) => !prev)}>
            {showRatingsList ? 'Hide' : 'Show'}
          </button>
        </div>

        {!showRatingsList ? <p className="panel-sub">Ratings are hidden. Tap Show to view.</p> : null}
        {showRatingsList && ratings.length === 0 ? <p className="panel-sub">No ratings yet.</p> : null}

        {showRatingsList ? (
          <div className="feedback-rating-list">
            {ratings.map((item) => {
              const ratingValue = Math.max(1, Math.min(5, Number(item.rating) || 0))
              const name = item.isAnonymous ? 'Anonymous' : item.displayName || item.userEmail || 'User'
              return (
                <article key={item.id} className="feedback-rating-row">
                  <div className="feedback-rating-head">
                    <strong>{name}</strong>
                    <span>{formatDateTime(item.updatedAt || item.createdAt)}</span>
                  </div>
                  <p>{'\u2605'.repeat(ratingValue)}{'\u2606'.repeat(5 - ratingValue)} ({ratingValue}/5)</p>
                </article>
              )
            })}
          </div>
        ) : null}

        <hr className="feedback-divider" />

        <h3>Post Feedback</h3>
        <textarea
          className="app-textarea"
          placeholder="Write your feedback"
          value={feedbackText}
          onChange={(event) => setFeedbackText(event.target.value)}
        />

        <label className="checkbox-row" htmlFor="post-anon">
          <input id="post-anon" type="checkbox" checked={postAnonymous} onChange={(event) => setPostAnonymous(event.target.checked)} />
          <span>Post feedback anonymously</span>
        </label>

        <div className="quick-actions" style={{ marginTop: '8px' }}>
          <button type="button" className="solid-btn" onClick={() => void submitFeedback()} disabled={postingFeedback}>
            {postingFeedback ? 'Posting...' : 'Post Feedback'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => { setRefreshing(true); void loadBoard() }} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </article>

      {loading ? <p className="panel-sub">Loading ratings and feedback...</p> : null}

      <div className="notification-list" style={{ marginTop: '12px' }}>
        {feedbacks.length === 0 ? <p className="panel-sub">No feedback yet.</p> : null}
        {feedbacks.map((item) => {
          const feedbackName = item.isAnonymous ? 'Anonymous' : item.displayName || item.userEmail || 'User'
          const userRating = ratingByUserId[item.userId]
          const reactionCount = getReactionCount(item.reactions)
          const isExpanded = Boolean(expandedReplies[item.id])
          const editable = canManage(item.userId)
          const replyText = replyInputByPost[item.id] || ''
          const replyAnonymous = Boolean(replyAnonymousByPost[item.id])

          return (
            <article key={item.id} className="notification-item feedback-post-card">
              <div className="feedback-post-head">
                <h3>{feedbackName}</h3>
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
              <p className="feedback-post-rating">{userRating > 0 ? `App Rating: ${userRating}/5` : 'App Rating: No rating yet'}</p>
              <p>{item.feedback}</p>
              {item.updatedAt ? <span>Edited</span> : null}

              <div className="request-actions" style={{ marginTop: '8px' }}>
                <button type="button" className="ghost-btn table-action" onClick={() => void toggleFeedbackReaction(item)}>
                  Like ({reactionCount})
                </button>
                <button type="button" className="ghost-btn table-action" onClick={() => setExpandedReplies((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}>
                  {isExpanded ? `Hide Replies (${item.replies.length})` : `Replies (${item.replies.length})`}
                </button>
                {editable ? (
                  <button
                    type="button"
                    className="ghost-btn table-action"
                    onClick={() =>
                      openEditDialog({
                        type: 'feedback',
                        feedbackId: item.id,
                        initialText: item.feedback,
                      })
                    }
                  >
                    Edit
                  </button>
                ) : null}
                {editable ? (
                  <button type="button" className="ghost-btn table-action" onClick={() => void promptDeleteFeedback(item.id)}>
                    Delete
                  </button>
                ) : null}
              </div>

              {isExpanded ? (
                <div className="admin-feedback-replies">
                  {item.replies.length === 0 ? <p className="panel-sub">No replies yet.</p> : null}
                  {item.replies.map((reply) => {
                    const replyName = reply.isAnonymous ? 'Anonymous' : reply.displayName || reply.userEmail || 'User'
                    const editableReply = canManage(reply.userId)
                    return (
                      <div key={reply.id} className="admin-feedback-reply-item">
                        <div className="feedback-post-head">
                          <strong>{replyName}</strong>
                          <span>{formatDateTime(reply.createdAt)}</span>
                        </div>
                        <p>{reply.text}</p>
                        {reply.updatedAt ? <span>Edited</span> : null}
                        <div className="request-actions" style={{ marginTop: '6px' }}>
                          <button type="button" className="ghost-btn table-action" onClick={() => void toggleReplyReaction(item.id, reply)}>
                            Like ({getReactionCount(reply.reactions)})
                          </button>
                          {editableReply ? (
                            <button
                              type="button"
                              className="ghost-btn table-action"
                              onClick={() =>
                                openEditDialog({
                                  type: 'reply',
                                  feedbackId: item.id,
                                  replyId: reply.id,
                                  initialText: reply.text,
                                })
                              }
                            >
                              Edit
                            </button>
                          ) : null}
                          {editableReply ? (
                            <button type="button" className="ghost-btn table-action" onClick={() => void promptDeleteReply(item.id, reply.id)}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}

                  <textarea
                    className="app-textarea"
                    placeholder="Write a reply..."
                    value={replyText}
                    onChange={(event) => setReplyInputByPost((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  />
                  <label className="checkbox-row" htmlFor={`reply-anon-${item.id}`}>
                    <input
                      id={`reply-anon-${item.id}`}
                      type="checkbox"
                      checked={replyAnonymous}
                      onChange={(event) => setReplyAnonymousByPost((prev) => ({ ...prev, [item.id]: event.target.checked }))}
                    />
                    <span>Reply anonymously</span>
                  </label>
                  <div className="quick-actions" style={{ marginTop: '8px' }}>
                    <button
                      type="button"
                      className="solid-btn"
                      onClick={() => void submitReply(item.id)}
                      disabled={replySubmittingPostId === item.id || !replyText.trim()}
                    >
                      {replySubmittingPostId === item.id ? 'Replying...' : 'Reply'}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>

      {editState ? (
        <div className="ban-overlay" role="dialog" aria-modal="true" aria-label="Edit feedback content">
          <div className="ban-card">
            <h2>Edit</h2>
            <textarea className="app-textarea" value={editText} onChange={(event) => setEditText(event.target.value)} />
            <div className="ban-actions">
              <button type="button" className="ghost-btn" onClick={() => setEditState(null)}>Cancel</button>
              <button type="button" className="solid-btn" onClick={() => void saveEdit()} disabled={savingEdit || !editText.trim()}>
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </section>
  )
}

export default FeedbackBoard

