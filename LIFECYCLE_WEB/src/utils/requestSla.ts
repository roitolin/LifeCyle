import { hasSeconds, hasToDate } from '@/types/supabase'

type RequestUrgency = 'Critical' | 'Urgent' | 'Normal' | string

export const SLA_MINUTES_BY_URGENCY: Record<string, number> = {
  critical: 20,
  urgent: 60,
  normal: 180,
}

export const getSlaMinutes = (urgency: RequestUrgency): number => {
  const normalized = String(urgency || '').trim().toLowerCase()
  return SLA_MINUTES_BY_URGENCY[normalized] ?? SLA_MINUTES_BY_URGENCY.normal
}

export const parseTimestampToDate = (
  value: unknown,
): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  if (hasToDate(value)) {
    const date = value.toDate()
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (hasSeconds(value)) {
    return new Date(value.seconds * 1000)
  }
  return null
}

export const buildSlaDeadlineDate = (urgency: RequestUrgency, createdAt: Date = new Date()): Date => {
  const deadline = new Date(createdAt.getTime())
  deadline.setMinutes(deadline.getMinutes() + getSlaMinutes(urgency))
  return deadline
}

export const formatRemainingTime = (remainingMs: number): string => {
  const absoluteMs = Math.abs(remainingMs)
  const totalMinutes = Math.floor(absoluteMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const seconds = Math.floor((absoluteMs % 60000) / 1000)

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export type RequestSlaState = {
  deadline: Date | null
  remainingMs: number
  isBreached: boolean
  tone: 'good' | 'warning' | 'danger'
  label: string
}

export const getRequestSlaState = (
  request: { urgency?: string; createdAt?: unknown; slaDeadlineAt?: unknown; status?: string },
  now: Date = new Date(),
): RequestSlaState => {
  const explicitDeadline = parseTimestampToDate(request?.slaDeadlineAt)
  const createdAt = parseTimestampToDate(request?.createdAt)
  const fallbackDeadline = createdAt ? buildSlaDeadlineDate(request?.urgency || 'Normal', createdAt) : null
  const deadline = explicitDeadline || fallbackDeadline

  if (!deadline) {
    return {
      deadline: null,
      remainingMs: 0,
      isBreached: false,
      tone: 'warning',
      label: 'Response time unavailable',
    }
  }

  const remainingMs = deadline.getTime() - now.getTime()
  const isBreached = remainingMs <= 0
  const status = String(request?.status || '').toLowerCase()
  const isOpenRequest = status === 'pending' || status === 'accepted' || !status

  if (!isOpenRequest) {
    return {
      deadline,
      remainingMs,
      isBreached,
      tone: 'good',
      label: `Closed | response time ${isBreached ? 'was exceeded' : 'met'}`,
    }
  }

  if (isBreached) {
    return {
      deadline,
      remainingMs,
      isBreached: true,
      tone: 'danger',
      label: `Overdue by ${formatRemainingTime(remainingMs)}`,
    }
  }

  const minutesLeft = Math.floor(remainingMs / 60000)
  const tone = minutesLeft <= 10 ? 'danger' : minutesLeft <= 30 ? 'warning' : 'good'
  return {
    deadline,
    remainingMs,
    isBreached: false,
    tone,
    label: `${formatRemainingTime(remainingMs)} left`,
  }
}

