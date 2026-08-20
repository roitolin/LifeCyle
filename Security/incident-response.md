# Incident Response (Template)

## 1. Detect

- What happened?
- When did it start?
- Who reported it?

## 2. Contain

- Disable affected flow if needed.
- Tighten supabase rule paths if actively exploited.
- Revoke/rotate exposed credentials if applicable.
- Reference rule file: `config/supabase/supabase.rules`

## 3. Eradicate

- Patch root cause in code and/or rules.
- Add tests or checks to prevent recurrence.
- Common security code paths:
  - `src/utils/rateLimiter.ts`
  - `src/utils/authAttemptGuard.ts`
  - `LIFECYCLE_WEB/src/utils/authAttemptGuard.ts`
  - `src/utils/inputSecurity.ts`
  - `LIFECYCLE_WEB/src/utils/inputSecurity.ts`

## 4. Recover

- Redeploy fixed rules/app.
- Validate critical flows:
  - login
  - chat
  - request creation
  - reporting

## 5. Postmortem

- Document impact, timeline, root cause, and action items.
- Update security docs in this folder.
