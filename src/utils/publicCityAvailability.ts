import { supabase } from "@/services/supabaseClient";

type CityCountItem = {
  id: string; // The primary key (cityKey)
  cityKey: string;
  cityLabel: string;
  providers: number;
  requests: number;
};

function normalizeCity(value: string | undefined | null) {
  const base = String(value || "").trim().toLowerCase();
  if (!base) return "";

  const noPrefix = base.replace(/^(city|municipality) of\s+/, "");
  const noSuffix = noPrefix.replace(/\s+(city|municipality)$/, "");
  return noSuffix;
}

function toCityLabel(normalizedCity: string) {
  return normalizedCity
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function syncPublicCityAvailability(db: any) { // db kept for signature compatibility
  const [shopsRes, requestsRes, publicRes] = await Promise.all([
    supabase
      .from("funeral_shops")
      .select("generalLocation, status")
      .eq("status", "live")
      .gt("paidUntil", new Date().toISOString()),
    supabase
      .from("funeral_service_requests")
      .select("city, status")
      .in("status", ["pending", "accepted", "pending_shop_acceptance"]),
    supabase
      .from("public_city_availability")
      .select("id"),
  ]);

  const cityMap = new Map<string, CityCountItem>();

  (shopsRes.data || []).forEach((item: any) => {
    const cityKey = normalizeCity(item.generalLocation);
    if (!cityKey) return;
    const current = cityMap.get(cityKey) || { id: cityKey, cityKey, cityLabel: toCityLabel(cityKey), providers: 0, requests: 0 };
    current.providers += 1;
    cityMap.set(cityKey, current);
  });

  (requestsRes.data || []).forEach((item: any) => {
    const cityKey = normalizeCity(item.city);
    if (!cityKey) return;
    const current = cityMap.get(cityKey) || { id: cityKey, cityKey, cityLabel: toCityLabel(cityKey), providers: 0, requests: 0 };
    current.requests += 1;
    cityMap.set(cityKey, current);
  });

  const nextKeys = new Set(cityMap.keys());
  const existingKeys = (publicRes.data || []).map((d) => d.id);
  const keysToDelete = existingKeys.filter((k) => !nextKeys.has(k));

  if (keysToDelete.length > 0) {
    await supabase.from("public_city_availability").delete().in("id", keysToDelete);
  }

  const itemsToUpsert = Array.from(cityMap.values()).map(item => ({
    id: item.cityKey,
    "cityKey": item.cityKey,
    "cityLabel": item.cityLabel,
    providers: item.providers,
    requests: item.requests,
    "updatedAt": new Date().toISOString()
  }));

  if (itemsToUpsert.length > 0) {
    await supabase.from("public_city_availability").upsert(itemsToUpsert);
  }
}

