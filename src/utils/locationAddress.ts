import { findPhilippinePlaceMatch, resolvePhilippinePlaceName } from "./philippinePlaces";

export type ReverseGeocodedAddress = {
  streetNumber?: string;
  street?: string;
  city?: string;
  district?: string;
  subregion?: string;
  region?: string;
  country?: string;
  postalCode?: string;
  formattedAddress?: string;
};

const pickFirst = (...values: (string | undefined | null)[]) =>
  values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() || "";

const resolveKnownPhilippinePlace = (...values: unknown[]) => {
  for (const value of values) {
    const matched = findPhilippinePlaceMatch(value);
    if (matched) return matched;
  }

  return "";
};

export const normalizeNominatimAddress = (rawAddress: any): ReverseGeocodedAddress => {
  const city =
    resolveKnownPhilippinePlace(
      rawAddress?.city,
      rawAddress?.town,
      rawAddress?.municipality,
      rawAddress?.county,
      rawAddress?.locality,
      rawAddress?.district,
      rawAddress?.borough,
      rawAddress?.city_district,
      rawAddress?.village,
      rawAddress?.suburb,
      rawAddress?.hamlet,
    ) || pickFirst(rawAddress?.city, rawAddress?.town, rawAddress?.municipality, rawAddress?.county, rawAddress?.locality);
  const district = pickFirst(
    rawAddress?.district,
    rawAddress?.borough,
    rawAddress?.city_district,
    rawAddress?.quarter,
    rawAddress?.suburb,
    rawAddress?.village,
    rawAddress?.hamlet,
  );
  const subregion = pickFirst(rawAddress?.county, rawAddress?.state_district, rawAddress?.province);
  const region = pickFirst(rawAddress?.state, rawAddress?.region);
  const streetNumber = pickFirst(rawAddress?.house_number);
  const street = pickFirst(rawAddress?.road, rawAddress?.pedestrian, rawAddress?.footway);

  return {
    streetNumber,
    street,
    city,
    district,
    subregion,
    region,
    country: pickFirst(rawAddress?.country),
    postalCode: pickFirst(rawAddress?.postcode),
  };
};

export const normalizeExpoAddress = (rawAddress: any): ReverseGeocodedAddress => {
  const city =
    resolveKnownPhilippinePlace(rawAddress?.city, rawAddress?.district, rawAddress?.subregion) ||
    pickFirst(rawAddress?.city);

  return {
    streetNumber: pickFirst(rawAddress?.streetNumber),
    street: pickFirst(rawAddress?.street, rawAddress?.name),
    city,
    district: pickFirst(rawAddress?.district),
    subregion: pickFirst(rawAddress?.subregion),
    region: pickFirst(rawAddress?.region),
    country: pickFirst(rawAddress?.country),
    postalCode: pickFirst(rawAddress?.postalCode),
  };
};

export const getAddressLocalityLabel = (address: ReverseGeocodedAddress | null | undefined) =>
  resolvePhilippinePlaceName(
    address?.city,
    address?.district,
    address?.subregion,
    address?.formattedAddress,
    address?.region,
  ) || pickFirst(address?.city, address?.subregion, address?.district, address?.region);

export const formatAddressLabel = (address: ReverseGeocodedAddress | null) => {
  if (!address) return "";
  const streetLine = [address.streetNumber, address.street].filter(Boolean).join(" ").trim();
  const parts = [streetLine, getAddressLocalityLabel(address), address.region]
    .filter(Boolean)
    .map((item: any) => item?.trim())
    .filter((item, index, values) => Boolean(item) && values.indexOf(item) === index);
  return parts.join(", ");
};

export const mergeReverseGeocodedAddresses = (
  ...addresses: (ReverseGeocodedAddress | null | undefined)[]
): ReverseGeocodedAddress | null => {
  const keys: (keyof ReverseGeocodedAddress)[] = [
    "streetNumber",
    "street",
    "city",
    "district",
    "subregion",
    "region",
    "country",
    "postalCode",
    "formattedAddress",
  ];
  const merged: ReverseGeocodedAddress = {};

  for (const address of addresses) {
    if (!address) continue;

    for (const key of keys) {
      const value = address[key];
      if (!merged[key] && typeof value === "string" && value.trim()) {
        merged[key] = value.trim();
      }
    }
  }

  if (!keys.some((key) => Boolean(merged[key]))) {
    return null;
  }

  const formattedAddress = formatAddressLabel(merged) || merged.formattedAddress || "";
  return formattedAddress ? { ...merged, formattedAddress } : merged;
};
