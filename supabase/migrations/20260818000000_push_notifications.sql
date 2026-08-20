-- Remote push delivery for notifications inserted into public.notifications.
-- Run this migration before deploying the push-notification Edge Function.

create table if not exists public.push_notification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('android', 'ios')),
  device_name text,
  app_version text,
  preferences jsonb not null default '{
    "serviceRequests": true,
    "payments": true,
    "messages": true,
    "announcements": true,
    "sound": true
  }'::jsonb check (jsonb_typeof(preferences) = 'object'),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists push_notification_tokens_expo_token_key
  on public.push_notification_tokens (expo_push_token);
create index if not exists push_notification_tokens_user_enabled_idx
  on public.push_notification_tokens (user_id, enabled);

alter table public.notifications
  add column if not exists "pushSentAt" timestamptz;

alter table public.push_notification_tokens enable row level security;

drop policy if exists "Users can read their push tokens"
  on public.push_notification_tokens;
create policy "Users can read their push tokens"
  on public.push_notification_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can delete their push tokens"
  on public.push_notification_tokens;
create policy "Users can delete their push tokens"
  on public.push_notification_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.push_notification_tokens from anon, authenticated;
grant select, delete on table public.push_notification_tokens to authenticated;

create or replace function public.register_push_token(
  p_expo_push_token text,
  p_platform text,
  p_device_name text default null,
  p_app_version text default null,
  p_preferences jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_expo_push_token is null
     or length(p_expo_push_token) > 512
     or p_expo_push_token !~ '^Expo(nent)?PushToken\[[^]]+\]$' then
    raise exception 'Invalid Expo push token.';
  end if;

  if p_platform not in ('android', 'ios') then
    raise exception 'Unsupported push platform.';
  end if;

  if jsonb_typeof(coalesce(p_preferences, '{}'::jsonb)) <> 'object' then
    raise exception 'Push preferences must be a JSON object.';
  end if;

  insert into public.push_notification_tokens (
    user_id,
    expo_push_token,
    platform,
    device_name,
    app_version,
    preferences,
    enabled,
    last_seen_at,
    updated_at
  )
  values (
    current_user_id,
    p_expo_push_token,
    p_platform,
    nullif(trim(p_device_name), ''),
    nullif(trim(p_app_version), ''),
    coalesce(p_preferences, '{}'::jsonb),
    true,
    now(),
    now()
  )
  on conflict (expo_push_token) do update
  set user_id = excluded.user_id,
      platform = excluded.platform,
      device_name = excluded.device_name,
      app_version = excluded.app_version,
      preferences = excluded.preferences,
      enabled = true,
      last_seen_at = now(),
      updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(
  p_expo_push_token text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_notification_tokens
  where user_id = auth.uid()
    and expo_push_token = p_expo_push_token;
$$;

revoke all on function public.register_push_token(text, text, text, text, jsonb)
  from public;
grant execute on function public.register_push_token(text, text, text, text, jsonb)
  to authenticated;

revoke all on function public.unregister_push_token(text)
  from public;
grant execute on function public.unregister_push_token(text)
  to authenticated;

comment on table public.push_notification_tokens is
  'Per-device Expo push tokens. Expo routes deliveries to FCM or APNs.';
