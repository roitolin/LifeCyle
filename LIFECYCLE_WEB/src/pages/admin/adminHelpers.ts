import { hasToDate } from '@/types/supabase'

export function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (hasToDate(value)) {
    const converted = value.toDate()
    return Number.isNaN(converted?.getTime?.() ?? Number.NaN) ? null : converted
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function toMillis(value: unknown) {
  return toDate(value)?.getTime() || 0
}

export function toDateText(value: unknown) {
  const parsed = toDate(value)
  return parsed ? parsed.toLocaleString(undefined, { hour12: true }) : '-'
}

export function getConversationId(uid1: string, uid2: string) {
  return [uid1, uid2].sort().join('_')
}
