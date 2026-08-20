import { supabase } from '@/lib/supabase'

export const PAYMENT_QR_SETTING_KEY = 'payment_qr_code'

export type PaymentQrSetting = {
  imageUrl: string | null
  feeAmount: number
  updatedAt: string | null
}

export type PaymentQrDetailsPayload = {
  imageUrl: string | null
  feeAmount: number
}

export async function getPaymentQrSetting(): Promise<PaymentQrSetting> {
  const { data, error } = await supabase
    .from('settings')
    .select('value, "updatedAt"')
    .eq('key', PAYMENT_QR_SETTING_KEY)
    .maybeSingle()

  if (error) throw error

  const value = (data?.value ?? {}) as { imageUrl?: string; feeAmount?: number }

  return {
    imageUrl: value.imageUrl?.trim() || null,
    feeAmount: Number(value.feeAmount) || 0,
    updatedAt: (data?.updatedAt as string | undefined) ?? null,
  }
}

export async function savePaymentQrDetails(payload: PaymentQrDetailsPayload): Promise<void> {
  const { error } = await supabase.from('settings').upsert(
    {
      key: PAYMENT_QR_SETTING_KEY,
      value: payload,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}
