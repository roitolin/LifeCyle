export const SUBSCRIPTION_MONTHS = 1

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  result.setMonth(result.getMonth() + months)
  return result
}

export function formatSubscriptionDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function daysRemaining(until: string | null | undefined): number {
  if (!until) return 0
  const target = new Date(until).getTime()
  if (Number.isNaN(target)) return 0
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000))
}
