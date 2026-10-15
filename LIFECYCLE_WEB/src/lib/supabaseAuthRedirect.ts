export const getSupabaseEmailRedirectTo = () =>
  import.meta.env.VITE_SUPABASE_EMAIL_REDIRECT_TO || `${window.location.origin}/verify-email`;

export const getSupabasePasswordResetRedirectTo = () =>
  import.meta.env.VITE_SUPABASE_PASSWORD_RESET_REDIRECT_TO || `${window.location.origin}/reset-password`;
