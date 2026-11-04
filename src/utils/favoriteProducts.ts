import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'lifecycle.favorite-products.v1';
const listeners = new Set<(ids: Set<string>) => void>();
let favoriteIds = new Set<string>();
let loaded = false;
let loadInFlight: Promise<Set<string>> | null = null;

function publish() {
  const snapshot = new Set(favoriteIds);
  listeners.forEach((listener) => listener(snapshot));
}

export async function loadFavoriteProductIds(): Promise<Set<string>> {
  if (loaded) return new Set(favoriteIds);
  if (loadInFlight) return loadInFlight;

  loadInFlight = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      favoriteIds = new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
      loaded = true;
      return new Set(favoriteIds);
    })
    .catch(() => {
      favoriteIds = new Set();
      loaded = true;
      return new Set(favoriteIds);
    })
    .finally(() => { loadInFlight = null; });

  return loadInFlight;
}

export async function toggleFavoriteProduct(productId: string): Promise<Set<string>> {
  const cleanId = productId.trim();
  if (!cleanId) return loadFavoriteProductIds();
  await loadFavoriteProductIds();
  const next = new Set(favoriteIds);
  if (next.has(cleanId)) next.delete(cleanId);
  else next.add(cleanId);
  favoriteIds = next;
  publish();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
  return new Set(next);
}

export function subscribeFavoriteProducts(listener: (ids: Set<string>) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
