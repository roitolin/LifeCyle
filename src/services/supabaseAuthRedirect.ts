export const getSupabaseEmailRedirectTo = () =>
  process.env.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO || "lifecycle://verify-email";
