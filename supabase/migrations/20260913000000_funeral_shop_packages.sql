create table if not exists public.funeral_shop_packages (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  "flowersImageUrl" text,
  "candlesImageUrl" text,
  "curtainsImageUrl" text,
  "vehicleImageUrl" text,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint funeral_shop_packages_one_per_shop unique ("shopId")
);

alter table public.funeral_shop_packages enable row level security;

drop policy if exists "Anyone can view active funeral shop packages" on public.funeral_shop_packages;
create policy "Anyone can view active funeral shop packages"
  on public.funeral_shop_packages for select
  using (active = true or "shopId" = auth.uid());

drop policy if exists "Shop owners can manage funeral shop packages" on public.funeral_shop_packages;
create policy "Shop owners can manage funeral shop packages"
  on public.funeral_shop_packages for all to authenticated
  using ("shopId" = auth.uid())
  with check ("shopId" = auth.uid());
