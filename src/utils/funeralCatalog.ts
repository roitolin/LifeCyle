export function formatPhilippinePeso(value: string | number | null | undefined) {
  const raw = typeof value === "number" ? String(value) : String(value || "");
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return "₱0";

  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return "₱0";

  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function normalizePesoInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return "";

  const [wholePart, decimalPart] = cleaned.split(".");
  const formattedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (decimalPart !== undefined) {
    return `₱${formattedWhole}.${decimalPart.slice(0, 2)}`;
  }
  return `₱${formattedWhole}`;
}
