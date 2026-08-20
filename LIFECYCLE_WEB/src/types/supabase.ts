export type TimestampLike =
  | { toDate?: () => Date; seconds?: number; nanoseconds?: number }
  | Date
  | string
  | number
  | null
  | undefined

export type SupabaseDoc = Record<string, unknown>

export function hasToDate(value: unknown): value is { toDate: () => Date } {
  if (typeof value !== 'object' || value === null || !('toDate' in value)) return false
  const candidate = value as { toDate?: unknown }
  return typeof candidate.toDate === 'function'
}

export function hasSeconds(value: unknown): value is { seconds: number } {
  if (typeof value !== 'object' || value === null || !('seconds' in value)) return false
  const candidate = value as { seconds?: unknown }
  return typeof candidate.seconds === 'number'
}
