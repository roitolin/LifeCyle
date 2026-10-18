import bdoLogoUrl from '../../../assets/Payment Logos/BDO_Logo.png'
import bpiLogoUrl from '../../../assets/Payment Logos/BPI_Logo.png'
import chinabankLogoUrl from '../../../assets/Payment Logos/Chinabank_Logo.png'
import gcashLogoUrl from '../../../assets/Payment Logos/Gcash_Logo.png'
import landbankLogoUrl from '../../../assets/Payment Logos/Landbank_logo.png'
import metrobankLogoUrl from '../../../assets/Payment Logos/MetroBank_Logo.png'
import mayaLogoUrl from '../../../assets/Payment Logos/PayMaya_Logo.png'
import visaLogoUrl from '../../../assets/Payment Logos/Visa_Logo.png'

export const PAYMENT_LOGOS = {
  bdo: bdoLogoUrl,
  bpi: bpiLogoUrl,
  chinabank: chinabankLogoUrl,
  gcash: gcashLogoUrl,
  landbank: landbankLogoUrl,
  metrobank: metrobankLogoUrl,
  maya: mayaLogoUrl,
  visa: visaLogoUrl,
} as const

export const PAYOUT_CHANNEL_LOGOS: Readonly<Record<string, string>> = {
  PH_GCASH: PAYMENT_LOGOS.gcash,
  PH_MAYA: PAYMENT_LOGOS.maya,
  PH_BDO: PAYMENT_LOGOS.bdo,
  PH_BPI: PAYMENT_LOGOS.bpi,
  PH_METROBANK: PAYMENT_LOGOS.metrobank,
  PH_LANDBANK: PAYMENT_LOGOS.landbank,
  PH_CHINABANK: PAYMENT_LOGOS.chinabank,
}
