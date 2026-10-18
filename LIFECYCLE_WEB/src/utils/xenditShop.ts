import { supabase } from '@/lib/supabase'

export type XenditShopCheckoutResult = {
  checkoutUrl?: string
  paymentId: string
  referenceNumber?: string
  livemode?: boolean
  reused?: boolean
  paid?: boolean
}

export type XenditShopSyncResult = {
  synced: boolean
  paid: boolean
  paymentId?: string
  status?: string
  providerStatus?: string | null
  testMode?: boolean
  livemode?: boolean
}

export type XenditShopPaymentMethod = 'all' | 'gcash' | 'ewallets' | 'cards' | 'bank_transfer'

export async function createXenditShopCheckout(
  paymentMethod: XenditShopPaymentMethod = 'all',
  reauthAccessToken?: string,
): Promise<XenditShopCheckoutResult> {
  const returnUrl = `${window.location.origin}/seller/payment`
  const { data, error } = await supabase.functions.invoke('create-xendit-shop-checkout', {
    body: { platform: 'web', returnUrl, paymentMethod },
    headers: reauthAccessToken
      ? { Authorization: `Bearer ${reauthAccessToken}` }
      : undefined,
    timeout: 20_000,
  })

  if (error) {
    let message = error.message || 'Unable to start Xendit checkout.'
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (typeof body?.error === 'string') message = body.error
      } catch {
        // Keep the safe fallback message when the response body is unavailable.
      }
    }
    throw new Error(message)
  }

  if (!data?.paid && typeof data?.checkoutUrl !== 'string') {
    throw new Error('Xendit did not return a checkout link.')
  }
  if (!data?.paid && data?.testMode !== true && data?.livemode !== false) {
    throw new Error('Checkout could not be verified. Please try again or contact support.')
  }
  return data as XenditShopCheckoutResult
}

export async function syncXenditShopPayment(): Promise<XenditShopSyncResult> {
  const { data, error } = await supabase.functions.invoke('create-xendit-shop-checkout', {
    body: { platform: 'web', action: 'sync' },
  })
  if (error) {
    let message = error.message || 'Unable to refresh Xendit payment status.'
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (typeof body?.error === 'string') message = body.error
      } catch {
        // Keep the safe fallback message when the response body is unavailable.
      }
    }
    throw new Error(message)
  }
  return data as XenditShopSyncResult
}
