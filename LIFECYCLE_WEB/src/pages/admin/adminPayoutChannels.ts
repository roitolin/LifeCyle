export type PayoutChannel = {
  code: string
  label: string
  type: 'wallet' | 'bank'
  shortName: string
}

export const PAYOUT_CHANNELS: PayoutChannel[] = [
  { code: 'PH_GCASH', label: 'GCash', type: 'wallet', shortName: 'GCash' },
  { code: 'PH_MAYA', label: 'Maya', type: 'wallet', shortName: 'Maya' },
  { code: 'PH_BDO', label: 'BDO Unibank', type: 'bank', shortName: 'BDO' },
  { code: 'PH_BPI', label: 'Bank of the Philippine Islands (BPI)', type: 'bank', shortName: 'BPI' },
  { code: 'PH_UBP', label: 'UnionBank of the Philippines', type: 'bank', shortName: 'UnionBank' },
  { code: 'PH_METROBANK', label: 'Metrobank', type: 'bank', shortName: 'Metrobank' },
  { code: 'PH_LANDBANK', label: 'Landbank of the Philippines', type: 'bank', shortName: 'Landbank' },
  { code: 'PH_PNB', label: 'Philippine National Bank (PNB)', type: 'bank', shortName: 'PNB' },
  { code: 'PH_RCBC', label: 'Rizal Commercial Banking Corp (RCBC)', type: 'bank', shortName: 'RCBC' },
  { code: 'PH_CHINABANK', label: 'China Banking Corporation', type: 'bank', shortName: 'Chinabank' },
  { code: 'PH_SECURITYBANK', label: 'Security Bank', type: 'bank', shortName: 'Security Bank' },
  { code: 'PH_EASTWESTBANK', label: 'EastWest Bank', type: 'bank', shortName: 'EastWest' },
]

export function getChannelInfo(code?: string | null): PayoutChannel | null {
  if (!code) return null
  return PAYOUT_CHANNELS.find((channel) => channel.code === code) || null
}
