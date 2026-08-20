-- ═══════════════════════════════════════════════════════
-- Shop Follows — allows users to follow funeral shops
-- ═══════════════════════════════════════════════════════

create table if not exists public.shop_follows (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  unique("userId", "shopId")
);

alter table public.shop_follows enable row level security;

-- Anyone can read follow counts
create policy "Anyone can read shop follows"
  on public.shop_follows for select
  using (true);

-- Authenticated users can follow shops
create policy "Users can follow shops"
  on public.shop_follows for insert
  with check (auth.uid() = "userId");

-- Users can unfollow
create policy "Users can unfollow shops"
  on public.shop_follows for delete
  using (auth.uid() = "userId");
