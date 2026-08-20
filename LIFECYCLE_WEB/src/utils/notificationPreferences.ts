export type NotificationPreferences = {
  serviceRequests: boolean
  payments: boolean
  messages: boolean
  announcements: boolean
  sound: boolean
}

export type NotificationPreferenceCategory = Exclude<keyof NotificationPreferences, 'sound'>

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  serviceRequests: true,
  payments: true,
  messages: true,
  announcements: true,
  sound: true,
}

const STORAGE_KEY_PREFIX = 'lifecycle_notification_preferences_'

const normalizePreferences = (value?: Partial<NotificationPreferences> | null): NotificationPreferences => ({
  serviceRequests: typeof value?.serviceRequests === 'boolean' ? value.serviceRequests : true,
  payments: typeof value?.payments === 'boolean' ? value.payments : true,
  messages: typeof value?.messages === 'boolean' ? value.messages : true,
  announcements: typeof value?.announcements === 'boolean' ? value.announcements : true,
  sound: typeof value?.sound === 'boolean' ? value.sound : true,
})

const storageKey = (userId: string) => `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId.trim())}`

export function getNotificationPreferences(userId: string): NotificationPreferences {
  if (!userId.trim()) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  try {
    const stored = window.localStorage.getItem(storageKey(userId))
    return stored ? normalizePreferences(JSON.parse(stored) as Partial<NotificationPreferences>) : { ...DEFAULT_NOTIFICATION_PREFERENCES }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function saveNotificationPreferences(userId: string, preferences: NotificationPreferences) {
  if (!userId.trim()) throw new Error('A signed-in user is required to save notification preferences.')
  const normalized = normalizePreferences(preferences)
  window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized))
  return normalized
}

export function getNotificationPreferenceCategory(typeValue: string): NotificationPreferenceCategory | null {
  const type = typeValue.trim().toLowerCase()
  if (type.includes('payment')) return 'payments'
  if (type === 'support_message' || type === 'message' || type.startsWith('message_') || type.startsWith('chat_')) return 'messages'
  if (type === 'announcement_new' || type === 'funeral_new_product' || type.includes('announcement')) return 'announcements'
  if (type.startsWith('request_') || type.startsWith('funeral_request_') || type.includes('service_request')) return 'serviceRequests'
  return null
}

export function isNotificationTypeEnabled(type: string, preferences: NotificationPreferences) {
  const category = getNotificationPreferenceCategory(type)
  return category === null || preferences[category]
}

