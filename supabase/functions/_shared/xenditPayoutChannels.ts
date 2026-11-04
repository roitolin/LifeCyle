// Shop receiver codes predate Xendit's payout channel names. Keep the saved
// codes stable for existing accounts and translate only at the Payouts API.
const PAYOUT_CHANNEL_CODES: Record<string, string> = {
  PH_GCASH: 'PH_GCASH',
  PH_MAYA: 'PH_PAYMAYA',
  PH_BDO: 'PH_BDO',
  PH_BPI: 'PH_BPI',
  PH_UBP: 'PH_UBP',
  PH_METROBANK: 'PH_MET',
  PH_LANDBANK: 'PH_LBP',
  PH_PNB: 'PH_PNB',
  PH_RCBC: 'PH_RCBC',
  PH_CHINABANK: 'PH_CBC',
  PH_SECURITYBANK: 'PH_SEC',
};

export function xenditPayoutChannelCode(savedCode: string): string {
  const code = savedCode.trim().toUpperCase();
  const payoutCode = PAYOUT_CHANNEL_CODES[code];
  if (!payoutCode) throw new Error(`Unsupported shop payout channel: ${code}`);
  return payoutCode;
}
