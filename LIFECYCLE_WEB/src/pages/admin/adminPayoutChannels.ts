import { PAYOUT_CHANNEL_LOGOS } from '@/assets/paymentLogoAssets'

export type PayoutChannel = {
  code: string
  label: string
  type: 'wallet' | 'bank'
  shortName: string
  logoUrl: string
}

export const PAYOUT_CHANNELS: PayoutChannel[] = [
  { code: 'PH_GCASH', label: 'GCash', type: 'wallet', shortName: 'GCash', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_GCASH },
  { code: 'PH_MAYA', label: 'Maya', type: 'wallet', shortName: 'Maya', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_MAYA },
  { code: 'PH_BDO', label: 'BDO Unibank', type: 'bank', shortName: 'BDO', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_BDO },
  { code: 'PH_BPI', label: 'Bank of the Philippine Islands (BPI)', type: 'bank', shortName: 'BPI', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_BPI },
  { code: 'PH_METROBANK', label: 'Metrobank', type: 'bank', shortName: 'Metrobank', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_METROBANK },
  { code: 'PH_LANDBANK', label: 'Landbank of the Philippines', type: 'bank', shortName: 'Landbank', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_LANDBANK },
  { code: 'PH_CHINABANK', label: 'China Banking Corporation', type: 'bank', shortName: 'Chinabank', logoUrl: PAYOUT_CHANNEL_LOGOS.PH_CHINABANK },
]

export function getChannelInfo(code?: string | null): PayoutChannel | null {
  if (!code) return null
  return PAYOUT_CHANNELS.find((channel) => channel.code === code) || null
}
