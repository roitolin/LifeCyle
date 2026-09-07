import { supabase } from "@/services/supabaseClient";

type GetAdminIdOptions = {
  excludeUserId?: string;
  allowExcludedFallback?: boolean;
};

let cachedAdminIds: string[] | null = null;
let cacheExpiresAt = 0;
let adminLoadPromise: Promise<string[]> | null = null;
const ADMIN_CACHE_MS = 5 * 60 * 1000;

const normalizeAdminId = (value: unknown): string | null => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const uniqueAdminIds = (ids: (string | null | undefined)[]): string[] => {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
};

const pickAdminId = (
  adminIds: string[],
  { excludeUserId, allowExcludedFallback = false }: GetAdminIdOptions = {}
): string | null => {
  const excludedId = normalizeAdminId(excludeUserId);
  const preferredAdminId = adminIds.find((id) => id !== excludedId) || null;
  if (preferredAdminId) {
    return preferredAdminId;
  }
  if (allowExcludedFallback && excludedId && adminIds.includes(excludedId)) {
    return excludedId;
  }
  return adminIds[0] || null;
};

const discoverAdminIds = async (): Promise<string[]> => {
  if (cachedAdminIds && Date.now() < cacheExpiresAt) return cachedAdminIds;

  const discoveredAdminIds: string[] = [];

  try {
    const { data } = await supabase.from("settings").select("value").eq("key", "admin").maybeSingle();
    const value = data?.value as { userId?: unknown; userIds?: unknown } | undefined;
    if (value) {
      const configuredIds = Array.isArray(value.userIds)
        ? value.userIds.map(normalizeAdminId)
        : [normalizeAdminId(value.userId)];
      discoveredAdminIds.push(...uniqueAdminIds(configuredIds));
    }
  } catch {
    // Ignore missing permissions on /settings and fallback below.
  }

  // Fallback source: active admin user documents.
  try {
    const { data } = await supabase
      .from("users")
      .select("id")
      .in("role", ["super_admin", "admin", "funeral_admin"])
      .limit(10);
    discoveredAdminIds.push(...(data || []).map((item: any) => item.id));
  } catch {
    // Keep silent to avoid noisy logs in production UI.
  }

  const uniqueIds = uniqueAdminIds(discoveredAdminIds);
  if (uniqueIds.length > 0) {
    cachedAdminIds = uniqueIds;
    cacheExpiresAt = Date.now() + ADMIN_CACHE_MS;
  }
  return uniqueIds;
};

const loadAdminIds = async (): Promise<string[]> => {
  if (cachedAdminIds && Date.now() < cacheExpiresAt) return cachedAdminIds;
  if (!adminLoadPromise) {
    adminLoadPromise = discoverAdminIds().finally(() => {
      adminLoadPromise = null;
    });
  }
  return adminLoadPromise;
};

export const getAdminIds = async (options: GetAdminIdOptions = {}): Promise<string[]> => {
  const adminIds = await loadAdminIds();
  const excludedId = normalizeAdminId(options.excludeUserId);
  const filteredIds = excludedId ? adminIds.filter((id) => id !== excludedId) : adminIds;
  if (filteredIds.length > 0) return filteredIds;
  return options.allowExcludedFallback ? adminIds : [];
};

export const clearAdminIdCache = () => {
  cachedAdminIds = null;
  cacheExpiresAt = 0;
};

export const getAdminId = async (options: GetAdminIdOptions = {}): Promise<string | null> => {
  const adminIds = await loadAdminIds();
  return pickAdminId(adminIds, options);
};
