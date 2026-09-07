import { supabase } from '@/lib/supabase'

export type NotificationPayload = {
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown> | null
}

export async function createNotification({ userId, type, title, body, data = null }: NotificationPayload) {
  const { error } = await supabase.from('notifications').insert({
    userId,
    type,
    title,
    body,
    data,
    read: false,
  })
  if (error) throw error
}

export async function fetchNotificationsForUser(userId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })

  if (error) throw error
  return data || []
}

export const CHAT_NOTIFICATION_TYPES = new Set(['support_message', 'chat_message'])

export function isChatNotificationType(type: string) {
  return CHAT_NOTIFICATION_TYPES.has(String(type || '').toLowerCase())
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id)
  if (error) throw error
}

export async function markNotificationsRead(ids: string[]) {
  if (ids.length === 0) return
  const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids)
  if (error) throw error
}

export async function markNotificationsUnread(ids: string[]) {
  if (ids.length === 0) return
  const { error } = await supabase.from('notifications').update({ read: false }).in('id', ids)
  if (error) throw error
}

export async function deleteNotificationsByIds(ids: string[]) {
  if (ids.length === 0) return
  const { error } = await supabase.from('notifications').delete().in('id', ids)
  if (error) throw error
}
