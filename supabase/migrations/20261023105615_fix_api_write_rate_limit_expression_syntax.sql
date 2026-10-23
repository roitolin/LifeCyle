begin;

-- COALESCE, NULLIF, LEAST, and GREATEST are PostgreSQL conditional
-- expressions, not ordinary pg_catalog functions. Keep the hardened empty
-- search_path while leaving those expressions unqualified.
create or replace function private.check_api_write_rate_limit()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_method text := pg_catalog.upper(
    coalesce(pg_catalog.current_setting('request.method', true), '')
  );
  request_headers jsonb := coalesce(
    nullif(pg_catalog.current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;
  request_jwt jsonb := coalesce(
    nullif(pg_catalog.current_setting('request.jwt', true), ''),
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

  if coalesce(request_jwt ->> 'role', '') = 'service_role' then
    return;
  end if;

  forwarded_for := pg_catalog.btrim(
    pg_catalog.split_part(
      coalesce(request_headers ->> 'x-forwarded-for', ''),
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
  do update set request_count = least(
    2147483647,
    bucket.request_count + 1
  )
  returning request_count into current_count;

  if pg_catalog.random() < 0.01 then
    delete from private.api_write_rate_limits
    where window_started < pg_catalog.statement_timestamp() - interval '24 hours';
  end if;

  if current_count > 300 then
    retry_after_seconds := greatest(
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
  do update set request_count = least(
    2147483647,
    bucket.request_count + 1
  )
  returning request_count into current_count;

  if pg_catalog.random() < 0.01 then
    delete from private.edge_rate_limit_buckets
    where window_started < pg_catalog.statement_timestamp() - interval '24 hours';
  end if;

  retry_after_seconds := greatest(
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
    'remaining', greatest(0, p_limit - current_count),
    'retryAfterSeconds', retry_after_seconds
  );
end;
$function$;

revoke all on function public.consume_edge_rate_limit(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, uuid, integer, integer)
  to service_role;

notify pgrst, 'reload config';

commit;
