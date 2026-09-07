import { supabase } from '@/lib/supabase'

export type OperationKind = 'shop' | 'payment' | 'refund' | 'deletion' | 'service'
export type OperationPriority = 'urgent' | 'high' | 'normal'

export type OperationItem = {
  id: string
  kind: OperationKind
  title: string
  description: string
  status: string
  createdAt: string
  priority: OperationPriority
  href: string
}

export type OperationCounts = Record<OperationKind, number>

const HOUR = 60 * 60 * 1000

function elapsedHours(value: string) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / HOUR) : 0
}

function getPriority(kind: OperationKind, status: string, createdAt: string): OperationPriority {
  const hours = elapsedHours(createdAt)
  if (kind === 'deletion' && status === 'approved') return 'urgent'
  if (kind === 'refund' && status === 'approved') return 'high'
  if (kind === 'service' && hours >= 48) return 'urgent'
  if (kind === 'payment' && hours >= 24) return 'high'
  if ((kind === 'refund' || kind === 'deletion') && hours >= 48) return 'high'
  if (kind === 'shop' && hours >= 72) return 'high'
  return 'normal'
}

export function operationAge(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Unknown age'
  const elapsed = Math.max(0, Date.now() - timestamp)
  const hours = Math.floor(elapsed / HOUR)
  if (hours < 1) return 'Less than 1 hour ago'
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export async function loadCommandCenterOperations() {
  const [shopsResult, paymentsResult, refundsResult, deletionsResult, servicesResult] = await Promise.all([
    supabase
      .from('funeral_shops')
      .select('id, shopName, status, createdAt')
      .eq('status', 'pending')
      .order('createdAt', { ascending: true }),
    supabase
      .from('shop_payments')
      .select('id, shopId, payerName, amount, status, createdAt')
      .eq('status', 'pending')
      .order('createdAt', { ascending: true }),
    supabase
      .from('service_refund_requests')
      .select('id, service_request_id, status, reason, requested_at')
      .in('status', ['pending', 'approved'])
      .order('requested_at', { ascending: true }),
    supabase
      .from('account_deletion_requests')
      .select('id, email_snapshot, status, reason, requested_at')
      .in('status', ['pending', 'in_review', 'approved'])
      .order('requested_at', { ascending: true }),
    supabase
      .from('funeral_service_requests')
      .select('id, shopName, deceasedFullName, status, createdAt')
      .in('status', ['pending_shop_acceptance', 'payment_submitted'])
      .order('createdAt', { ascending: true }),
  ])

  const firstError = [shopsResult.error, paymentsResult.error, refundsResult.error, deletionsResult.error, servicesResult.error]
    .find(Boolean)
  if (firstError) throw firstError

  const items: OperationItem[] = []

  for (const row of shopsResult.data || []) {
    const createdAt = String(row.createdAt || '')
    items.push({
      id: row.id,
      kind: 'shop',
      title: row.shopName || 'Unnamed funeral shop',
      description: 'Registration is waiting for administrator review.',
      status: row.status || 'pending',
      createdAt,
      priority: getPriority('shop', row.status || 'pending', createdAt),
      href: `/admin/funeral-shops/${row.id}/details`,
    })
  }

  for (const row of paymentsResult.data || []) {
    const createdAt = String(row.createdAt || '')
    const amount = Number(row.amount || 0)
    items.push({
      id: row.id,
      kind: 'payment',
      title: row.payerName || 'Shop payment submission',
      description: `${amount > 0 ? `PHP ${amount.toLocaleString('en-PH')} ` : ''}payment proof is waiting for verification.`,
      status: row.status || 'pending',
      createdAt,
      priority: getPriority('payment', row.status || 'pending', createdAt),
      href: '/admin/payments',
    })
  }

  for (const row of refundsResult.data || []) {
    const createdAt = String(row.requested_at || '')
    items.push({
      id: row.id,
      kind: 'refund',
      title: `Refund ${String(row.service_request_id).slice(0, 8).toUpperCase()}`,
      description: row.reason || 'A service refund requires review.',
      status: row.status || 'pending',
      createdAt,
      priority: getPriority('refund', row.status || 'pending', createdAt),
      href: '/admin/payments?tab=refunds',
    })
  }

  for (const row of deletionsResult.data || []) {
    const createdAt = String(row.requested_at || '')
    items.push({
      id: row.id,
      kind: 'deletion',
      title: row.email_snapshot || 'Account deletion request',
      description: row.reason || 'This privacy request requires review.',
      status: row.status || 'pending',
      createdAt,
      priority: getPriority('deletion', row.status || 'pending', createdAt),
      href: '/admin/account-deletions',
    })
  }

  for (const row of servicesResult.data || []) {
    const createdAt = String(row.createdAt || '')
    const status = row.status || 'pending_shop_acceptance'
    items.push({
      id: row.id,
      kind: 'service',
      title: row.deceasedFullName || 'Service request',
      description: status === 'payment_submitted'
        ? `${row.shopName || 'Assigned shop'} has a submitted family payment awaiting action.`
        : `${row.shopName || 'Assigned shop'} has not responded to this arrangement request.`,
      status,
      createdAt,
      priority: getPriority('service', status, createdAt),
      href: `/admin/orders/${row.id}`,
    })
  }

  const priorityOrder: Record<OperationPriority, number> = { urgent: 0, high: 1, normal: 2 }
  items.sort((left, right) => {
    const priorityDiff = priorityOrder[left.priority] - priorityOrder[right.priority]
    if (priorityDiff !== 0) return priorityDiff
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })

  const counts: OperationCounts = { shop: 0, payment: 0, refund: 0, deletion: 0, service: 0 }
  for (const item of items) counts[item.kind] += 1

  return { items, counts }
}
