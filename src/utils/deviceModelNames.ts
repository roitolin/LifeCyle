type FriendlyDeviceNameInput = {
  manufacturer?: string | null;
  brand?: string | null;
  model?: string | null;
  platform: string;
  browserName?: string | null;
};

const DEVICE_MARKETING_NAMES: Record<string, string> = {
  '23129RAA4G': 'Xiaomi Redmi Note 13 4G',
};

function clean(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function marketingNameFor(value?: string | null) {
  const normalized = clean(value).toUpperCase();
  if (!normalized) return null;

  if (DEVICE_MARKETING_NAMES[normalized]) {
    return DEVICE_MARKETING_NAMES[normalized];
  }

  const matchingCode = Object.keys(DEVICE_MARKETING_NAMES).find((code) =>
    new RegExp('(^|[^A-Z0-9])' + code + '([^A-Z0-9]|$)', 'i').test(normalized)
  );
  return matchingCode ? DEVICE_MARKETING_NAMES[matchingCode] : null;
}

export function resolveFriendlyDeviceName({
  manufacturer,
  brand,
  model,
  platform,
  browserName,
}: FriendlyDeviceNameInput) {
  const cleanManufacturer = clean(manufacturer);
  const cleanBrand = clean(brand);
  const cleanModel = clean(model);
  const mappedName = marketingNameFor(cleanModel);

  if (mappedName) return mappedName;
  if (platform === 'web') return clean(browserName) || 'Web browser';

  if (cleanModel) {
    const preferredMaker = cleanManufacturer || cleanBrand;
    if (!preferredMaker || cleanModel.toLowerCase().startsWith(preferredMaker.toLowerCase())) {
      return cleanModel;
    }
    return preferredMaker + ' ' + cleanModel;
  }

  if (cleanBrand || cleanManufacturer) return cleanBrand || cleanManufacturer;
  return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) + ' device' : 'Unknown device';
}

export function formatStoredDeviceName(value?: string | null) {
  const storedName = clean(value);
  return marketingNameFor(storedName) || storedName || 'Unknown device';
}
