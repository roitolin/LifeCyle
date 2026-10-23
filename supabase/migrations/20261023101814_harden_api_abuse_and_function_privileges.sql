-- Defense-in-depth hardening for the exposed Data API and Edge Functions.
--
-- This migration intentionally keeps ordinary application reads governed by
-- the existing RLS policies. It removes accidental RPC execution grants,
-- rate-limits write traffic before PostgREST reaches a table/function, and
-- provides a service-role-only quota primitive for authenticated Edge
-- Functions.

begin;

create schema if not exists private;

-- Do not let API roles create objects that could be resolved by a privileged
-- function's search_path.
revoke create on schema public from public, anon, authenticated;

-- Private objects are implementation details. RLS remains enabled as defense
-- in depth, but API roles do not receive direct object privileges.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Existing payment/webhook state is server-only. RLS with no policy already
-- blocks rows; explicit revokes also remove the object-level API surface.
revoke all on table public.paymongo_webhook_events
  from public, anon, authenticated;
revoke all on table public.paymongo_service_webhook_events
  from public, anon, authenticated;
revoke all on table public.payout_account_change_challenges
  from public, anon, authenticated;

grant all on table public.paymongo_webhook_events to service_role;
grant all on table public.paymongo_service_webhook_events to service_role;
grant all on table public.payout_account_change_challenges to service_role;

-- New public objects must opt in to the Data API explicitly. This prevents a
-- future migration from silently exposing a table, sequence, or RPC.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Preserve
-- explicit authenticated/service-role grants, but remove anonymous and
-- inherited PUBLIC execution from every privileged function that already
-- exists.
do $block$
declare
  target_function regprocedure;
begin
  for target_function in
    select proc.oid::regprocedure
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.prosecdef
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon',
      target_function
    );
  end loop;
end;
$block$;

-- Trigger functions are never client RPCs. A trigger keeps invoking its
-- function after these grants are removed.
do $block$
declare
  target_function regprocedure;
begin
  for target_function in
    select distinct function_oid::regprocedure
    from (
      select trigger.tgfoid as function_oid
      from pg_catalog.pg_trigger as trigger
      where not trigger.tgisinternal

      union

      select event_trigger.evtfoid as function_oid
      from pg_catalog.pg_event_trigger as event_trigger
    ) as trigger_functions
    join pg_catalog.pg_proc as proc
      on proc.oid = trigger_functions.function_oid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
  loop
    execute pg_catalog.format(
      'revoke execute on function %s from public, anon, authenticated',
      target_function
    );
  end loop;
end;
$block$;

-- Fixed-window per-IP write limits for the Supabase Data API. Read requests
-- cannot write counters inside PostgREST's read-only transaction, so this gate
-- intentionally covers POST/PUT/PATCH/DELETE. Vercel/Supabase edge protection
-- remains responsible for distributed floods and read traffic.
create table if not exists private.api_write_rate_limits (
  request_ip inet not null,
  window_started timestamptz not null,
  request_count integer not null default 1
    check (request_count > 0),
  primary key (request_ip, window_started)
);

create index if not exists api_write_rate_limits_window_idx
  on private.api_write_rate_limits (window_started);

alter table private.api_write_rate_limits enable row level security;
revoke all on table private.api_write_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete on table private.api_write_rate_limits
  to service_role;

create or replace function private.check_api_write_rate_limit()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_method text := pg_catalog.upper(
    pg_catalog.coalesce(pg_catalog.current_setting('request.method', true), '')
  );
  request_headers jsonb := pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  request_jwt jsonb := pg_catalog.coalesce(
    pg_catalog.nullif(pg_catalog.current_setting('request.jwt', true), ''),
    '{}'
  )::jsonb;
  forwarded_for text;
  client_ip inet;
  bucket_start timestamptz;
  current_count integer;
  retry_after_seconds integer;
begin
  if request_method not in ('POST', 'PUT', 'PATCH', 'DELETE') then
    return;
  end if;

  -- Trusted server operations use the service role and have their own scoped
  -- Edge Function limits below.
  if pg_catalog.coalesce(request_jwt ->> 'role', '') = 'service_role' then
    return;
  end if;

  forwarded_for := pg_catalog.btrim(
    pg_catalog.split_part(
      pg_catalog.coalesce(request_headers ->> 'x-forwarded-for', ''),
      ',',
      1
    )
  );
  if forwarded_for = '' then
    return;
  end if;

  begin
    client_ip := forwarded_for::inet;
  exception
    when invalid_text_representation then
      return;
  end;

  bucket_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from pg_catalog.statement_timestamp()) / 300
    ) * 300
  );

  insert into private.api_write_rate_limits as bucket (
    request_ip,
    window_started,
    request_count
  ) values (
    client_ip,
    bucket_start,
    1
  )
  on conflict (request_ip, window_started)
  do update set request_count = pg_catalog.least(
    2147483647,
    bucket.request_count + 1
  )
  returning request_count into current_count;

  -- Keep only short-lived abuse metadata. The indexed cleanup runs on a small
  -- sample of requests so the rate limiter does not create unbounded history.
  if pg_catalog.random() < 0.01 then
    delete from private.api_write_rate_limits
    where window_started < pg_catalog.statement_timestamp() - interval '24 hours';
  end if;

  if current_count > 300 then
    retry_after_seconds := pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        extract(
          epoch from bucket_start + interval '5 minutes' - pg_catalog.clock_timestamp()
        )
      )::integer
    );

    raise sqlstate 'PGRST' using
      message = pg_catalog.jsonb_build_object(
        'code', 'api_rate_limit_exceeded',
        'message', 'Too many write requests. Please retry later.',
        'details', null,
        'hint', 'Reduce request frequency.'
      )::text,
      detail = pg_catalog.jsonb_build_object(
        'status', 429,
        'status_text', 'Too Many Requests',
        'headers', pg_catalog.jsonb_build_object(
          'Retry-After', retry_after_seconds::text
        )
      )::text;
  end if;
end;
$function$;

revoke all on function private.check_api_write_rate_limit()
  from public, anon, authenticated;
grant execute on function private.check_api_write_rate_limit()
  to anon, authenticated, service_role, authenticator;
grant usage on schema private
  to anon, authenticated, service_role, authenticator;

alter role authenticator
  set pgrst.db_pre_request = 'private.check_api_write_rate_limit';

comment on function private.check_api_write_rate_limit() is
  'PostgREST pre-request gate: at most 300 write requests per client IP per five-minute fixed window.';

-- Service-role-only quotas used after an Edge Function has validated a real
-- Supabase user. Keeping the bucket in Postgres makes the quota shared across
-- all Edge Function isolates and regions.
create table if not exists private.edge_rate_limit_buckets (
  scope text not null
    check (scope ~ '^[a-z0-9:_-]{1,80}$'),
  subject_id uuid not null,
  window_started timestamptz not null,
  request_count integer not null default 1
    check (request_count > 0),
  primary key (scope, subject_id, window_started)
);

create index if not exists edge_rate_limit_buckets_window_idx
  on private.edge_rate_limit_buckets (window_started);

alter table private.edge_rate_limit_buckets enable row level security;
revoke all on table private.edge_rate_limit_buckets
  from public, anon, authenticated;
grant select, insert, update, delete on table private.edge_rate_limit_buckets
  to service_role;

create or replace function public.consume_edge_rate_limit(
  p_scope text,
  p_subject_id uuid,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  normalized_scope text := pg_catalog.lower(pg_catalog.btrim(p_scope));
  bucket_start timestamptz;
  current_count integer;
  retry_after_seconds integer;
begin
  if normalized_scope !~ '^[a-z0-9:_-]{1,80}$'
     or p_subject_id is null
     or p_limit not between 1 and 1000
     or p_window_seconds not between 10 and 3600 then
    raise exception 'Invalid rate-limit parameters.' using errcode = '22023';
  end if;

  bucket_start := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from pg_catalog.statement_timestamp()) / p_window_seconds
    ) * p_window_seconds
  );

  insert into private.edge_rate_limit_buckets as bucket (
    scope,
    subject_id,
    window_started,
    request_count
  ) values (
    normalized_scope,
    p_subject_id,
    bucket_start,
    1
  )
  on conflict (scope, subject_id, window_started)
  do update set request_count = pg_catalog.least(
    2147483647,
    bucket.request_count + 1
  )
  returning request_count into current_count;

  if pg_catalog.random() < 0.01 then
    delete from private.edge_rate_limit_buckets
    where window_started < pg_catalog.statement_timestamp() - interval '24 hours';
  end if;

  retry_after_seconds := pg_catalog.greatest(
    1,
    pg_catalog.ceil(
      extract(
        epoch from bucket_start
          + pg_catalog.make_interval(secs => p_window_seconds)
          - pg_catalog.clock_timestamp()
      )
    )::integer
  );

  return pg_catalog.jsonb_build_object(
    'allowed', current_count <= p_limit,
    'remaining', pg_catalog.greatest(0, p_limit - current_count),
    'retryAfterSeconds', retry_after_seconds
  );
end;
$function$;

revoke all on function public.consume_edge_rate_limit(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, uuid, integer, integer)
  to service_role;

comment on function public.consume_edge_rate_limit(text, uuid, integer, integer) is
  'Consumes a shared fixed-window Edge Function quota. Callable only with the service role.';

notify pgrst, 'reload config';

commit;
