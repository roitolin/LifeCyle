-- ═══════════════════════════════════════════════════════
-- LifeCycle — FUNERAL SERVICE REQUESTS (orders) TABLE
-- Run this in the Supabase SQL editor.
-- Fixes: "Could not find the table 'public.funeral_service_requests' in the schema cache"
-- ═══════════════════════════════════════════════════════

create table if not exists public.funeral_service_requests (
  id uuid primary key default gen_random_uuid(),
  "requesterId" uuid not null references public.users(id) on delete cascade,
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  "shopName" text,
  "shopContactNumber" text,
  "shopAddress" text,
  "cartId" text,
  "productId" text,
  "productName" text,
  "productPrice" numeric,
  "productImageUrl" text,
  "variationName" text,
  "packageItems" text[] not null default '{}'::text[],
  "requestType" text, -- 'catalog_product' | 'custom_casket'
  "customDesignNotes" text,
  "memorialPhotoUrl" text,
  "referencePhotoUrl" text,
  "deceasedFullName" text not null,
  "deceasedDateOfBirth" timestamptz,
  "deceasedAge" integer,
  "tributeMessage" text,
  "familyCoordinatorName" text,
  "wakeAddress" text,
  "churchName" text,
  "cemeteryName" text,
  "wakeStartDate" date,
  "wakeEndDate" date,
  "burialTime" time without time zone,
  "pickupAddress" text,
  "contactNumber" text,
  status text not null default 'pending_shop_acceptance',
  -- 'pending_shop_acceptance' | 'awaiting_payment' | 'payment_submitted' | 'payment_verified' | 'completed' | 'declined_by_shop' | 'cancelled_by_requester'
  "paymentQrUrl" text,
  "paymentAmount" numeric,
  "paymentPayerName" text,
  "paymentGcashName" text,
  "paymentGcashNumber" text,
  "paymentReferenceNumber" text,
  "paymentProofImageUrl" text,
  "paymentSubmittedAt" timestamptz,
  "paymentVerifiedAt" timestamptz,
  "paymentRejectionReason" text,
  "completedAt" timestamptz,
  "acceptedAt" timestamptz,
  "declinedAt" timestamptz,
  "cancelledAt" timestamptz,
  "shopRespondedAt" timestamptz,
  "handledByShopId" uuid references public.users(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint funeral_service_requests_wake_date_range_check
    check ("wakeStartDate" is null or "wakeEndDate" is null or "wakeEndDate" >= "wakeStartDate")
);

create index if not exists fsr_shop_idx on public.funeral_service_requests ("shopId");
create index if not exists fsr_requester_idx on public.funeral_service_requests ("requesterId");
create index if not exists fsr_status_idx on public.funeral_service_requests (status);

comment on column public.funeral_service_requests.status is
  'pending_shop_acceptance | awaiting_payment | payment_submitted | payment_verified | completed | declined_by_shop | cancelled_by_requester';

alter table public.funeral_service_requests enable row level security;

-- Requester can view their own requests
drop policy if exists "Requesters can view their own requests" on public.funeral_service_requests;
create policy "Requesters can view their own requests"
  on public.funeral_service_requests for select to authenticated
  using ("requesterId" = auth.uid());

-- Requester can create their own requests
drop policy if exists "Requesters can create their own requests" on public.funeral_service_requests;
create policy "Requesters can create their own requests"
  on public.funeral_service_requests for insert to authenticated
  with check ("requesterId" = auth.uid());

-- Requester can edit / cancel their own pending requests
drop policy if exists "Requesters can update their own requests" on public.funeral_service_requests;
create policy "Requesters can update their own requests"
  on public.funeral_service_requests for update to authenticated
  using ("requesterId" = auth.uid());

-- Shop owner can view requests for their shop
drop policy if exists "Shop owners can view requests for their shop" on public.funeral_service_requests;
create policy "Shop owners can view requests for their shop"
  on public.funeral_service_requests for select to authenticated
  using (
    exists (
      select 1 from public.funeral_shops fs
      where fs.id = "shopId"
      and fs.id = auth.uid()
    )
  );

-- Shop owner can accept / decline requests for their shop
drop policy if exists "Shop owners can update requests for their shop" on public.funeral_service_requests;
create policy "Shop owners can update requests for their shop"
  on public.funeral_service_requests for update to authenticated
  using (
    exists (
      select 1 from public.funeral_shops fs
      where fs.id = "shopId"
      and fs.id = auth.uid()
    )
  );

-- Admins / super admins can view all requests
drop policy if exists "Admins can view all requests" on public.funeral_service_requests;
create policy "Admins can view all requests"
  on public.funeral_service_requests for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

-- Admins / super admins can update request status
drop policy if exists "Admins can update all requests" on public.funeral_service_requests;
create policy "Admins can update all requests"
  on public.funeral_service_requests for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

-- ───────────────────────────────────────────────────────
-- Refresh PostgREST schema cache (no reload needed after create)
-- ───────────────────────────────────────────────────────
notify pgrst, 'reload schema';
