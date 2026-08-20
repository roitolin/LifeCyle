const padTwoDigits = (value: number) => String(value).padStart(2, "0");

export const serializeDateOnly = (value: Date | null | undefined): string | null => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return `${value.getFullYear()}-${padTwoDigits(value.getMonth() + 1)}-${padTwoDigits(value.getDate())}`;
};

export const parseDateOnly = (value: string | null | undefined): Date | null => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const serializeTimeOnly = (value: Date | null | undefined): string | null => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return `${padTwoDigits(value.getHours())}:${padTwoDigits(value.getMinutes())}:00`;
};

export const parseTimeOnly = (value: string | null | undefined): Date | null => {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const parsed = new Date();
  parsed.setHours(hours, minutes, 0, 0);
  return parsed;
};

export const formatServiceDate = (
  value: string | null | undefined,
  fallback = "Not provided",
): string => {
  const parsed = parseDateOnly(value);
  if (!parsed) return fallback;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

export const formatServiceTime = (
  value: string | null | undefined,
  fallback = "Not provided",
): string => {
  const parsed = parseTimeOnly(value);
  if (!parsed) return fallback;
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const validateServiceSchedule = ({
  wakeStartDate,
  wakeEndDate,
  burialTime,
  dateOfPassing,
}: {
  wakeStartDate: Date | null;
  wakeEndDate: Date | null;
  burialTime: Date | null;
  dateOfPassing?: Date | null;
}): "incomplete" | "before_passing" | "invalid_range" | null => {
  const start = serializeDateOnly(wakeStartDate);
  const end = serializeDateOnly(wakeEndDate);
  const passing = serializeDateOnly(dateOfPassing);
  if (!start || !end || !serializeTimeOnly(burialTime)) return "incomplete";
  if (passing && start < passing) return "before_passing";
  if (end < start) return "invalid_range";
  return null;
};
