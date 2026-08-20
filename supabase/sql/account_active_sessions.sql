-- Per-user active session registry and secure session revocation.
-- Run account_activity_log.sql first, then run this file in the Supabase SQL editor.

begin;

create table if not exists public.account_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
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
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text
);

create index if not exists account_sessions_user_active_idx
  on public.account_sessions (user_id, revoked_at, last_active_at desc);

alter table public.account_sessions enable row level security;

drop policy if exists account_session_owner_read on public.account_sessions;
create policy account_session_owner_read
  on public.account_sessions for select to authenticated
  using (user_id = auth.uid());

-- Session rows are written only through trusted functions. The JWT session_id
-- must match the requested current session, and every target is constrained to auth.uid().
create or replace function public.register_account_session(
  p_session_id uuid,
  p_device jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text;
  v_country text;
begin
  if v_user_id is null or v_claim_session_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_session_id is distinct from v_claim_session_id then
    raise exception 'Session does not match the signed-in client' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.sessions as auth_session
    where auth_session.id = p_session_id
      and auth_session.user_id = v_user_id
  ) then
    return false;
  end if;

  v_ip := split_part(
    coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', ''),
    ',',
    1
  );
  v_country := nullif(coalesce(v_headers ->> 'cf-ipcountry', v_headers ->> 'x-vercel-ip-country', ''), '');

  insert into public.account_sessions (
    session_id,
    user_id,
    device_id,
    device_name,
    device_type,
    platform,
    os_version,
    browser,
    screen_size,
    ip_address,
    country,
    user_agent,
    last_active_at,
    revoked_at,
    revocation_reason
  ) values (
    p_session_id,
    v_user_id,
    nullif(left(p_device ->> 'device_id', 120), ''),
    coalesce(nullif(left(p_device ->> 'device_name', 160), ''), 'Unknown device'),
    nullif(left(p_device ->> 'device_type', 80), ''),
    nullif(left(p_device ->> 'platform', 40), ''),
    nullif(left(p_device ->> 'os_version', 80), ''),
    nullif(left(p_device ->> 'browser', 100), ''),
    nullif(left(p_device ->> 'screen_size', 40), ''),
    nullif(left(trim(v_ip), 100), ''),
    nullif(left(v_country, 12), ''),
    nullif(left(p_device ->> 'user_agent', 500), ''),
    now(),
    null,
    null
  )
  on conflict (session_id) do update
  set
    device_id = excluded.device_id,
    device_name = excluded.device_name,
    device_type = excluded.device_type,
    platform = excluded.platform,
    os_version = excluded.os_version,
    browser = excluded.browser,
    screen_size = excluded.screen_size,
    ip_address = excluded.ip_address,
    country = excluded.country,
    user_agent = excluded.user_agent,
    last_active_at = now(),
    revoked_at = null,
    revocation_reason = null
  where public.account_sessions.user_id = excluded.user_id;

  return found;
end;
$$;

create or replace function public.touch_account_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claim_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_user_id is null or v_claim_session_id is null then
    return false;
  end if;

  if p_session_id is distinct from v_claim_session_id then
    raise exception 'Session does not match the signed-in client' using errcode = '42501';
  end if;

  update public.account_sessions as tracked
  set last_active_at = now()
  where tracked.session_id = p_session_id
    and tracked.user_id = v_user_id
    and tracked.revoked_at is null
    and exists (
      select 1
      from auth.sessions as auth_session
      where auth_session.id = tracked.session_id
        and auth_session.user_id = v_user_id
    );

  return found;
end;
$$;

create or replace function public.list_active_account_sessions()
returns table (
  session_id uuid,
  device_id text,
  device_name text,
  device_type text,
  platform text,
  os_version text,
  browser text,
  ip_address text,
  country text,
  created_at timestamptz,
  last_active_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.account_sessions as tracked
  set
    revoked_at = now(),
    revocation_reason = coalesce(tracked.revocation_reason, 'expired_or_signed_out')
  where tracked.user_id = v_user_id
    and tracked.revoked_at is null
    and not exists (
      select 1
      from auth.sessions as auth_session
      where auth_session.id = tracked.session_id
        and auth_session.user_id = v_user_id
    );

  return query
  select
    tracked.session_id,
    tracked.device_id,
    tracked.device_name,
    tracked.device_type,
    tracked.platform,
    tracked.os_version,
    tracked.browser,
    tracked.ip_address,
    tracked.country,
    tracked.created_at,
    tracked.last_active_at,
    tracked.session_id = v_current_session_id as is_current
  from public.account_sessions as tracked
  where tracked.user_id = v_user_id
    and tracked.revoked_at is null
    and exists (
      select 1
      from auth.sessions as auth_session
      where auth_session.id = tracked.session_id
        and auth_session.user_id = v_user_id
    )
  order by
    (tracked.session_id = v_current_session_id) desc,
    tracked.last_active_at desc;
end;
$$;

create or replace function public.revoke_account_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_session_id = v_current_session_id then
    raise exception 'Use the current-device sign out action for this session';
  end if;

  update public.account_sessions as tracked
  set
    revoked_at = now(),
    revocation_reason = 'revoked_by_user'
  where tracked.session_id = p_session_id
    and tracked.user_id = v_user_id
    and tracked.revoked_at is null;

  if not found then
    return false;
  end if;

  delete from auth.sessions as auth_session
  where auth_session.id = p_session_id
    and auth_session.user_id = v_user_id;

  return true;
end;
$$;

create or replace function public.mark_current_account_session_signed_out(
  p_session_id uuid,
  p_reason text default 'signed_out'
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_user_id is null or v_current_session_id is null then
    return false;
  end if;

  if p_session_id is distinct from v_current_session_id then
    raise exception 'Session does not match the signed-in client' using errcode = '42501';
  end if;

  update public.account_sessions as tracked
  set
    revoked_at = now(),
    revocation_reason = nullif(left(coalesce(p_reason, 'signed_out'), 80), '')
  where tracked.session_id = p_session_id
    and tracked.user_id = v_user_id;

  return found;
end;
$$;

revoke all on function public.register_account_session(uuid, jsonb) from public;
revoke all on function public.touch_account_session(uuid) from public;
revoke all on function public.list_active_account_sessions() from public;
revoke all on function public.revoke_account_session(uuid) from public;
revoke all on function public.mark_current_account_session_signed_out(uuid, text) from public;

grant execute on function public.register_account_session(uuid, jsonb) to authenticated;
grant execute on function public.touch_account_session(uuid) to authenticated;
grant execute on function public.list_active_account_sessions() to authenticated;
grant execute on function public.revoke_account_session(uuid) to authenticated;
grant execute on function public.mark_current_account_session_signed_out(uuid, text) to authenticated;

-- Session security actions belong in the general account activity log, not
-- the separate login/logout history.
alter table if exists public.account_activity_log
  drop constraint if exists account_activity_log_event_check;

alter table if exists public.account_activity_log
  add constraint account_activity_log_event_check
  check (
    event in (
      'password_changed',
      'profile_updated',
      'session_revoked',
      'other_sessions_signed_out',
      'all_sessions_signed_out'
    )
  );

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

comment on table public.account_sessions is
  'Private active-session metadata. Authentication tokens are never stored in this table.';

commit;
