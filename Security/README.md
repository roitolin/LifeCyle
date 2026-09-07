# Security

This folder stores security-related documentation and operational notes for LifeCycle.

## Contents

- `hardening-checklist.md`
- `incident-response.md`
- `supabase-rules-deploy.md`
- `auth-rate-limit-notes.md`
- `input-validation-notes.md`

## Code References

- supabase rules: `config/supabase/supabase.rules`
- Mobile rate limit core: `src/utils/rateLimiter.ts`
- Mobile login attempt guard: `src/utils/authAttemptGuard.ts`
- Web login attempt guard: `LIFECYCLE_WEB/src/utils/authAttemptGuard.ts`
- Mobile input safety helpers: `src/utils/inputSecurity.ts`
- Web input safety helpers: `LIFECYCLE_WEB/src/utils/inputSecurity.ts`

## Current Security Controls (Summary)

- supabase rules hardened for requests/chat/abuse reports.
- Client-side and rule-side input validation for risky payloads.
- Login attempt guards (mobile + web) for brute-force mitigation.
- Rate limiting for chat, support messages, abuse reports, and request creation.

## Deployment Reminder

After rule changes, deploy with:

```bash
supabase deploy --only supabase:rules
```
