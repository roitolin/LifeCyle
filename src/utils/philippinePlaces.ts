const rawPhilippinePlaces = require("../data/philippineCitiesMunicipalities.json") as string[];

const toPlaceLabel = (value: unknown) => String(value || "").trim();
const normalizePlaceText = (value: unknown) =>
  toPlaceLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const splitPlaceTextSegments = (value: unknown) =>
  toPlaceLabel(value)
    .split(/[\n,;|()]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

export const normalizePhilippinePlace = (value: unknown) =>
  toPlaceLabel(value)
    .toLowerCase()
    .replace(/^(city|municipality)\s+of\s+/, "")
    .replace(/\s+(city|municipality)$/, "")
    .replace(/\s+/g, " ")
    .trim();

const philippinePlaces = Array.from(
  new Set((Array.isArray(rawPhilippinePlaces) ? rawPhilippinePlaces : []).map(toPlaceLabel).filter(Boolean)),
).sort((a: any, b: any) => a.localeCompare(b, "en", { sensitivity: "base" }));

const placeLookup = new Map(philippinePlaces.map((item: any) => [normalizePhilippinePlace(item), item]));
const normalizedPlaceEntries = philippinePlaces
  .map((item: any) => ({ label: item, normalized: normalizePhilippinePlace(item) }))
  .sort((a: any, b: any) => b.normalized.length - a.normalized.length);

export const PHILIPPINE_PLACES = philippinePlaces;

export const findPhilippinePlaceMatch = (query: unknown) => {
  const normalizedQuery = normalizePhilippinePlace(query);
  if (!normalizedQuery) return "";

  const exact = placeLookup.get(normalizedQuery);
  if (exact) return exact;

  const prefix = philippinePlaces.find((item) => normalizePhilippinePlace(item).startsWith(normalizedQuery));
  if (prefix) return prefix;

  return philippinePlaces.find((item) => normalizePhilippinePlace(item).includes(normalizedQuery)) || "";
};

export const extractPhilippinePlaceFromText = (value: unknown) => {
  const directMatch = findPhilippinePlaceMatch(value);
  if (directMatch) return directMatch;

  const segments = splitPlaceTextSegments(value);
  for (const segment of segments) {
    const matched = findPhilippinePlaceMatch(segment);
    if (matched) return matched;
  }

  const normalizedText = normalizePlaceText(value);
  if (!normalizedText) return "";

  const paddedText = ` ${normalizedText} `;
  return normalizedPlaceEntries.find(({ normalized }) => paddedText.includes(` ${normalized} `))?.label || "";
};

export const resolvePhilippinePlaceName = (...values: unknown[]) => {
  for (const value of values) {
    const matched = findPhilippinePlaceMatch(value);
    if (matched) return matched;
  }

  for (const value of values) {
    const matched = extractPhilippinePlaceFromText(value);
    if (matched) return matched;
  }

  return toPlaceLabel(values.find((item) => toPlaceLabel(item)));
};

export const getPhilippinePlaceSuggestions = (query: unknown, limit = 12) => {
  const normalizedQuery = normalizePhilippinePlace(query);
  if (!normalizedQuery) return PHILIPPINE_PLACES.slice(0, limit);

  return PHILIPPINE_PLACES
    .filter((item: any) => normalizePhilippinePlace(item).includes(normalizedQuery))
    .slice(0, limit);
};
