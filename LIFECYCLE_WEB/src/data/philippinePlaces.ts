import philippineCitiesMunicipalities from './philippineCitiesMunicipalities.json'

const toPlaceLabel = (value: unknown) => String(value || '').trim()

export const normalizePhilippinePlace = (value: unknown) =>
  toPlaceLabel(value)
    .toLowerCase()
    .replace(/^(city|municipality)\s+of\s+/, '')
    .replace(/\s+(city|municipality)$/, '')
    .replace(/\s+/g, ' ')
    .trim()

const philippinePlaces = Array.from(
  new Set((Array.isArray(philippineCitiesMunicipalities) ? philippineCitiesMunicipalities : []).map(toPlaceLabel).filter(Boolean)),
).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))

const placeLookup = new Map(philippinePlaces.map((item) => [normalizePhilippinePlace(item), item]))

export const PHILIPPINE_PLACES = philippinePlaces

export const findPhilippinePlaceMatch = (query: unknown) => {
  const normalizedQuery = normalizePhilippinePlace(query)
  if (!normalizedQuery) return ''

  const exact = placeLookup.get(normalizedQuery)
  if (exact) return exact

  const prefix = philippinePlaces.find((item) => normalizePhilippinePlace(item).startsWith(normalizedQuery))
  if (prefix) return prefix

  return philippinePlaces.find((item) => normalizePhilippinePlace(item).includes(normalizedQuery)) || ''
}

export const resolvePhilippinePlaceName = (...values: unknown[]) => {
  for (const value of values) {
    const matched = findPhilippinePlaceMatch(value)
    if (matched) return matched
  }

  return toPlaceLabel(values.find((item) => toPlaceLabel(item)))
}

export const getPhilippinePlaceSuggestions = (query: unknown, limit = 12) => {
  const normalizedQuery = normalizePhilippinePlace(query)
  if (!normalizedQuery) return PHILIPPINE_PLACES.slice(0, limit)

  return PHILIPPINE_PLACES
    .filter((item) => normalizePhilippinePlace(item).includes(normalizedQuery))
    .slice(0, limit)
}
