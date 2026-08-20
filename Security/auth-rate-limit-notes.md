# Auth & Rate Limit Notes

## Login Brute-force Guard

### Mobile

- File: `src/utils/authAttemptGuard.ts`
- Login integration: `src/screens/auth/LoginScreen.tsx`
- Storage: AsyncStorage
- Policy:
  - Window: 10 minutes
  - Max failed attempts in window: 5
  - Lockout: 10 minutes

### Web

- File: `LIFECYCLE_WEB/src/utils/authAttemptGuard.ts`
- Login integration: `LIFECYCLE_WEB/src/pages/LoginPage.tsx`
- Storage: `localStorage`
- Same policy as mobile.

## In-App Action Rate Limits

- File: `src/utils/rateLimiter.ts`
- supabase collection: `rate_limits`
- Rule enforcement: `config/supabase/supabase.rules`
- Integrations:
  - `src/screens/shared/ChatScreen.tsx`
  - `src/screens/user/ContactScreen.tsx`
  - `src/screens/shared/DisputeReportScreen.tsx`
  - `src/screens/user/CreateRequestScreen.tsx`

Current policies:

- `chat_message`: 12 / 60 seconds / conversation scope
- `support_message`: 3 / 5 minutes / user scope
- `abuse_report`: 3 / 10 minutes / user-target scope
- `create_request`: 4 / 60 minutes / user scope
