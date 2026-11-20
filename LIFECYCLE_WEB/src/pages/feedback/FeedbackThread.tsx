import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { getDefaultProfileAvatar, getProfileAvatar } from '@/utils/profileAvatar'
import { MAX_FEEDBACK_LENGTH, type FeedbackReply } from '@/utils/feedbackBoard'

const DEFAULT_AVATAR = getDefaultProfileAvatar()

type AvatarProps = {
  photoURL?: string | null
  isAnonymous: boolean
}

export function FeedbackAvatar({ photoURL, isAnonymous }: AvatarProps) {
  return (
    <img
      className="fb-profile-avatar"
      src={getProfileAvatar(isAnonymous ? null : photoURL)}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={event => {
        if (event.currentTarget.getAttribute('src') !== DEFAULT_AVATAR) {
          event.currentTarget.src = DEFAULT_AVATAR
        }
      }}
    />
  )
}

type FeedbackThreadProps = {
  replies: FeedbackReply[]
  draft: string
  anonymous: boolean
  targetId: string | null
  posting: boolean
  busy: boolean
  canModerate: boolean
  formatTime: (value: string) => string
  onDraft: (draft: string) => void
  onAnonymous: (anonymous: boolean) => void
  onTarget: (targetId: string | null) => void
  onSubmit: () => void
  onLike: (reply: FeedbackReply) => void
  onEdit: (reply: FeedbackReply) => void
  onDelete: (reply: FeedbackReply) => void
}

function replyAuthor(reply: FeedbackReply) {
  return reply.isAnonymous ? 'Anonymous' : reply.displayName || 'Member'
}

export default function FeedbackThread({
  replies, draft, anonymous, targetId, posting, busy, canModerate, formatTime,
  onDraft, onAnonymous, onTarget, onSubmit, onLike, onEdit, onDelete,
}: FeedbackThreadProps) {
  const replyField = useRef<HTMLTextAreaElement>(null)
  const shouldFocusComposer = useRef(false)
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({})
  const targetLabel = useId()
  const target = replies.find(reply => reply.id === targetId && !reply.parentReplyId)
  const missingTarget = Boolean(targetId && !target)
  const targetName = target ? (target.mine ? 'your comment' : replyAuthor(target)) : null

  useLayoutEffect(() => {
    if (shouldFocusComposer.current) {
      shouldFocusComposer.current = false
      replyField.current?.focus()
    }
  }, [targetId])

  const focusComposer = (nextTarget: string | null) => {
    if (nextTarget === targetId) {
      replyField.current?.focus()
      return
    }
    shouldFocusComposer.current = true
    onTarget(nextTarget)
  }

  const rootIds = new Set(replies.filter(reply => !reply.parentReplyId).map(reply => reply.id))
  const roots: FeedbackReply[] = []
  const children = new Map<string, FeedbackReply[]>()

  for (const reply of replies) {
    if (!reply.parentReplyId || !rootIds.has(reply.parentReplyId)) {
      roots.push(reply)
    } else {
      const siblings = children.get(reply.parentReplyId) ?? []
      siblings.push(reply)
      children.set(reply.parentReplyId, siblings)
    }
  }

  const composer = (
    <form className="fb-thread-composer" onSubmit={event => {
      event.preventDefault()
      if (busy || missingTarget || !draft.trim()) return
      if (targetId) setOpenBranches(previous => ({ ...previous, [targetId]: true }))
      onSubmit()
    }}>
      {targetId && (
        <span id={targetLabel} className={target ? 'sr-only' : 'fb-thread-target'} aria-live="polite">
          {target ? `Replying to ${targetName}` : 'This comment was removed.'}
        </span>
      )}
      <textarea
        ref={replyField}
        className="contact-textarea"
        aria-label="Write a reply"
        aria-describedby={targetId ? targetLabel : undefined}
        placeholder={targetName ? `Reply to ${targetName}` : 'Write a reply'}
        maxLength={MAX_FEEDBACK_LENGTH}
        value={draft}
        onChange={event => onDraft(event.target.value)}
        rows={2}
        disabled={posting}
      />
      <div className="fb-thread-composer-actions">
        <label className="fb-checkbox-row">
          <input type="checkbox" checked={anonymous} onChange={event => onAnonymous(event.target.checked)} disabled={posting} />
          Reply anonymously
        </label>
        <div>
          {targetId && (
            <button type="button" className="fb-link-btn" onClick={() => focusComposer(null)} disabled={posting}>
              {target ? 'Cancel' : 'Reply to feedback'}
            </button>
          )}
          <button className="btn-save" type="submit" disabled={busy || missingTarget || !draft.trim()}>
            {posting ? 'Posting…' : 'Post reply'}
          </button>
        </div>
      </div>
    </form>
  )

  const renderReply = (reply: FeedbackReply, nested = false): ReactElement => {
    const name = replyAuthor(reply)
    const nestedReplies = children.get(reply.id)
    const isBranchOpen = Boolean(openBranches[reply.id])
    return (
      <li className="fb-thread-entry" key={reply.id}>
        <div className="fb-thread-comment">
          <FeedbackAvatar isAnonymous={reply.isAnonymous} photoURL={reply.photoURL} />
          <div className="fb-thread-body">
            <div className="fb-thread-byline">
              <strong>{name}</strong>
              {reply.mine && <span className="fb-thread-you">You</span>}
              {reply.staff && <span className="fb-thread-staff">Admin</span>}
              <time dateTime={reply.createdAt}>{formatTime(reply.createdAt)}</time>
            </div>
            <p>{reply.text}</p>
            <div className="fb-post-actions">
              {!nested && !reply.parentReplyId && (
                <button
                  type="button"
                  className="fb-link-btn"
                  aria-label={`Reply to ${reply.mine ? 'your comment' : name}`}
                  onClick={() => focusComposer(reply.id)}
                  disabled={posting}
                >Reply</button>
              )}
              <button type="button" className="fb-link-btn" aria-pressed={Boolean(reply.liked)} onClick={() => onLike(reply)}>
                {reply.liked ? 'Unlike' : 'Like'} ({reply.reactionCount})
              </button>
              {reply.mine && <button type="button" className="fb-link-btn" onClick={() => onEdit(reply)}>Edit</button>}
              {(canModerate || reply.mine) && <button type="button" className="fb-link-btn fb-delete" onClick={() => onDelete(reply)}>Delete</button>}
            </div>
            {target?.id === reply.id && composer}
          </div>
        </div>
        {nestedReplies && (
          <>
            <div className={`fb-thread-branch-toggle${isBranchOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="fb-link-btn"
                aria-expanded={isBranchOpen}
                onClick={() => setOpenBranches(previous => ({ ...previous, [reply.id]: !previous[reply.id] }))}
              >
                {isBranchOpen ? 'Hide' : 'View'} {nestedReplies.length} {nestedReplies.length === 1 ? 'reply' : 'replies'}
              </button>
            </div>
            {isBranchOpen && (
              <ol className="fb-thread-children" aria-label={`Replies to ${name}`}>
                {nestedReplies.map(child => renderReply(child, true))}
              </ol>
            )}
          </>
        )}
      </li>
    )
  }

  return (
    <div className="fb-replies-wrap fb-thread">
      {roots.length > 0 ? (
        <ol className="fb-thread-list" aria-label="Replies">
          {roots.map(reply => renderReply(reply))}
        </ol>
      ) : <p className="fb-hint fb-thread-empty">No replies yet.</p>}
      {!target && composer}
    </div>
  )
}
