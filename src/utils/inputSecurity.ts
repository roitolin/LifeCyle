const SUSPICIOUS_PATTERN =
  /(\b(select|union|drop|insert|delete|update|alter|truncate)\b|--|\/\*|\*\/|<script|<\/script>|javascript:)/i;

export const sanitizePlainText = (value: string, maxLength = 300): string => {
  const normalized = String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, maxLength);
};

export const sanitizeMultilinePlainText = (value: string, maxLength = 1500): string => {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.slice(0, maxLength);
};

export const normalizeEmail = (value: string): string => {
  return String(value || "").trim().toLowerCase();
};

export const hasSuspiciousPayload = (value: string): boolean => {
  return SUSPICIOUS_PATTERN.test(String(value || ""));
};
