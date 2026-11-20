import { useMemo, useState, type ReactNode } from 'react'
import type { FeedbackPost, RatingDoc } from '@/utils/feedbackBoard'

const POST_FILTERS = [
  { value: 'all', label: 'All posts' },
  { value: 'unanswered', label: 'Unanswered' },
  { value: 'answered', label: 'With replies' },
] as const

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'replies', label: 'Most replies' },
] as const

const POSTS_PER_BATCH = 10

type PostFilter = typeof POST_FILTERS[number]['value']

type FeedbackBoardProps = {
  posts: FeedbackPost[]
  tools: ReactNode
  renderPosts: (posts: FeedbackPost[]) => ReactNode
}

function matchesQuery(post: FeedbackPost, query: string) {
  const name = post.isAnonymous ? 'Anonymous' : post.displayName || 'Member'
  return name.toLowerCase().includes(query) || post.feedback.toLowerCase().includes(query)
    || post.replies.some(reply => {
      const replyName = reply.isAnonymous ? 'Anonymous' : reply.displayName || 'Member'
      return replyName.toLowerCase().includes(query) || reply.text.toLowerCase().includes(query)
    })
}

export default function FeedbackBoard({ posts, tools, renderPosts }: FeedbackBoardProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PostFilter>('all')
  const [sort, setSort] = useState('newest')
  const [visibleCount, setVisibleCount] = useState(POSTS_PER_BATCH)
  const matchingPosts = useMemo(() => {
    const term = query.trim().toLowerCase()
    const results = posts.filter(post => {
      const hasReplies = post.replies.length > 0
      if ((filter === 'answered' && !hasReplies) || (filter === 'unanswered' && hasReplies)) return false
      return !term || matchesQuery(post, term)
    })
    if (sort === 'oldest') results.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    if (sort === 'replies') results.sort((a, b) => b.replies.length - a.replies.length)
    return results
  }, [posts, query, filter, sort])
  const visiblePosts = matchingPosts.slice(0, visibleCount)

  return (
    <div className="fb-board-columns">
      <section className="fb-board-feed" aria-labelledby="fb-posts-title">
        <div className="fb-feed-toolbar">
          <div className="fb-feed-heading">
            <h3 id="fb-posts-title">Feedback posts</h3>
            <p aria-live="polite">
              {matchingPosts.length > visiblePosts.length
                ? `Showing ${visiblePosts.length} of ${matchingPosts.length} posts`
                : `${matchingPosts.length} ${matchingPosts.length === 1 ? 'post' : 'posts'}`}
            </p>
          </div>
          <div className="fb-feed-search">
            <input
              type="search"
              value={query}
              aria-label="Search feedback and replies"
              placeholder="Search feedback and replies"
              onChange={event => {
                setQuery(event.target.value)
                setVisibleCount(POSTS_PER_BATCH)
              }}
            />
            <select
              value={sort}
              aria-label="Sort feedback posts"
              onChange={event => {
                setSort(event.target.value)
                setVisibleCount(POSTS_PER_BATCH)
              }}
            >
              {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="fb-feed-filters" role="group" aria-label="Filter by reply status">
            {POST_FILTERS.map(option => (
              <button
                type="button"
                className="fb-link-btn"
                key={option.value}
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value)
                  setVisibleCount(POSTS_PER_BATCH)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {posts.length > 0 && matchingPosts.length === 0 ? (
          <div className="fb-empty">
            <h4>No matching posts</h4>
            <button type="button" className="fb-link-btn" onClick={() => {
              setQuery('')
              setFilter('all')
              setVisibleCount(POSTS_PER_BATCH)
            }}>Clear filters</button>
          </div>
        ) : renderPosts(visiblePosts)}
        {visiblePosts.length < matchingPosts.length && (
          <button type="button" className="fb-link-btn fb-load-more" onClick={() => setVisibleCount(count => count + POSTS_PER_BATCH)}>
            Show more posts
          </button>
        )}
      </section>
      <aside className="fb-board-tools" aria-label="Feedback tools">{tools}</aside>
    </div>
  )
}

export function FeedbackRatingBreakdown({ ratings }: { ratings: RatingDoc[] }) {
  return (
    <>
      <p className="fb-rating-total">{ratings.length} {ratings.length === 1 ? 'rating' : 'ratings'}</p>
      <ul className="fb-rating-breakdown" aria-label="Ratings by star count">
        {[5, 4, 3, 2, 1].map(stars => {
          const count = ratings.filter(rating => rating.rating === stars).length
          const share = ratings.length ? count / ratings.length * 100 : 0
          return (
            <li key={stars}>
              <span>{stars}<span className="fb-rating-star" aria-hidden="true"> ★</span><span className="sr-only"> {stars === 1 ? 'star' : 'stars'}</span></span>
              <span className="fb-rating-track" aria-hidden="true"><span style={{ width: `${share}%` }} /></span>
              <span>{count}<span className="sr-only"> {count === 1 ? 'rating' : 'ratings'}</span></span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
