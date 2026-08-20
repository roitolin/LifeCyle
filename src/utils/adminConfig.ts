import { supabase } from "@/services/supabaseClient";

type GetAdminIdOptions = {
  excludeUserId?: string;
  allowExcludedFallback?: boolean;
};

let cachedAdminIds: string[] | null = null;

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

const loadAdminIds = async (): Promise<string[]> => {
  if (cachedAdminIds) return cachedAdminIds;

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

  cachedAdminIds = uniqueAdminIds(discoveredAdminIds);
  return cachedAdminIds;
};

export const getAdminId = async (options: GetAdminIdOptions = {}): Promise<string | null> => {
  const adminIds = await loadAdminIds();
  return pickAdminId(adminIds, options);
};
