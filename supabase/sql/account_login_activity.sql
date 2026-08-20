-- Per-user account sign-in and sign-out history.
-- Run this once in the Supabase SQL editor for an existing project.

begin;

create table if not exists public.account_login_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event in ('login_success', 'logout')),
  device_id text,
  device_name text not null default 'Unknown device',
  device_type text,
  platform text,
  os_version text,
  browser text,
  screen_size text,
  ip_address text,
  country text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists account_login_activity_user_created_idx
  on public.account_login_activity (user_id, created_at desc);

alter table public.account_login_activity enable row level security;

drop policy if exists account_owner_read on public.account_login_activity;
create policy account_owner_read
  on public.account_login_activity for select to authenticated
  using (user_id = auth.uid());

-- Writes use a trusted function so clients cannot create events for another user.
create or replace function public.record_account_login_activity(
  p_event text,
  p_device jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text;
  v_country text;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event not in ('login_success', 'logout') then
    raise exception 'Unsupported account activity event';
  end if;

  v_ip := split_part(
    coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', ''),
    ',',
    1
  );
  v_country := nullif(coalesce(v_headers ->> 'cf-ipcountry', v_headers ->> 'x-vercel-ip-country', ''), '');

  insert into public.account_login_activity (
    user_id, event, device_id, device_name, device_type, platform,
    os_version, browser, screen_size, ip_address, country, user_agent
  ) values (
    v_user_id,
    p_event,
    nullif(left(p_device ->> 'device_id', 120), ''),
    coalesce(nullif(left(p_device ->> 'device_name', 160), ''), 'Unknown device'),
    nullif(left(p_device ->> 'device_type', 80), ''),
    nullif(left(p_device ->> 'platform', 40), ''),
    nullif(left(p_device ->> 'os_version', 80), ''),
    nullif(left(p_device ->> 'browser', 100), ''),
    nullif(left(p_device ->> 'screen_size', 40), ''),
    nullif(left(trim(v_ip), 100), ''),
    nullif(left(v_country, 12), ''),
    nullif(left(p_device ->> 'user_agent', 500), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_account_login_activity(text, jsonb) from public;
grant execute on function public.record_account_login_activity(text, jsonb) to authenticated;

comment on table public.account_login_activity is
  'Private account login and logout activity. Users can only read their own history.';

commit;
