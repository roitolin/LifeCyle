import { collection, doc, getDocs, serverTimestamp, writeBatch, type Supabase } from '@/lib/supabaseDbCompat'

type CityCountItem = {
  cityKey: string
  cityLabel: string
  providers: number
  requests: number
}

function normalizeCity(value: string | undefined | null) {
  const base = String(value || '').trim().toLowerCase()
  if (!base) return ''

  const noPrefix = base.replace(/^(city|municipality) of\s+/, '')
  const noSuffix = noPrefix.replace(/\s+(city|municipality)$/, '')
  return noSuffix
}

function toCityLabel(normalizedCity: string) {
  return normalizedCity
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function syncPublicCityAvailability(db: Supabase) {
  const [shopsSnap, requestsSnap, publicSnap] = await Promise.all([
    getDocs(collection(db, 'funeral_shops')),
    getDocs(collection(db, 'funeral_service_requests')),
    getDocs(collection(db, 'public_city_availability')),
  ])

  const cityMap = new Map<string, CityCountItem>()

  shopsSnap.docs
    .map((itemDoc: any) => itemDoc.data() as { status?: string; generalLocation?: string })
    .filter((item: any) => ['verified', 'live'].includes(String(item.status || '').toLowerCase()))
    .forEach((item: any) => {
      const cityKey = normalizeCity(item.generalLocation)
      if (!cityKey) return
      const current = cityMap.get(cityKey) || { cityKey, cityLabel: toCityLabel(cityKey), providers: 0, requests: 0 }
      current.providers += 1
      cityMap.set(cityKey, current)
    })

  requestsSnap.docs
    .map((itemDoc: any) => itemDoc.data() as { status?: string; city?: string })
    .filter((item: any) => {
      const status = String(item.status || '').toLowerCase()
      return status === 'pending' || status === 'accepted'
    })
    .forEach((item: any) => {
      const cityKey = normalizeCity(item.city)
      if (!cityKey) return
      const current = cityMap.get(cityKey) || { cityKey, cityLabel: toCityLabel(cityKey), providers: 0, requests: 0 }
      current.requests += 1
      cityMap.set(cityKey, current)
    })

  const batch = writeBatch()
  const nextKeys = new Set(cityMap.keys())

  publicSnap.docs.forEach((itemDoc: any) => {
    if (!nextKeys.has(itemDoc.id)) {
      batch.delete(itemDoc.ref)
    }
  })

  cityMap.forEach((item, cityKey) => {
    batch.set(doc(db, 'public_city_availability', cityKey), {
      cityKey,
      cityLabel: item.cityLabel,
      providers: item.providers,
      requests: item.requests,
      updatedAt: serverTimestamp(),
    })
  })

  await batch.commit()
}

