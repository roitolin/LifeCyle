import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { FeedbackSkeleton, SkeletonBlock } from '@/components/ContentSkeleton'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { MAX_FEEDBACK_LENGTH, editFeedbackEntry, feedbackSources, fetchFeedbackBoard, notifyFeedbackAdmins, removeFeedbackEntry, saveFeedbackRating, saveFeedbackReaction, submitFeedbackPost, submitFeedbackReply, type FeedbackPost, type FeedbackReply, type RatingDoc } from '@/utils/feedbackBoard'
import ProfileLayout from './ProfileLayout'
import FeedbackBoard, { FeedbackRatingBreakdown } from './feedback/FeedbackBoard'
import FeedbackThread, { FeedbackAvatar } from './feedback/FeedbackThread'
import './FeedbackPage.css'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'

const RATING_VALUES = [1, 2, 3, 4, 5]

const formatDateTime = (ts: string) => {
  if (!ts) return 'Just now'
  return new Date(ts).toLocaleString(undefined, { hour12: true })
}

function FeedbackSummary({ posts, ratings, loading }: { posts: FeedbackPost[]; ratings: RatingDoc[]; loading: boolean }) {
  const unanswered = posts.filter(post => post.replies.length === 0).length
  const replyCount = posts.reduce((total, post) => total + post.replies.length, 0)
  const averageRating = ratings.length > 0
    ? (ratings.reduce((total, item) => total + item.rating, 0) / ratings.length).toFixed(1)
    : null
  const metrics = [
    { label: 'Feedback posts', value: posts.length },
    { label: 'Unanswered', value: unanswered },
    { label: 'Total replies', value: replyCount },
    { label: 'Average rating', value: averageRating === null ? (
      <><span className="sr-only">No ratings yet</span><span aria-hidden="true">—</span></>
    ) : <>{averageRating} <span className="fb-summary-scale">/ 5</span></> },
  ]

  return (
    <dl className={loading ? 'fb-summary lc-skeleton' : 'fb-summary'} aria-label="Feedback summary" aria-hidden={loading || undefined}>
      {metrics.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{loading ? <SkeletonBlock className="fb-summary-placeholder lc-skeleton-preview" /> : value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function FeedbackPage({ adminMode = false }: { adminMode?: boolean }) {
  const [viewerId, setViewerId] = useState<string | null>()
  const [canModerate, setCanModerate] = useState(false)
  const [canRate, setCanRate] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [boardLoaded, setBoardLoaded] = useState(false)

  const [rating, setRating] = useState(0)
  const [savedRating, setSavedRating] = useState(0)
  const [ratingAnonymous, setRatingAnonymous] = useState(false)
  const [savingRating, setSavingRating] = useState(false)
  const [showRatingsList, setShowRatingsList] = useState(false)

  const [feedbackText, setFeedbackText] = useState('')
  const [postAnonymous, setPostAnonymous] = useState(false)
  const [postingFeedback, setPostingFeedback] = useState(false)

  const [ratings, setRatings] = useState<RatingDoc[]>([])
  const [feedbacks, setFeedbacks] = useState<FeedbackPost[]>([])
  const [loading, setLoading] = useState(true)

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [replyInputByPost, setReplyInputByPost] = useState<Record<string, string>>({})
  const [replyAnonymousByPost, setReplyAnonymousByPost] = useState<Record<string, boolean>>({})
  const [replyTargetByPost, setReplyTargetByPost] = useState<Record<string, string | null>>({})
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null)

  const [editState, setEditState] = useState<{ type: 'feedback' | 'reply'; feedbackId: string; replyId?: string; initialText: string } | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [snackbar, setSnackbar] = useState('')
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const canManage = (item: FeedbackPost | FeedbackReply) => item.mine || canModerate
  const loadGeneration = useRef(0)
  const locks = useRef(new Set<string>())
  const feedbackComposer = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_, session) => setViewerId(session?.user.id ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  const loadBoard = useCallback(async (syncRating = false) => {
    if (!viewerId) return
    const generation = ++loadGeneration.current
    try {
      const board = await fetchFeedbackBoard()
      if (generation !== loadGeneration.current) return
      setRatings(board.ratings)
      setFeedbacks(board.posts)
      setCanModerate(board.canModerate)
      setCanRate(board.canRate)
      setSavedRating(board.myRating?.rating ?? 0)
      setBoardLoaded(true)
      if (syncRating) {
        setRating(board.myRating?.rating ?? 0)
        setRatingAnonymous(board.myRating?.isAnonymous ?? false)
      }
      setLoadError('')
    } catch {
      if (generation === loadGeneration.current) setLoadError('Could not load feedback. Please try again.')
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [viewerId])

  useEffect(() => {
    if (viewerId === undefined) return
    setLoading(Boolean(viewerId))
    setBoardLoaded(false)
    if (viewerId) void loadBoard(true)
    else {
      setRatings([])
      setFeedbacks([])
      setLoadError('Sign in to view feedback.')
    }
    return () => { loadGeneration.current += 1 }
  }, [viewerId, loadBoard])

  useRealtimeRefresh(feedbackSources, () => loadBoard(), Boolean(viewerId) && !loading)

  const showSnack = (msg: string) => { setSnackbar(msg); setTimeout(() => setSnackbar(''), 2500) }
  const runAction = async (key: string, title: string, action: () => Promise<void>) => {
    if (locks.current.has(key)) return
    locks.current.add(key)
    try {
      await action()
    } catch (error) {
      openAlert({ title, message: error instanceof Error ? error.message : 'Please try again.', tone: 'danger', okLabel: 'Dismiss' })
    } finally {
      locks.current.delete(key)
    }
  }

  const saveMyRating = (value: number) => runAction('rating', 'Rating could not be saved', async () => {
    if (!viewerId || !canRate) return
    setSavingRating(true)
    try {
      await saveFeedbackRating(value, ratingAnonymous)
      setSavedRating(value)
      if (value === 0) {
        setRating(0)
        setRatingAnonymous(false)
      }
      showSnack(value === 0 ? 'Rating removed.' : 'Rating saved.')
      void notifyFeedbackAdmins('rating_update')
      await loadBoard()
    } finally { setSavingRating(false) }
  })

  const submitFeedback = () => runAction('post', 'Feedback could not be posted', async () => {
    const text = feedbackText.trim()
    if (!viewerId || !text) return
    setPostingFeedback(true)
    try {
      const post = await submitFeedbackPost(viewerId, text, postAnonymous)
      setFeedbackText('')
      setPostAnonymous(false)
      showSnack('Feedback posted.')
      void notifyFeedbackAdmins('feedback_new', post.id)
      await loadBoard()
    } finally { setPostingFeedback(false) }
  })

  const toggleReaction = (kind: 'post' | 'reply', item: FeedbackPost | FeedbackReply) =>
    runAction('reaction-' + item.id, 'Reaction could not be saved', async () => {
      await saveFeedbackReaction(kind, item.id, !item.liked)
      await loadBoard()
    })

  const submitReply = (feedbackId: string, parentReplyId?: string | null) => runAction('reply', 'Reply could not be posted', async () => {
    const text = (replyInputByPost[feedbackId] || '').trim()
    if (!viewerId || !text) return
    setReplySubmittingPostId(feedbackId)
    try {
      await submitFeedbackReply(viewerId, feedbackId, text, Boolean(replyAnonymousByPost[feedbackId]), parentReplyId)
      setReplyInputByPost(prev => ({ ...prev, [feedbackId]: '' }))
      setReplyAnonymousByPost(prev => ({ ...prev, [feedbackId]: false }))
      setReplyTargetByPost(prev => ({ ...prev, [feedbackId]: null }))
      setExpandedReplies(prev => ({ ...prev, [feedbackId]: true }))
      showSnack('Reply posted.')
      await loadBoard()
    } finally { setReplySubmittingPostId(null) }
  })

  const deleteEntry = (kind: 'post' | 'reply', id: string) => {
    const label = kind === 'post' ? 'Feedback' : 'Reply'
    openConfirm({
      title: 'Delete ' + label,
      message: kind === 'post' ? 'Delete this feedback and all replies?' : 'Delete this reply?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => runAction('delete-' + id, label + ' could not be deleted', async () => {
        await removeFeedbackEntry(kind, id)
        showSnack(label + ' deleted.')
        await loadBoard()
      }),
    })
  }

  const saveEdit = () => runAction('edit', 'Changes could not be saved', async () => {
    const text = editText.trim()
    if (!editState || !text) return
    const id = editState.type === 'feedback' ? editState.feedbackId : editState.replyId
    if (!id) return
    setSavingEdit(true)
    try {
      await editFeedbackEntry(editState.type === 'feedback' ? 'post' : 'reply', id, text)
      setEditState(null)
      setEditText('')
      showSnack('Changes saved.')
      await loadBoard()
    } finally { setSavingEdit(false) }
  })

  const writeButton = (loading || boardLoaded) && (
    <button type="button" className="fb-write-button" disabled={loading} onClick={() => feedbackComposer.current?.focus()}>
      Write feedback
    </button>
  )

  const renderLayout = (children: ReactNode) => adminMode
    ? (
      <section className="feedback-workspace admin-feedback">
        <header className="fb-admin-header">
          <h2>Community feedback</h2>
          {writeButton}
        </header>
        {(loading || boardLoaded) && <FeedbackSummary posts={feedbacks} ratings={ratings} loading={loading} />}
        {children}
      </section>
    )
    : (
      <ProfileLayout title="Feedback" mainClassName="profile-feedback" headerAction={writeButton}>
        <div className="feedback-workspace">{children}</div>
      </ProfileLayout>
    )

  const renderLoadError = (syncRating: boolean) => (
    <div className="fb-load-error">
      <p role="alert">{loadError}</p>
      {viewerId && <button type="button" className="fb-link-btn" onClick={() => void loadBoard(syncRating)}>Retry</button>}
    </div>
  )

  if (loading) return renderLayout(<FeedbackSkeleton showRatingPicker={!adminMode} />)
  if (loadError && !boardLoaded) return renderLayout(renderLoadError(true))

  const ratingPicker = (
    <div className="fb-section">
      <h3>Your app rating</h3>
      <div className="fb-stars-picker">
        {RATING_VALUES.map(v => (
          <button key={v} className={`fb-star-btn ${v <= rating ? 'active' : ''}`}
            aria-label={`${v} out of 5 stars`} aria-pressed={v === rating}
            onClick={() => setRating(v)} disabled={savingRating}>
            ★
          </button>
        ))}
      </div>
      <label className="fb-checkbox-row">
        <input type="checkbox" checked={ratingAnonymous} onChange={e => setRatingAnonymous(e.target.checked)} disabled={savingRating} />
        Show this rating as anonymous
      </label>
      <button className="btn-save" onClick={() => void saveMyRating(rating)} disabled={savingRating || rating === 0}>
        {savingRating ? 'Saving…' : 'Save rating'}
      </button>
      {savedRating > 0 && <button className="fb-link-btn" onClick={() => void saveMyRating(0)} disabled={savingRating}>Remove saved rating</button>}
    </div>
  )

  const ratingsList = (
    <div className="fb-section">
      <div className="fb-section-header">
        <h3>App ratings</h3>
        {ratings.length > 0 && (
          <button type="button" className="fb-link-btn" aria-expanded={showRatingsList} onClick={() => setShowRatingsList(p => !p)}>
            {showRatingsList ? 'Hide ratings' : 'View ratings'}
          </button>
        )}
      </div>
      <FeedbackRatingBreakdown ratings={ratings} />
      {showRatingsList && ratings.length > 0 && (
        <div className="fb-ratings-list">
          {ratings.map(item => {
            const name = item.isAnonymous ? 'Anonymous' : item.displayName || 'Member'
            const safe = Math.max(1, Math.min(5, Number(item.rating) || 0))
            return (
              <div key={item.id} className="fb-rating-item">
                <div className="fb-rating-head">
                  <strong>{name}</strong>
                  <span>{formatDateTime(item.updatedAt || item.createdAt)}</span>
                </div>
                <div className="fb-rating-stars">{'★'.repeat(safe)}{'☆'.repeat(5 - safe)} ({safe}/5)</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const composer = (
    <div className="fb-section">
      <h3>Post feedback</h3>
      <textarea ref={feedbackComposer} maxLength={MAX_FEEDBACK_LENGTH}
        disabled={postingFeedback} value={feedbackText}
        onChange={e => setFeedbackText(e.target.value)}
        aria-label="Write your feedback"
        placeholder="Write your feedback"
        rows={4}
        className="contact-textarea"
      />
      <p className="fb-compose-count">{feedbackText.length} / {MAX_FEEDBACK_LENGTH}</p>
      <label className="fb-checkbox-row">
        <input type="checkbox" checked={postAnonymous} onChange={e => setPostAnonymous(e.target.checked)} disabled={postingFeedback} />
        Post feedback anonymously
      </label>
      <button className="btn-save" onClick={submitFeedback} disabled={postingFeedback || !feedbackText.trim()}>
        {postingFeedback ? 'Posting…' : 'Post feedback'}
      </button>
    </div>
  )

  const renderPosts = (posts: FeedbackPost[]) =>
    posts.length === 0 ? (
      <div className="fb-empty">
        <h3>No feedback yet</h3>
        <p>Be the first to share your experience.</p>
      </div>
    ) : posts.map(item => {
      const name = item.isAnonymous ? 'Anonymous' : item.displayName || 'Member'
      const ur = item.publicRating ?? 0
      const rc = item.reactionCount
      const isExpanded = Boolean(expandedReplies[item.id])
      const editable = canManage(item)
      const replyText = replyInputByPost[item.id] || ''
      const replyAnon = Boolean(replyAnonymousByPost[item.id])
      const replyTarget = replyTargetByPost[item.id] ?? null

      return (
        <article key={item.id} className="fb-post-card">
          <div className="fb-post-header">
            <div className="fb-post-author">
              <FeedbackAvatar isAnonymous={item.isAnonymous} photoURL={item.photoURL} />
              <strong>{name}</strong>
              {item.mine && <span className="fb-thread-you">You</span>}
            </div>
            <div className="fb-post-meta">
              {item.replies.some(reply => reply.staff) && <span className="fb-post-status">Admin replied</span>}
              <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
            </div>
          </div>
          {ur > 0 && <div className="fb-post-rating-meta">App rating {ur}/5</div>}
          <p className="fb-post-text">{item.feedback}</p>
          {item.updatedAt && Date.parse(item.updatedAt) > Date.parse(item.createdAt) && <span className="fb-edited">Edited</span>}

          <div className="fb-post-actions">
            <button className="fb-link-btn" aria-pressed={Boolean(item.liked)} onClick={() => toggleReaction('post', item)}>{item.liked ? 'Unlike' : 'Like'} ({rc})</button>
            <button className="fb-link-btn" aria-expanded={isExpanded} onClick={() => setExpandedReplies(p => ({ ...p, [item.id]: !p[item.id] }))}>
              {isExpanded ? `Hide Replies (${item.replies.length})` : `Replies (${item.replies.length})`}
            </button>
            {item.mine && <button className="fb-link-btn" onClick={() => { setEditState({ type: 'feedback', feedbackId: item.id, initialText: item.feedback }); setEditText(item.feedback) }}>Edit</button>}
            {editable && <button className="fb-link-btn fb-delete" onClick={() => deleteEntry('post', item.id)}>Delete</button>}
          </div>

          {isExpanded && (
            <FeedbackThread
              replies={item.replies}
              draft={replyText}
              anonymous={replyAnon}
              targetId={replyTarget}
              posting={replySubmittingPostId === item.id}
              busy={replySubmittingPostId !== null}
              canModerate={canModerate}
              formatTime={formatDateTime}
              onDraft={draft => setReplyInputByPost(prev => ({ ...prev, [item.id]: draft }))}
              onAnonymous={anonymous => setReplyAnonymousByPost(prev => ({ ...prev, [item.id]: anonymous }))}
              onTarget={target => setReplyTargetByPost(prev => ({ ...prev, [item.id]: target }))}
              onSubmit={() => void submitReply(item.id, replyTarget)}
              onLike={reply => void toggleReaction('reply', reply)}
              onEdit={reply => {
                setEditState({ type: 'reply', feedbackId: item.id, replyId: reply.id, initialText: reply.text })
                setEditText(reply.text)
              }}
              onDelete={reply => deleteEntry('reply', reply.id)}
            />
          )}
        </article>
      )
    })

  return renderLayout(
    <>
      <div className="feedback-content lc-content-reveal">
        {loadError && renderLoadError(false)}
        <FeedbackBoard
          posts={feedbacks}
          renderPosts={renderPosts}
          tools={<>{ratingsList}{canRate && ratingPicker}{composer}</>}
        />

        {/* Edit Modal */}
        {editState && (
          <div className="fb-modal-overlay" onClick={() => !savingEdit && setEditState(null)}>
            <div className="fb-modal" role="dialog" aria-modal="true" aria-labelledby="fb-edit-title" onClick={e => e.stopPropagation()}>
              <button className="fb-modal-close" onClick={() => setEditState(null)} aria-label="Close" disabled={savingEdit}>×</button>
              <h3 id="fb-edit-title">Edit feedback</h3>
              <textarea maxLength={MAX_FEEDBACK_LENGTH} disabled={savingEdit} value={editText} onChange={e => setEditText(e.target.value)} rows={4} className="contact-textarea" />
              <div className="fb-modal-actions">
                <button className="btn-outline" disabled={savingEdit} onClick={() => setEditState(null)}>Cancel</button>
                <button className="btn-save" onClick={saveEdit} disabled={savingEdit || !editText.trim()}>
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Snackbar */}
        {snackbar && <div className="fb-snackbar">{snackbar}</div>}
      </div>
      {alertDialog}
      {confirmDialog}
    </>
  )
}
