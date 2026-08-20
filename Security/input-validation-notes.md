# Input Validation Notes

## Client-side Helpers

- Mobile:
  - `src/utils/inputSecurity.ts`
- Web:
  - `LIFECYCLE_WEB/src/utils/inputSecurity.ts`

## Integration Points

- Mobile login normalization: `src/screens/auth/LoginScreen.tsx`
- Web login normalization: `LIFECYCLE_WEB/src/pages/LoginPage.tsx`
- Mobile chat send validation: `src/screens/shared/ChatScreen.tsx`
- Mobile support form validation: `src/screens/user/ContactScreen.tsx`
- Mobile request form validation: `src/screens/user/CreateRequestScreen.tsx`
- Mobile abuse report validation: `src/screens/shared/DisputeReportScreen.tsx`

## Covered Flows

- Login email normalization.
- Chat message sanitization and suspicious-pattern block.
- Support message sanitization and suspicious-pattern block.
- Request create/edit sanitization for patient/hospital/city/contact.
- Abuse report sanitization for reason/details/target user ID.

## Server-side Backstop

supabase rules also enforce key constraints:

- Request create payload validation.
- Abuse report create payload validation.
- Message ownership/immutability and participant checks.
- Rule file: `config/supabase/supabase.rules`

This dual-layer approach helps protect both UX and data integrity.
