# Supabase Email Verification Setup

## Supabase Dashboard

1. Open Authentication > Sign In / Providers > Email.
2. Enable email confirmations.
3. Open Authentication > URL Configuration.
4. Set Site URL to your web app URL:
   - Local: `http://localhost:6050`
   - Production: your deployed web URL
5. Add Redirect URLs:
   - `http://localhost:6050/*`
   - `lifecycle://verify-email`
   - Your production web URL with `/*`

The mobile app already has the Expo scheme configured as `lifecycle`, so Supabase links that start with `lifecycle://verify-email` can return to the app.

## App Env Values

Mobile uses:

```env
EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO=lifecycle://verify-email
```

Web uses:

```env
VITE_SUPABASE_EMAIL_REDIRECT_TO=http://localhost:6050/verify-email
```

Restart Expo or Vite after changing these values.

## User Flow

1. User registers.
2. Supabase sends the verification email.
3. User clicks the email link.
4. User returns to the app.
5. The app exchanges the Supabase verification code for a session.
6. On mobile, tap "I've Verified My Email" if the app does not continue automatically.
