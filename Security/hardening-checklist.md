# Hardening Checklist

Use this checklist before production releases.

## Authentication

- supabase Auth enabled with email verification.
- Login brute-force guard enabled on mobile and web.
  - Mobile: `src/utils/authAttemptGuard.ts`
  - Web: `LIFECYCLE_WEB/src/utils/authAttemptGuard.ts`
- Ban/disabled account checks enforced on login.
  - Mobile login screen: `src/screens/auth/LoginScreen.tsx`
  - Web login page: `LIFECYCLE_WEB/src/pages/LoginPage.tsx`

## Authorization

- supabase rules deployed from `config/supabase/supabase.rules`.
- Chat read/write restricted to participants/admin.
- Abuse reports readable only by reporter/admin.
- Admin-only collections restricted (`admin_audit_logs`, admin announcements, etc.).

## Input Safety

- User text sanitized before writes (chat, support, requests, abuse reports).
  - Mobile helper: `src/utils/inputSecurity.ts`
- Suspicious payload patterns blocked (script/injection-like patterns).
- Server-side supabase validations mirror key client checks.

## Abuse Protection

- Rate limits in place for:
  - chat messages
  - support messages
  - abuse reports
  - request creation
- Client and rule constraints both active.
  - Runtime limiter: `src/utils/rateLimiter.ts`
  - Rule guard for `rate_limits`: `config/supabase/supabase.rules`

## Secrets & Configuration

- Supabase values loaded via `.env`.
- No hardcoded service keys in frontend source.
- Supabase Storage folders separate profile, service-media, and report-evidence uploads.

## Operations

- supabase rules deploy command documented and tested.
- Security docs updated after each security-related change.
