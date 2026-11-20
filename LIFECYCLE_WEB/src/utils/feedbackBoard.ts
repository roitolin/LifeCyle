import { supabase } from '@/lib/supabase'

export const MAX_FEEDBACK_LENGTH = 1200

export type RatingDoc = {
  id: string
  displayName?: string | null
  isAnonymous: boolean
  rating: number
  createdAt: string
  updatedAt: string
}

type BoardItem = {
  id: string
  mine: boolean
  displayName?: string | null
  photoURL?: string | null
  isAnonymous: boolean
  createdAt: string
  updatedAt: string
  liked: boolean | null
  reactionCount: number
}

export type FeedbackReply = BoardItem & { text: string; staff: boolean; parentReplyId?: string | null }
export type FeedbackPost = BoardItem & { feedback: string; publicRating?: number | null; replies: FeedbackReply[] }

type FeedbackBoardSnapshot = {
  canModerate: boolean
  canRate: boolean
  myRating: { rating: number; isAnonymous: boolean } | null
  ratings: RatingDoc[]
  posts: FeedbackPost[]
}

export const feedbackSources = [
  { table: 'app_feedback', includeDeletes: true },
  { table: 'app_feedback_replies', includeDeletes: true },
  { table: 'app_ratings', includeDeletes: true },
]

async function checked<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

export async function fetchFeedbackBoard() {
  return await checked(supabase.rpc('get_app_feedback_board', {}, { get: true })) as FeedbackBoardSnapshot
}

export function saveFeedbackRating(rating: number, isAnonymous: boolean) {
  return checked(supabase.rpc('save_app_feedback_rating', { p_rating: rating, p_anonymous: isAnonymous }))
}

export function saveFeedbackReaction(kind: 'post' | 'reply', id: string, liked: boolean) {
  return checked(supabase.rpc('set_app_feedback_reaction', { p_kind: kind, p_id: id, p_liked: liked }))
}

export async function submitFeedbackPost(userId: string, feedback: string, isAnonymous: boolean) {
  const post = await checked(supabase.from('app_feedback').insert({ userId, feedback, isAnonymous }).select('id').single())
  if (!post?.id) throw new Error('The server did not confirm the feedback post.')
  return post
}

export function submitFeedbackReply(userId: string, feedbackId: string, text: string, isAnonymous: boolean, parentReplyId?: string | null) {
  const reply = { userId, feedbackId, text, isAnonymous, ...(parentReplyId ? { parentReplyId } : {}) }
  return checked(supabase.from('app_feedback_replies').insert(reply))
}

export function editFeedbackEntry(kind: 'post' | 'reply', id: string, text: string) {
  const now = new Date().toISOString()
  const query = kind === 'post'
    ? supabase.from('app_feedback').update({ feedback: text, updatedAt: now })
    : supabase.from('app_feedback_replies').update({ text, updatedAt: now })
  return checked(query.eq('id', id).select('id').single())
}

export function removeFeedbackEntry(kind: 'post' | 'reply', id: string) {
  const table = kind === 'post' ? 'app_feedback' : 'app_feedback_replies'
  return checked(supabase.from(table).delete().eq('id', id).select('id').single())
}

export async function notifyFeedbackAdmins(type: 'feedback_new' | 'rating_update', feedbackId?: string) {
  try {
    await checked(supabase.rpc('notify_active_admins', {
      p_type: type,
      p_title: type === 'feedback_new' ? 'New App Feedback' : 'App Rating Updated',
      p_body: type === 'feedback_new' ? 'A member posted feedback.' : 'A member changed their app rating.',
      p_data: feedbackId ? { feedbackId } : null,
      p_dedupe_key: feedbackId ? `admin:feedback_new:${feedbackId}` : null,
    }))
  } catch {
    console.warn('Could not deliver the feedback notification.')
  }
}
