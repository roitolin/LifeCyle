import philippineCitiesMunicipalities from './philippineCitiesMunicipalities.json'

const sortPlaces = (places: string[]) =>
  [...places].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))

const PHILIPPINE_PLACES = sortPlaces(
  Array.from(
    new Set(
      (Array.isArray(philippineCitiesMunicipalities) ? philippineCitiesMunicipalities : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ),
)

export async function fetchPhilippineCitiesAndMunicipalities() {
  return PHILIPPINE_PLACES
}

export const PHILIPPINE_CITIES = PHILIPPINE_PLACES
