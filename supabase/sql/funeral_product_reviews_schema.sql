-- ═══════════════════════════════════════════════════════
-- LifeCycle — FUNERAL PRODUCT RATINGS & FEEDBACK TABLES
-- Run this in the Supabase SQL editor.
-- Fixes: "Could not find the table 'public.funeral_product_ratings' / 'public.funeral_product_feedback'"
-- ═══════════════════════════════════════════════════════

create table if not exists public.funeral_product_ratings (
  id text primary key, -- format: "{productKey}_{userId}"
  "productKey" text not null,
  "productId" uuid not null references public.funeral_products(id) on delete cascade,
  "shopId" uuid references public.funeral_shops(id) on delete set null,
  "userId" uuid not null references public.users(id) on delete cascade,
  "userEmail" text,
  "displayName" text,
  rating integer not null check (rating >= 1 and rating <= 5),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists fpr_product_idx on public.funeral_product_ratings ("productId");
create index if not exists fpr_key_idx on public.funeral_product_ratings ("productKey");
create index if not exists fpr_shop_idx on public.funeral_product_ratings ("shopId");

alter table public.funeral_product_ratings enable row level security;

create or replace function public.has_verified_casket_order(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.funeral_service_requests request
      where request."requesterId" = auth.uid()
        and request."productId" = p_product_id::text
        and request."requestType" = 'catalog_product'
        and lower(request.status) in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
    );
$$;

create or replace function public.is_valid_funeral_review_target(
  p_product_id uuid,
  p_shop_id uuid,
  p_product_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.funeral_products product
    where product.id = p_product_id
      and product."shopId" is not distinct from p_shop_id
      and p_product_key = coalesce(product."shopId"::text, 'shop') || ':' || product.id::text
  );
$$;

revoke all on function public.has_verified_casket_order(uuid) from public;
revoke all on function public.is_valid_funeral_review_target(uuid, uuid, text) from public;
grant execute on function public.has_verified_casket_order(uuid) to authenticated;
grant execute on function public.is_valid_funeral_review_target(uuid, uuid, text) to authenticated;

drop policy if exists "Anyone can read product ratings" on public.funeral_product_ratings;
create policy "Anyone can read product ratings"
  on public.funeral_product_ratings for select
  using (true);

drop policy if exists "Users can submit their own product ratings" on public.funeral_product_ratings;
create policy "Users can submit their own product ratings"
  on public.funeral_product_ratings for insert to authenticated
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

drop policy if exists "Users can update their own product ratings" on public.funeral_product_ratings;
create policy "Users can update their own product ratings"
  on public.funeral_product_ratings for update to authenticated
  using ("userId" = auth.uid())
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

drop policy if exists "Users can delete their own product ratings" on public.funeral_product_ratings;
create policy "Users can delete their own product ratings"
  on public.funeral_product_ratings for delete to authenticated
  using ("userId" = auth.uid());

-- Admins can remove abusive ratings, but cannot create ratings without an order.
drop policy if exists "Admins can manage all product ratings" on public.funeral_product_ratings;
drop policy if exists "Admins can moderate product ratings" on public.funeral_product_ratings;
create policy "Admins can moderate product ratings"
  on public.funeral_product_ratings for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create table if not exists public.funeral_product_feedback (
  id uuid primary key default gen_random_uuid(),
  "productKey" text not null,
  "productId" uuid not null references public.funeral_products(id) on delete cascade,
  "shopId" uuid references public.funeral_shops(id) on delete set null,
  "userId" uuid not null references public.users(id) on delete cascade,
  "userEmail" text,
  "displayName" text,
  feedback text not null,
  "ratingSnapshot" integer check ("ratingSnapshot" >= 1 and "ratingSnapshot" <= 5),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists fpf_product_idx on public.funeral_product_feedback ("productId");
create index if not exists fpf_key_idx on public.funeral_product_feedback ("productKey");
create index if not exists fpf_shop_idx on public.funeral_product_feedback ("shopId");

alter table public.funeral_product_feedback enable row level security;

drop policy if exists "Anyone can read product feedback" on public.funeral_product_feedback;
create policy "Anyone can read product feedback"
  on public.funeral_product_feedback for select
  using (true);

drop policy if exists "Users can post their own product feedback" on public.funeral_product_feedback;
create policy "Users can post their own product feedback"
  on public.funeral_product_feedback for insert to authenticated
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

drop policy if exists "Users can manage their own product feedback" on public.funeral_product_feedback;
create policy "Users can manage their own product feedback"
  on public.funeral_product_feedback for update to authenticated
  using ("userId" = auth.uid())
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

drop policy if exists "Users can delete their own product feedback" on public.funeral_product_feedback;
create policy "Users can delete their own product feedback"
  on public.funeral_product_feedback for delete to authenticated
  using ("userId" = auth.uid());

-- Admins can remove abusive feedback, but cannot create feedback without an order.
drop policy if exists "Admins can manage all product feedback" on public.funeral_product_feedback;
drop policy if exists "Admins can moderate product feedback" on public.funeral_product_feedback;
create policy "Admins can moderate product feedback"
  on public.funeral_product_feedback for delete to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

-- ───────────────────────────────────────────────────────
-- Refresh PostgREST schema cache
-- ───────────────────────────────────────────────────────
notify pgrst, 'reload schema';
