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
