-- Persist the funeral shop's private preparation checklist per service request.

create table if not exists public.service_request_shop_checklists (
  service_request_id uuid primary key
    references public.funeral_service_requests(id) on delete cascade,
  shop_id uuid not null references public.users(id) on delete cascade,
  details_confirmed boolean not null default false,
  family_contacted boolean not null default false,
  item_prepared boolean not null default false,
  schedule_confirmed boolean not null default false,
  delivery_scheduled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_request_shop_checklists_shop_updated
  on public.service_request_shop_checklists (shop_id, updated_at desc);

alter table public.service_request_shop_checklists enable row level security;

drop policy if exists "Shops can read their preparation checklists"
  on public.service_request_shop_checklists;
create policy "Shops can read their preparation checklists"
  on public.service_request_shop_checklists for select to authenticated
  using (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Shops can create preparation checklists"
  on public.service_request_shop_checklists;
create policy "Shops can create preparation checklists"
  on public.service_request_shop_checklists for insert to authenticated
  with check (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Shops can update preparation checklists"
  on public.service_request_shop_checklists;
create policy "Shops can update preparation checklists"
  on public.service_request_shop_checklists for update to authenticated
  using (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  )
  with check (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create or replace function public.guard_service_request_shop_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  request_shop_id uuid;
begin
  select exists (
    select 1 from public.users
    where id = actor_id
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  select "shopId" into request_shop_id
  from public.funeral_service_requests
  where id = new.service_request_id;

  if request_shop_id is null then
    raise exception 'Service request not found.';
  end if;
  if actor_id is distinct from request_shop_id and not actor_is_admin then
    raise exception 'Only the assigned shop can update this preparation checklist.';
  end if;

  if tg_op = 'UPDATE' then
    if new.service_request_id is distinct from old.service_request_id
       or new.shop_id is distinct from old.shop_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Checklist identity cannot be changed.';
    end if;
  end if;

  new.shop_id := request_shop_id;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_service_request_shop_checklist
  on public.service_request_shop_checklists;
create trigger guard_service_request_shop_checklist
before insert or update on public.service_request_shop_checklists
for each row execute function public.guard_service_request_shop_checklist();

notify pgrst, 'reload schema';
