type EmailRedirectPurpose = 'verification' | 'recovery';

export const getSupabaseEmailRedirectTo = (purpose: EmailRedirectPurpose = 'verification') => {
  if (purpose === 'recovery') {
    return process.env.EXPO_PUBLIC_SUPABASE_PASSWORD_RESET_REDIRECT_TO || 'lifecycle://reset-password';
  }

  return process.env.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO || 'lifecycle://verify-email';
};
