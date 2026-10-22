import { supabase } from '@/lib/supabase'

export const PAYMENT_SETTING_KEY = 'shop_payment_settings'

export type PaymentSetting = {
  feeAmount: number
  updatedAt: string | null
}

export async function getPaymentSetting(): Promise<PaymentSetting> {
  const { data, error } = await supabase
    .from('settings')
    .select('value, updatedAt')
    .eq('key', PAYMENT_SETTING_KEY)
    .maybeSingle()

  if (error) throw error

  const value = (data?.value ?? {}) as { feeAmount?: number }

  return {
    feeAmount: Number(value.feeAmount) || 0,
    updatedAt: (data?.updatedAt as string | undefined) ?? null,
  }
}

export async function savePaymentSetting(feeAmount: number): Promise<void> {
  const { error } = await supabase.from('settings').upsert(
    {
      key: PAYMENT_SETTING_KEY,
      value: { feeAmount },
      updatedAt: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}
