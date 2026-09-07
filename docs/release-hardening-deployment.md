# Release hardening deployment

The app code expects the payment-reference, refund, account-deletion, shop
preparation-checklist, and shop schedule-event migrations in
`supabase/migrations` to be deployed before the new controls are used.

The Death Certificate Request feature requires both
`20260823000000_arrangement_hub.sql` (shared request security helpers and
notification deduplication) and
`20260823001000_death_certificate_request.sql`. Deploy both before releasing
the updated mobile bundle.

## 1. Review historical payment references

The payment migration adds unique normalized transaction references. Before
deployment, review any historical duplicate receipt references in
`funeral_service_requests.paymentReferenceNumber` and
`shop_payments.referenceNumber`. Resolve duplicates from the original receipts;
do not invent or silently rewrite financial references.

## 2. Apply database migrations

```powershell
npx supabase db push --linked
```

## 3. Deploy server functions

```powershell
npx supabase functions deploy push-notification --no-verify-jwt --use-api
npx supabase functions deploy account-deletion --use-api
```

`account-deletion` keeps JWT verification enabled and performs its own root
administrator check. It refuses permanent deletion when active service
requests, refund requests, or pending shop payments exist.

## 4. Rebuild and test the APK

```powershell
eas build --profile preview --platform android
```

Test notification taps while the app is foregrounded, backgrounded, and fully
closed. Also test duplicate payment references, payment rejection and
resubmission, refund approval and completion, deletion rejection, and deletion
blocked by an active service. For a shop request, update the preparation
checklist, reopen the request, and confirm the checked items remain synced.
On both web and mobile, create, edit, and delete a private Service Schedule
event and confirm request wake and burial milestones open Request Details.

For the Death Certificate Request feature, verify the following with separate
customer and shop accounts:

1. The shop sees a waiting state before the customer requests the document.
2. The customer requests the Death Certificate and the assigned shop receives
   a notification that opens Request Details.
3. The customer cannot see any upload control.
4. The shop marks the request as processing, then uploads and sends the
   completed certificate image.
5. The customer receives a ready notification and can open the certificate.
6. Confirm a different customer or shop cannot read or change the request.
