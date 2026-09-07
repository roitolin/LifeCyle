-- Private funeral-shop calendar events used by the cross-platform Service
-- Schedule. Request dates remain sourced from funeral_service_requests.

create table if not exists public.shop_schedule_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  event_type text not null default 'other'
    check (event_type in ('appointment', 'delivery', 'follow_up', 'blocked', 'other')),
  event_date date not null,
  start_time time not null,
  end_time time,
  location text,
  notes text,
  related_service_request_id uuid
    references public.funeral_service_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_schedule_events_shop_date
  on public.shop_schedule_events (shop_id, event_date, start_time);

alter table public.shop_schedule_events enable row level security;

drop policy if exists "Shops can read their schedule events"
  on public.shop_schedule_events;
create policy "Shops can read their schedule events"
  on public.shop_schedule_events for select to authenticated
  using (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Shops can create their schedule events"
  on public.shop_schedule_events;
create policy "Shops can create their schedule events"
  on public.shop_schedule_events for insert to authenticated
  with check (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Shops can update their schedule events"
  on public.shop_schedule_events;
create policy "Shops can update their schedule events"
  on public.shop_schedule_events for update to authenticated
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

drop policy if exists "Shops can delete their schedule events"
  on public.shop_schedule_events;
create policy "Shops can delete their schedule events"
  on public.shop_schedule_events for delete to authenticated
  using (
    auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create or replace function public.guard_shop_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  related_shop_id uuid;
begin
  select exists (
    select 1 from public.users
    where id = actor_id
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  if actor_id is distinct from new.shop_id and not actor_is_admin then
    raise exception 'Only the shop can manage its schedule.';
  end if;
  if tg_op = 'UPDATE' and new.shop_id is distinct from old.shop_id then
    raise exception 'The schedule owner cannot be changed.';
  end if;

  new.title := trim(new.title);
  if char_length(new.title) < 2 or char_length(new.title) > 120 then
    raise exception 'Event titles must contain 2-120 characters.';
  end if;
  if new.end_time is not null and new.end_time <= new.start_time then
    raise exception 'The end time must be later than the start time.';
  end if;
  if new.related_service_request_id is not null then
    select "shopId" into related_shop_id
    from public.funeral_service_requests
    where id = new.related_service_request_id;
    if related_shop_id is distinct from new.shop_id then
      raise exception 'The related service request does not belong to this shop.';
    end if;
  end if;

  new.location := nullif(trim(new.location), '');
  new.notes := nullif(trim(new.notes), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_shop_schedule_event
  on public.shop_schedule_events;
create trigger guard_shop_schedule_event
before insert or update on public.shop_schedule_events
for each row execute function public.guard_shop_schedule_event();

notify pgrst, 'reload schema';
