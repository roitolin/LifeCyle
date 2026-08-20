export const normalizeEmail = (value: string): string => {
  return String(value || '').trim().toLowerCase()
}
