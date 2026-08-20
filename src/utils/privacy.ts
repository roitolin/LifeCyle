const normalize = (value: unknown) => String(value ?? "").trim();

export const canViewExactRequestLocation = (request: any, currentUserId?: string | null, role?: string | null) => {
  if (!request) return false;
  if (role === "admin") return true;
  if (!currentUserId) return false;
  if (request.requesterId === currentUserId) return true;
  if (request.acceptedBy === currentUserId) return true;
  return false;
};

export const getRequestLocationText = (
  request: { city?: string; locationLabel?: string | null },
  revealExact: boolean
) => {
  const city = normalize(request?.city) || "Unknown City";
  const label = normalize(request?.locationLabel);

  if (!revealExact) return city;
  if (label) return label;
  return city;
};

export const getProviderLocationText = (
  provider: { city?: string; street?: string | null },
  revealExact: boolean
) => {
  const city = normalize(provider?.city) || "Unknown City";
  const street = normalize(provider?.street);

  if (!revealExact) return city;
  const parts = [street, city].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : city;
};
