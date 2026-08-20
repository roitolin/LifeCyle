-- Admin activity and account login visibility.
-- Run this once in the Supabase SQL editor for an existing project.

begin;

alter table public.admin_audit_logs
  add column if not exists "targetType" text,
  add column if not exists "targetId" text,
  add column if not exists summary text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.admin_audit_logs
set
  summary = coalesce(summary, details, action),
  "targetType" = coalesce("targetType", case when "targetUserId" is not null then 'user' else 'system' end),
  "targetId" = coalesce("targetId", "targetUserId"::text)
where summary is null or "targetType" is null;

alter table public.admin_audit_logs
  alter column "targetType" set default 'system';

create index if not exists admin_activity_created_at_idx
  on public.admin_audit_logs ("createdAt" desc);
create index if not exists admin_activity_admin_id_idx
  on public.admin_audit_logs ("adminId", "createdAt" desc);
create index if not exists admin_activity_target_type_idx
  on public.admin_audit_logs ("targetType");

drop policy if exists "Superadmins can read audit logs" on public.admin_audit_logs;
drop policy if exists "Admins can read permitted activity logs" on public.admin_audit_logs;
create policy "Admins can read permitted activity logs"
  on public.admin_audit_logs for select to authenticated
  using (
    "adminId" = auth.uid()
    or exists (
      select 1 from public.users viewer
      where viewer.id = auth.uid() and viewer.role = 'super_admin'
    )
  );

drop policy if exists "Admins can insert audit logs" on public.admin_audit_logs;
create policy "Admins can insert audit logs"
  on public.admin_audit_logs for insert to authenticated
  with check (
    "adminId" = auth.uid()
    and exists (
      select 1 from public.users actor
      where actor.id = auth.uid()
        and actor.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create table if not exists public.admin_login_activity (
  id uuid primary key default gen_random_uuid(),
  "adminId" uuid not null references public.users(id) on delete cascade,
  "adminEmail" text,
  event text not null check (event in ('login_success', 'logout', 'other_sessions_signed_out')),
  "deviceId" text,
  "deviceName" text not null default 'Unknown device',
  "deviceType" text,
  platform text,
  "osVersion" text,
  browser text,
  "screenSize" text,
  "ipAddress" text,
  country text,
  "userAgent" text,
  "createdAt" timestamptz not null default now()
);

create index if not exists admin_login_activity_admin_created_idx
  on public.admin_login_activity ("adminId", "createdAt" desc);
create index if not exists admin_login_activity_created_idx
  on public.admin_login_activity ("createdAt" desc);

alter table public.admin_login_activity enable row level security;

drop policy if exists "Admins can view permitted login activity" on public.admin_login_activity;
create policy "Admins can view permitted login activity"
  on public.admin_login_activity for select to authenticated
  using (
    "adminId" = auth.uid()
    or exists (
      select 1 from public.users viewer
      where viewer.id = auth.uid() and viewer.role = 'super_admin'
    )
  );

-- The function below records IP/country from trusted gateway headers and device details from the app.
create or replace function public.record_admin_login_activity(
  p_event text,
  p_device jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := auth.uid();
  v_admin_email text;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text;
  v_country text;
  v_id uuid;
begin
  if p_event not in ('login_success', 'logout', 'other_sessions_signed_out') then
    raise exception 'Unsupported login activity event';
  end if;

  select email into v_admin_email
  from public.users
  where id = v_admin_id
    and role in ('admin', 'super_admin', 'funeral_admin');

  if not found then
    raise exception 'Only administrators can record login activity' using errcode = '42501';
  end if;

  v_ip := split_part(
    coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', ''),
    ',',
    1
  );
  v_country := nullif(coalesce(v_headers ->> 'cf-ipcountry', v_headers ->> 'x-vercel-ip-country', ''), '');

  insert into public.admin_login_activity (
    "adminId", "adminEmail", event, "deviceId", "deviceName", "deviceType",
    platform, "osVersion", browser, "screenSize", "ipAddress", country, "userAgent"
  ) values (
    v_admin_id,
    v_admin_email,
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

revoke all on function public.record_admin_login_activity(text, jsonb) from public;
grant execute on function public.record_admin_login_activity(text, jsonb) to authenticated;

comment on table public.admin_login_activity is
  'Admin-only login and security activity. Each admin sees their own rows; super admins see all rows.';

commit;
