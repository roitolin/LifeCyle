import { supabase } from '@/lib/supabase'

export type BalancePaymentMethod = 'cash' | 'wallet' | 'bank'
export type BalanceRequest = {
  id: string
  shopId: string
  requesterId?: string
  paymentOption?: string | null
  status: string
  remainingBalance?: string | number | null
  paymentVerifiedAt?: unknown
  shopName?: string | null
  productName?: string | null
  productImageUrl?: string | null
  variationName?: string | null
  productPrice?: number | string | null
  productFullPrice?: number | string | null
  paymentAmount?: number | string | null
  downpaymentAmountSnapshot?: number | string | null
  downpaymentPercentageSnapshot?: number | string | null
}
export type BalanceReceiver = {
  id: string
  channelCode: string
  accountName: string
  accountNumber: string
}
export type BalanceReceiverType = 'wallet' | 'bank' | 'card'
export type BalancePayment = {
  id: string
  request_id: string
  amount: number | string
  method: BalancePaymentMethod
  status: 'submitted' | 'verified' | 'rejected'
  receiver_channel: string | null
  receiver_name: string | null
  receiver_number: string | null
  payer_name: string | null
  reference_number: string | null
  proof_image_path: string | null
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  provider_checkout_id?: string | null
  provider_checkout_url?: string | null
  provider_reference_id?: string | null
  provider_payment_id?: string | null
  provider_status?: 'creating' | 'active' | 'completed' | 'expired' | null
  provider_payment_method?: string | null
}

export type BalanceCheckoutResult = {
  checkoutUrl?: string
  paymentSessionId?: string
  paymentId?: string
  requestId: string
  paid?: boolean
  status?: string
  providerStatus?: string
  paymentMethod?: string
  testMode?: boolean
  livemode?: boolean
}

const getFunctionErrorMessage = async (error: unknown): Promise<string> => {
  if (!(error instanceof Error)) return 'Unable to start online payment.'
  const context = (error as Error & { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json()
      if (typeof body?.error === 'string' && body.error.trim()) return body.error
    } catch {
      // Use the safe fallback below when the response body is unavailable.
    }
  }
  return error.message || 'Unable to start online payment.'
}

export function canPayRemainingBalance(request: BalanceRequest): boolean {
  const amount = Number(request.remainingBalance)
  return request.paymentOption === 'downpayment'
    && Boolean(request.paymentVerifiedAt)
    && ['payment_verified', 'awaiting_customer_confirmation', 'completed'].includes(request.status)
    && Number.isFinite(amount) && amount > 0
}

export function balanceReceiverType(receiver: BalanceReceiver): BalanceReceiverType {
  if (receiver.channelCode === 'PH_CARDS') return 'card'
  return ['PH_GCASH', 'PH_MAYA'].includes(receiver.channelCode) ? 'wallet' : 'bank'
}

const SUPPORTED_RECEIVER_CHANNELS = new Set([
  'PH_GCASH', 'PH_MAYA', 'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK',
  'PH_LANDBANK', 'PH_PNB', 'PH_RCBC', 'PH_CHINABANK', 'PH_SECURITYBANK',
])

export function balanceChannelLabel(code: string): string {
  const labels: Record<string, string> = {
    PH_CARDS: 'Cards (Visa, Mastercard, JCB)', CARDS: 'Cards (Visa, Mastercard, JCB)',
    CARD: 'Cards (Visa, Mastercard, JCB)', CREDIT_CARD: 'Cards (Visa, Mastercard, JCB)',
    PH_GCASH: 'GCash', PH_MAYA: 'Maya', PH_BDO: 'BDO', PH_BPI: 'BPI',
    PH_UBP: 'UnionBank', PH_METROBANK: 'Metrobank', PH_LANDBANK: 'Landbank',
    PH_PNB: 'PNB', PH_RCBC: 'RCBC', PH_CHINABANK: 'Chinabank',
    PH_SECURITYBANK: 'Security Bank', PH_EASTWESTBANK: 'EastWest Bank',
  }
  return labels[code] || code.replace(/^PH_/, '').replace(/_/g, ' ')
}

export async function loadBalancePayments(request: Pick<BalanceRequest, 'id' | 'shopId'>) {
  const [payments, receivers] = await Promise.all([
    supabase.from('funeral_balance_payments').select('*')
      .eq('request_id', request.id).order('submitted_at', { ascending: false }),
    supabase.from('funeral_shop_payout_accounts').select('id,channelCode,accountName,accountNumber')
      .eq('shopId', request.shopId).eq('active', true).eq('verifiedByAdmin', true),
  ])
  if (payments.error) throw payments.error
  if (receivers.error) throw receivers.error
  const supportedReceivers = ((receivers.data || []) as BalanceReceiver[])
    .filter(receiver => SUPPORTED_RECEIVER_CHANNELS.has(receiver.channelCode.toUpperCase()))
  return {
    payments: (payments.data || []) as BalancePayment[],
    receivers: supportedReceivers,
  }
}

export async function submitBalancePayment(input: {
  requestId: string
  method: BalancePaymentMethod
  receiverAccountId?: string
  payerName?: string
  reference?: string
  proofPath?: string
}): Promise<BalancePayment> {
  const { data, error } = await supabase.from('funeral_balance_payments').insert({
    request_id: input.requestId,
    method: input.method,
    receiver_account_id: input.method === 'cash' ? null : input.receiverAccountId,
    payer_name: input.method === 'cash' ? null : input.payerName?.trim(),
    reference_number: input.method === 'cash' ? null : input.reference?.trim(),
    proof_image_path: input.method === 'cash' ? null : input.proofPath,
  }).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('This balance or transaction reference has already been submitted. Refresh to see its status.')
    throw error
  }
  return data as BalancePayment
}

export async function submitOnlineBalancePayment(input: {
  requestId: string
  receiver?: BalanceReceiver
}): Promise<BalanceCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-balance-xendit-checkout', {
    body: {
      requestId: input.requestId,
      paymentMethod: input.receiver?.channelCode || 'ANY',
      platform: 'web',
    },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  if (data?.paid !== true && typeof data?.checkoutUrl !== 'string') {
    throw new Error('Checkout link is unavailable.')
  }
  if (data?.livemode !== false && data?.testMode !== true) {
    throw new Error('Only the verified test payment checkout is available.')
  }
  return data as BalanceCheckoutResult
}

export async function syncOnlineBalancePayment(requestId: string): Promise<BalanceCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-balance-xendit-checkout', {
    body: { requestId, action: 'sync', platform: 'web' },
  })
  if (error) throw new Error(await getFunctionErrorMessage(error))
  return data as BalanceCheckoutResult
}

export async function reviewBalancePayment(id: string, status: 'verified' | 'rejected', reason?: string) {
  const { data, error } = await supabase.from('funeral_balance_payments')
    .update({ status, rejection_reason: status === 'rejected' ? reason?.trim() : null })
    .eq('id', id).eq('status', 'submitted').select('*').single()
  if (error) throw error
  if (!data) throw new Error('This balance payment has already been reviewed. Refresh and try again.')
  return data as BalancePayment
}

export async function approveShopCashBalancePayment(requestId: string): Promise<BalancePayment> {
  const { data: existingRows, error: existingError } = await supabase
    .from('funeral_balance_payments')
    .select('*')
    .eq('request_id', requestId)
    .neq('status', 'rejected')
    .order('submitted_at', { ascending: false })
  if (existingError) throw existingError

  const openPayment = ((existingRows || []) as BalancePayment[])[0]
  if (openPayment) {
    if (openPayment.status === 'verified') return openPayment
    if (openPayment.method !== 'cash') {
      throw new Error('The customer has an active online transfer receipt awaiting review.')
    }
    return reviewBalancePayment(openPayment.id, 'verified')
  }

  const { data, error } = await supabase
    .from('funeral_balance_payments')
    .insert({ request_id: requestId, method: 'cash' })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') {
      throw new Error('A balance payment was just submitted. Refresh to review its status.')
    }
    throw error
  }
  const inserted = data as BalancePayment
  if (inserted.status === 'verified') return inserted
  return reviewBalancePayment(inserted.id, 'verified')
}

export async function getBalanceReceiptUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('funeral-balance-receipts').createSignedUrl(storagePath, 300)
  if (error) throw error
  if (!data?.signedUrl) throw new Error('The private receipt is unavailable.')
  return data.signedUrl
}
