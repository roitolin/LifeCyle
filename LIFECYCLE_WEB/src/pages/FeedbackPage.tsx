import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'
import ProfileLayout from './ProfileLayout'
import { useAlertDialog } from '@/hooks/useAlertDialog'
import { useConfirmDialog } from '@/hooks/useConfirmDialog'

const RATING_VALUES = [1, 2, 3, 4, 5]

type RatingDoc = {
  id: string; userId: string; userEmail?: string | null; displayName?: string | null
  isAnonymous?: boolean; rating: number; createdAt?: string; updatedAt?: string
}
type FeedbackReply = {
  id: string; userId: string; userEmail?: string | null; displayName?: string | null
  isAnonymous?: boolean; text: string; createdAt?: string; updatedAt?: string
  reactions?: Record<string, string>
}
type FeedbackPost = {
  id: string; userId: string; userEmail?: string | null; displayName?: string | null
  isAnonymous?: boolean; feedback: string; createdAt?: string; updatedAt?: string
  reactions?: Record<string, string>; replies: FeedbackReply[]
}

const formatDateTime = (ts: any) => {
  if (!ts) return 'Just now'
  return new Date(ts).toLocaleString(undefined, { hour12: true })
}

export default function FeedbackPage() {
  const [viewer, setViewer] = useState<User | null>(null)
  const [userRole, setUserRole] = useState('')

  const [rating, setRating] = useState(0)
  const [ratingAnonymous, setRatingAnonymous] = useState(false)
  const [savingRating, setSavingRating] = useState(false)
  const [showRatingsList, setShowRatingsList] = useState(true)

  const [feedbackText, setFeedbackText] = useState('')
  const [postAnonymous, setPostAnonymous] = useState(false)
  const [postingFeedback, setPostingFeedback] = useState(false)

  const [ratings, setRatings] = useState<RatingDoc[]>([])
  const [feedbacks, setFeedbacks] = useState<FeedbackPost[]>([])
  const [loading, setLoading] = useState(true)

  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [replyInputByPost, setReplyInputByPost] = useState<Record<string, string>>({})
  const [replyAnonymousByPost, setReplyAnonymousByPost] = useState<Record<string, boolean>>({})
  const [replySubmittingPostId, setReplySubmittingPostId] = useState<string | null>(null)

  const [editState, setEditState] = useState<{ type: 'feedback' | 'reply'; feedbackId: string; replyId?: string; initialText: string } | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [snackbar, setSnackbar] = useState('')
  const { openAlert, alertDialog } = useAlertDialog()
  const { openConfirm, confirmDialog } = useConfirmDialog()

  const isSuperAdmin = userRole === 'super_admin'
  const canModerate = userRole === 'admin' || isSuperAdmin
  const canManage = useCallback((ownerUserId: string) =>
    !!viewer && (ownerUserId === viewer.id || canModerate), [viewer, canModerate])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null
      setViewer(u)
      if (u) {
        supabase.from('users').select('role').eq('id', u.id).maybeSingle().then(({ data: d }) => {
          setUserRole(d?.role || 'user')
        })
      }
    })
  }, [])

  const getIdentity = useCallback(async () => {
    if (!viewer) return null
    const { data } = await supabase.from('users').select('email, fullName').eq('id', viewer.id).single()
    return { userId: viewer.id, userEmail: viewer.email || null, displayName: data?.fullName || viewer.email || 'User' }
  }, [viewer])

  const loadBoard = useCallback(async () => {
    if (!viewer) { setLoading(false); return }
    try {
      const { data: ratingsData } = await supabase.from('app_ratings').select('*, users(email, fullName)').order('updatedAt', { ascending: false })
      const rl = (ratingsData || []).map((r: any) => ({ ...r, userEmail: r.users?.email, displayName: r.users?.fullName })) as RatingDoc[]
      setRatings(rl)
      const mine = rl.find(i => i.userId === viewer.id)
      if (mine) { setRating(mine.rating || 0); setRatingAnonymous(Boolean(mine.isAnonymous)) }
      else { setRating(0); setRatingAnonymous(false) }

      const { data: feedbackData } = await supabase.from('app_feedback').select('*, users(email, fullName), app_feedback_replies(*, users(email, fullName))').order('createdAt', { ascending: false })
      const fl = (feedbackData || []).map((f: any) => {
        const replies = (f.app_feedback_replies || []).map((r: any) => ({ ...r, userEmail: r.users?.email, displayName: r.users?.fullName }))
          .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        return { ...f, userEmail: f.users?.email, displayName: f.users?.fullName, replies } as FeedbackPost
      })
      setFeedbacks(fl)
    } catch (err: any) {
      openAlert({
        title: 'Load Failed',
        message: err?.message || 'Failed to load data.',
        tone: 'danger',
        okLabel: 'Dismiss',
      })
    } finally { setLoading(false) }
  }, [viewer, openAlert])

  useEffect(() => { if (viewer) loadBoard() }, [viewer, loadBoard])

  const showSnack = (msg: string) => { setSnackbar(msg); setTimeout(() => setSnackbar(''), 2500) }

  /* ── Rating actions ───────────────────── */
  const saveMyRating = async () => {
    if (isSuperAdmin) {
      openAlert({
        title: 'Action Not Allowed',
        message: 'Superadmin accounts cannot submit ratings.',
        tone: 'warning',
        okLabel: 'Got It',
      })
      return
    }
    const identity = await getIdentity()
    if (!identity) return
    setSavingRating(true)
    try {
      if (rating < 1) {
        await supabase.from('app_ratings').delete().eq('userId', identity.userId)
        showSnack('Rating removed.'); loadBoard(); return
      }
      const { data: existing } = await supabase.from('app_ratings').select('id').eq('userId', identity.userId).maybeSingle()
      if (existing) {
        await supabase.from('app_ratings').update({ isAnonymous: ratingAnonymous, rating, updatedAt: new Date().toISOString() }).eq('userId', identity.userId)
      } else {
        await supabase.from('app_ratings').insert({ userId: identity.userId, isAnonymous: ratingAnonymous, rating })
      }
      showSnack('Rating saved.'); loadBoard()
    } catch (err: any) { openAlert({ title: 'Save Failed', message: err?.message || 'Failed to save rating.', tone: 'danger', okLabel: 'Dismiss' }) }
    finally { setSavingRating(false) }
  }

  const removeMyRating = async () => {
    const identity = await getIdentity()
    if (!identity) return
    await supabase.from('app_ratings').delete().eq('userId', identity.userId)
    setRating(0); setRatingAnonymous(false)
    showSnack('Rating removed.'); loadBoard()
  }

  /* ── Feedback actions ─────────────────── */
  const submitFeedback = async () => {
    if (!feedbackText.trim()) { openAlert({ title: 'Empty Feedback', message: 'Please write your feedback first.', tone: 'warning', okLabel: 'Got It' }); return }
    const identity = await getIdentity()
    if (!identity) return
    setPostingFeedback(true)
    try {
      await supabase.from('app_feedback').insert({ userId: identity.userId, isAnonymous: postAnonymous, feedback: feedbackText.trim(), reactions: {} })
      setFeedbackText(''); setPostAnonymous(false); showSnack('Feedback posted.'); loadBoard()
    } catch (err: any) { openAlert({ title: 'Post Failed', message: err?.message || 'Failed to submit feedback.', tone: 'danger', okLabel: 'Dismiss' }) }
    finally { setPostingFeedback(false) }
  }

  const toggleFeedbackReaction = async (item: FeedbackPost) => {
    if (!viewer) return
    const r = { ...(item.reactions || {}) }
    if (r[viewer.id]) delete r[viewer.id]; else r[viewer.id] = 'like'
    await supabase.from('app_feedback').update({ reactions: r }).eq('id', item.id)
    loadBoard()
  }

  const toggleReplyReaction = async (reply: FeedbackReply) => {
    if (!viewer) return
    const r = { ...(reply.reactions || {}) }
    if (r[viewer.id]) delete r[viewer.id]; else r[viewer.id] = 'like'
    await supabase.from('app_feedback_replies').update({ reactions: r }).eq('id', reply.id)
    loadBoard()
  }

  const submitReply = async (feedbackId: string) => {
    const text = (replyInputByPost[feedbackId] || '').trim()
    if (!text) return
    const identity = await getIdentity()
    if (!identity) return
    setReplySubmittingPostId(feedbackId)
    try {
      await supabase.from('app_feedback_replies').insert({ feedbackId, userId: identity.userId, isAnonymous: Boolean(replyAnonymousByPost[feedbackId]), text, reactions: {} })
      setReplyInputByPost(prev => ({ ...prev, [feedbackId]: '' }))
      setReplyAnonymousByPost(prev => ({ ...prev, [feedbackId]: false }))
      setExpandedReplies(prev => ({ ...prev, [feedbackId]: true }))
      showSnack('Reply posted.'); loadBoard()
    } catch (err: any) { openAlert({ title: 'Reply Failed', message: err?.message || 'Failed to post reply.', tone: 'danger', okLabel: 'Dismiss' }) }
    finally { setReplySubmittingPostId(null) }
  }

  const deleteFeedback = async (id: string) => {
    openConfirm({
      title: 'Delete Feedback',
      message: 'Delete this feedback and all replies?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        await supabase.from('app_feedback').delete().eq('id', id)
        showSnack('Feedback deleted.'); loadBoard()
      },
    })
  }

  const deleteReply = async (id: string) => {
    openConfirm({
      title: 'Delete Reply',
      message: 'Delete this reply?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        await supabase.from('app_feedback_replies').delete().eq('id', id)
        showSnack('Reply deleted.'); loadBoard()
      },
    })
  }

  const saveEdit = async () => {
    if (!editState || !editText.trim()) return
    setSavingEdit(true)
    try {
      if (editState.type === 'feedback') {
        await supabase.from('app_feedback').update({ feedback: editText.trim(), updatedAt: new Date().toISOString() }).eq('id', editState.feedbackId)
      } else {
        await supabase.from('app_feedback_replies').update({ text: editText.trim(), updatedAt: new Date().toISOString() }).eq('id', editState.replyId)
      }
      setEditState(null); setEditText(''); showSnack('Changes saved.'); loadBoard()
    } catch (err: any) { openAlert({ title: 'Save Failed', message: err?.message || 'Failed to save.', tone: 'danger', okLabel: 'Dismiss' }) }
    finally { setSavingEdit(false) }
  }

  const averageRating = useMemo(() => {
    if (ratings.length === 0) return 0
    return ratings.reduce((s, e) => s + (e.rating || 0), 0) / ratings.length
  }, [ratings])

  const ratingByUserId = useMemo(() => {
    const m: Record<string, number> = {}
    ratings.forEach(e => { if (e.userId) m[e.userId] = Number(e.rating) || 0 })
    return m
  }, [ratings])

  if (loading) return <ProfileLayout title="Feedback" subtitle="Rate the app or share feedback."><div className="fb-loading">Loading…</div></ProfileLayout>

  return (
    <ProfileLayout title="Feedback" subtitle="Rate the app or share feedback.">
      <div className="feedback-content">
        {/* Summary stats */}
        <div className="fb-summary">
          <span>Posts: <strong>{feedbacks.length}</strong></span>
          <span>Ratings: <strong>{ratings.length}</strong></span>
          <span>Average: <strong>{averageRating.toFixed(1)}/5</strong></span>
        </div>

        {/* Rating Picker */}
        <div className="fb-section">
          <h3>Your app rating</h3>
          {isSuperAdmin ? (
            <p className="fb-notice">Superadmin accounts can read ratings but cannot submit one.</p>
          ) : (
            <>
              <p className="fb-hint">Tap the same star again to clear your rating.</p>
              <div className="fb-stars-picker">
                {RATING_VALUES.map(v => (
                  <button key={v} className={`fb-star-btn ${v <= rating ? 'active' : ''}`}
                    onClick={() => { if (rating === v) removeMyRating(); else setRating(v) }}>
                    ★
                  </button>
                ))}
              </div>
              <label className="fb-checkbox-row">
                <input type="checkbox" checked={ratingAnonymous} onChange={e => setRatingAnonymous(e.target.checked)} />
                Show this rating as anonymous
              </label>
              <button className="btn-save" onClick={saveMyRating} disabled={savingRating}>
                {savingRating ? 'Saving…' : 'Save rating'}
              </button>
            </>
          )}
        </div>

        {/* Community Ratings List */}
        <div className="fb-section">
          <div className="fb-section-header">
            <h3>Ratings</h3>
            <button className="fb-link-btn" onClick={() => setShowRatingsList(p => !p)}>
              {showRatingsList ? 'Hide' : 'Show'}
            </button>
          </div>
          {!showRatingsList ? (
            <p className="fb-hint">Ratings are hidden. Click Show to view.</p>
          ) : ratings.length === 0 ? (
            <p className="fb-hint">No ratings yet. Be the first to rate the app.</p>
          ) : (
            <div className="fb-ratings-list">
              {ratings.map(item => {
                const name = item.isAnonymous ? 'Anonymous' : item.displayName || item.userEmail || 'User'
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

        <hr className="fb-divider" />

        {/* Post Feedback */}
        <div className="fb-section">
          <h3>Post feedback</h3>
          <textarea
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            placeholder="Write your feedback"
            rows={4}
            className="contact-textarea"
          />
          <label className="fb-checkbox-row">
            <input type="checkbox" checked={postAnonymous} onChange={e => setPostAnonymous(e.target.checked)} />
            Post feedback anonymously
          </label>
          <button className="btn-save" onClick={submitFeedback} disabled={postingFeedback}>
            {postingFeedback ? 'Posting…' : 'Post feedback'}
          </button>
        </div>

        <hr className="fb-divider" />

        {/* Feedback List */}
        {feedbacks.length === 0 ? (
          <div className="fb-empty">
            <h3>No feedback yet</h3>
            <p>Be the first to share your experience.</p>
          </div>
        ) : feedbacks.map(item => {
          const name = item.isAnonymous ? 'Anonymous' : item.displayName || item.userEmail || 'User'
          const ur = ratingByUserId[item.userId]
          const rc = Object.keys(item.reactions || {}).length
          const isExpanded = Boolean(expandedReplies[item.id])
          const editable = canManage(item.userId)
          const replyText = replyInputByPost[item.id] || ''
          const replyAnon = Boolean(replyAnonymousByPost[item.id])

          return (
            <div key={item.id} className="fb-post-card">
              <div className="fb-post-header">
                <strong>{name}</strong>
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
              <div className="fb-post-rating-meta">{ur > 0 ? `App Rating: ${ur}/5` : 'App Rating: No rating yet'}</div>
              <p className="fb-post-text">{item.feedback}</p>
              {item.updatedAt && <span className="fb-edited">Edited</span>}

              <div className="fb-post-actions">
                <button className="fb-link-btn" onClick={() => toggleFeedbackReaction(item)}>Like ({rc})</button>
                <button className="fb-link-btn" onClick={() => setExpandedReplies(p => ({ ...p, [item.id]: !p[item.id] }))}>
                  {isExpanded ? `Hide Replies (${item.replies.length})` : `Replies (${item.replies.length})`}
                </button>
                {editable && <button className="fb-link-btn" onClick={() => { setEditState({ type: 'feedback', feedbackId: item.id, initialText: item.feedback }); setEditText(item.feedback) }}>Edit</button>}
                {editable && <button className="fb-link-btn fb-delete" onClick={() => deleteFeedback(item.id)}>Delete</button>}
              </div>

              {isExpanded && (
                <div className="fb-replies-wrap">
                  {item.replies.length === 0 && <p className="fb-hint">No replies yet.</p>}
                  {item.replies.map(reply => {
                    const rn = reply.isAnonymous ? 'Anonymous' : reply.displayName || reply.userEmail || 'User'
                    const rrc = Object.keys(reply.reactions || {}).length
                    const re = canManage(reply.userId)
                    return (
                      <div key={reply.id} className="fb-reply-item">
                        <div className="fb-reply-head">
                          <strong>{rn}</strong>
                          <span>{formatDateTime(reply.createdAt)}</span>
                        </div>
                        <p>{reply.text}</p>
                        <div className="fb-post-actions">
                          <button className="fb-link-btn" onClick={() => toggleReplyReaction(reply)}>Like ({rrc})</button>
                          {re && <button className="fb-link-btn" onClick={() => { setEditState({ type: 'reply', feedbackId: item.id, replyId: reply.id, initialText: reply.text }); setEditText(reply.text) }}>Edit</button>}
                          {re && <button className="fb-link-btn fb-delete" onClick={() => deleteReply(reply.id)}>Delete</button>}
                        </div>
                      </div>
                    )
                  })}
                  <hr className="fb-divider" />
                  <textarea
                    value={replyText}
                    onChange={e => setReplyInputByPost(p => ({ ...p, [item.id]: e.target.value }))}
                    placeholder="Write a reply"
                    rows={2}
                    className="contact-textarea"
                  />
                  <label className="fb-checkbox-row">
                    <input type="checkbox" checked={replyAnon} onChange={e => setReplyAnonymousByPost(p => ({ ...p, [item.id]: e.target.checked }))} />
                    Reply anonymously
                  </label>
                  <button className="btn-save" onClick={() => submitReply(item.id)} disabled={replySubmittingPostId === item.id || !replyText.trim()}>
                    {replySubmittingPostId === item.id ? 'Posting…' : 'Reply'}
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Edit Modal */}
        {editState && (
          <div className="fb-modal-overlay" onClick={() => setEditState(null)}>
            <div className="fb-modal" onClick={e => e.stopPropagation()}>
              <button className="fb-modal-close" onClick={() => setEditState(null)} aria-label="Close">×</button>
              <h3>Edit feedback</h3>
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4} className="contact-textarea" />
              <div className="fb-modal-actions">
                <button className="btn-outline" onClick={() => setEditState(null)}>Cancel</button>
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
    </ProfileLayout>
  )
}
