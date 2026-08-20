# Funeral supabase Collections

This document defines the dedicated supabase collections for funeral shop records and funeral items.

## Purpose

The current app still stores funeral registration data and product arrays inside `users/{uid}`.

These new collections are the cleaner long-term structure for:

- shop records
- item catalog records
- simpler admin queries
- cleaner owner-based permissions

## Collections

### `funeral_shops/{shopId}`

Recommended document shape:

```json
{
  "ownerId": "USER_UID",
  "ownerName": "Juan Dela Cruz",
  "ownerEmail": "juan@example.com",
  "status": "pending",
  "rejectionReason": null,
  "submittedAt": "serverTimestamp()",
  "shopInfo": {
    "shopName": "Peace Haven Memorial Services",
    "shopAddress": "123 Sampaguita St, Quezon City",
    "shopPhoneNumber": "09171234567",
    "shopImageUrl": "https://example.com/shop.jpg"
  },
  "businessInfo": {
    "individualRegisteredName": "Juan Dela Cruz",
    "businessName": "Peace Haven Memorial Services OPC",
    "generalLocation": "Quezon City",
    "registeredAddress": "123 Sampaguita St, Quezon City",
    "zipCode": "1100",
    "tin": "123-456-789-000",
    "vatRegistrationStatus": "VAT Registered",
    "birCertificateUrl": "https://example.com/bir-certificate.jpg"
  },
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

### `funeral_items/{itemId}`

Recommended document shape:

```json
{
  "shopId": "SHOP_DOC_ID",
  "ownerId": "USER_UID",
  "shopName": "Peace Haven Memorial Services",
  "category": "casket",
  "name": "Mahogany Premium Casket",
  "description": "Solid wood finish with full interior lining.",
  "price": "45000",
  "stock": 3,
  "active": true,
  "imageUrl": "https://example.com/item-main.jpg",
  "galleryImageUrls": [
    "https://example.com/item-1.jpg",
    "https://example.com/item-2.jpg"
  ],
  "hasVariations": true,
  "variations": [
    {
      "name": "Gloss",
      "imageUrl": "https://example.com/variation-gloss.jpg"
    }
  ],
  "createdAt": "serverTimestamp()",
  "updatedAt": "serverTimestamp()"
}
```

## Status Values

For `funeral_shops.status`:

1. `none`
2. `pending`
3. `verified`
4. `rejected`

## Access Rules

The supabase rules now include:

- owner create/update/delete access for `funeral_shops`
- owner create/update/delete access for `funeral_items`
- admin access for both collections
- signed-in read access for both collections

Reference: [supabase.rules](/C:/GROUP2_PROJECT/bloodlink/config/supabase/supabase.rules)

## Migration Note

The app is not fully migrated yet.

Right now, many screens still read:

- `users/{uid}.funeralShopInfo`
- `users/{uid}.funeralBusinessInfo`
- `users/{uid}.funeralProducts`

If you want to fully switch to the new structure, the next step is to update the mobile and web funeral screens to read and write:

- `funeral_shops`
- `funeral_items`

instead of nested user document fields.
