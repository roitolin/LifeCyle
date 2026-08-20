-- Private account-change activity, kept separate from login and logout history.
-- Run this once in the Supabase SQL editor for an existing project.

begin;

create table if not exists public.account_activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (
    event in (
      'password_changed',
      'profile_updated',
      'session_revoked',
      'other_sessions_signed_out',
      'all_sessions_signed_out'
    )
  ),
  device_name text not null default 'Unknown device',
  device_type text,
  platform text,
  os_version text,
  ip_address text,
  country text,
  created_at timestamptz not null default now()
);

create index if not exists account_activity_log_user_created_idx
  on public.account_activity_log (user_id, created_at desc);

alter table public.account_activity_log enable row level security;

drop policy if exists account_activity_owner_read on public.account_activity_log;
create policy account_activity_owner_read
  on public.account_activity_log for select to authenticated
  using (user_id = auth.uid());

create or replace function public.record_account_activity(
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

  if p_event not in (
    'password_changed',
    'profile_updated',
    'session_revoked',
    'other_sessions_signed_out',
    'all_sessions_signed_out'
  ) then
    raise exception 'Unsupported account activity event';
  end if;

  v_ip := split_part(
    coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', ''),
    ',',
    1
  );
  v_country := nullif(coalesce(v_headers ->> 'cf-ipcountry', v_headers ->> 'x-vercel-ip-country', ''), '');

  insert into public.account_activity_log (
    user_id, event, device_name, device_type, platform, os_version, ip_address, country
  ) values (
    v_user_id,
    p_event,
    coalesce(nullif(left(p_device ->> 'device_name', 160), ''), 'Unknown device'),
    nullif(left(p_device ->> 'device_type', 80), ''),
    nullif(left(p_device ->> 'platform', 40), ''),
    nullif(left(p_device ->> 'os_version', 80), ''),
    nullif(left(trim(v_ip), 100), ''),
    nullif(left(v_country, 12), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_account_activity(text, jsonb) from public;
grant execute on function public.record_account_activity(text, jsonb) to authenticated;

comment on table public.account_activity_log is
  'Private account change history. Login and logout events are stored separately.';

commit;
