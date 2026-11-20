export const SHOP_CHECKOUT_CHANNELS = [
  { accountChannel: 'PH_GCASH', providerChannel: 'GCASH', label: 'GCash', type: 'wallet' },
  { accountChannel: 'PH_MAYA', providerChannel: 'PAYMAYA', label: 'Maya', type: 'wallet' },
  { accountChannel: 'PH_BDO', providerChannel: 'BDO_ONLINE_BANKING', label: 'BDO online banking', type: 'bank' },
  { accountChannel: 'PH_BPI', providerChannel: 'BPI_ONLINE_BANKING', label: 'BPI online banking', type: 'bank' },
  { accountChannel: 'PH_UBP', providerChannel: 'UNIONBANK_ONLINE_BANKING', label: 'UnionBank online banking', type: 'bank' },
  { accountChannel: 'PH_METROBANK', providerChannel: 'METROBANK_ONLINE_BANKING', label: 'Metrobank online banking', type: 'bank' },
  { accountChannel: 'PH_LANDBANK', providerChannel: 'LANDBANK_ONLINE_BANKING', label: 'Landbank online banking', type: 'bank' },
  { accountChannel: 'PH_PNB', providerChannel: 'PNB_ONLINE_BANKING', label: 'PNB online banking', type: 'bank' },
  { accountChannel: 'PH_RCBC', providerChannel: 'RCBC_ONLINE_BANKING', label: 'RCBC online banking', type: 'bank' },
  { accountChannel: 'PH_CHINABANK', providerChannel: 'CHINABANK_ONLINE_BANKING', label: 'China Bank online banking', type: 'bank' },
  { accountChannel: 'PH_SECURITYBANK', providerChannel: 'SECURITY_BANK_ONLINE_BANKING', label: 'Security Bank online banking', type: 'bank' },
] as const;

export function availableShopCheckoutChannels(_receiverChannels?: Iterable<string>) {
  // Customer payments are collected by the platform/admin Xendit checkout.
  // Shops withdraw their 70% share separately via Shop Withdrawals.
  return [...SHOP_CHECKOUT_CHANNELS];
}

export function matchesAllowedPaymentChannels(actual: unknown, expected: readonly string[]) {
  if (!Array.isArray(actual) || actual.some((channel) => typeof channel !== 'string')) return false;
  const normalized = actual.map((channel) => channel.trim().toUpperCase());
  return normalized.length === expected.length &&
    new Set(normalized).size === expected.length &&
    normalized.every((channel) => expected.includes(channel));
}
