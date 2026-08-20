export const getSupabaseEmailRedirectTo = () =>
  import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_TO || `${window.location.origin}/verify-email`;
