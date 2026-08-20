# Funeral Data Model

This document defines the supabase shape used for funeral registration data in BloodLink.

## Storage Location

- Collection: `users`
- Document ID: authenticated account UID (`users/{uid}`)
- Funeral registration data is stored as nested fields on the user profile document.
- Planned dedicated collections also exist for future migration:
  - `funeral_shops`
  - `funeral_items`

See: [funeral-supabase-collections.md](/C:/GROUP2_PROJECT/bloodlink/docs/funeral-supabase-collections.md)

## Required Role

- Funeral admin account role: `funeral_admin`

## Funeral Registration Fields

### Top-level fields

- `funeralShopStatus: "none" | "pending" | "verified" | "rejected"`
- `funeralShopRejectionReason: string | null`
- `funeralShopSubmittedAt: Timestamp | null`

### `funeralShopInfo` object

- `shopName: string`
- `shopAddress: string`
- `shopPhoneNumber: string`

### `funeralBusinessInfo` object

- `individualRegisteredName: string`
- `businessName: string`
- `generalLocation: string`
- `registeredAddress: string`
- `zipCode: string`
- `tin: string`
- `vatRegistrationStatus: "VAT Registered" | "Non Registered"`
- `birCertificateUrl: string`

## Status Lifecycle

1. `none`: default state, no completed registration yet.
2. `pending`: funeral shop submitted and waiting for admin review.
3. `verified`: approved by admin.
4. `rejected`: declined by admin; rejection reason should be provided.

## Validation Rules (supabase)

The rules enforce:

- Allowed values for `funeralShopStatus`.
- Presence and format of `funeralShopInfo` and `funeralBusinessInfo` when status is `pending` or `verified`.
- Required `funeralShopRejectionReason` when status is `rejected`.
- Basic safe text and length checks on funeral strings.

Reference: [supabase.rules](/C:/GROUP2_PROJECT/bloodlink/config/supabase/supabase.rules)

## Example Payload

```json
{
  "role": "funeral_admin",
  "funeralShopStatus": "pending",
  "funeralShopRejectionReason": null,
  "funeralShopSubmittedAt": "serverTimestamp()",
  "funeralShopInfo": {
    "shopName": "Peace Haven Memorial Services",
    "shopAddress": "123 Sampaguita St, Quezon City",
    "shopPhoneNumber": "09171234567"
  },
  "funeralBusinessInfo": {
    "individualRegisteredName": "Juan Dela Cruz",
    "businessName": "Peace Haven Memorial Services OPC",
    "generalLocation": "Quezon City",
    "registeredAddress": "123 Sampaguita St, Quezon City",
    "zipCode": "1100",
    "tin": "123-456-789-000",
    "vatRegistrationStatus": "VAT Registered",
    "birCertificateUrl": "https://example.com/bir-certificate.jpg"
  }
}
```
