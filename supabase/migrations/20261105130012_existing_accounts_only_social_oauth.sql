-- OAuth sign-in should not silently create a new LifeCycle account. Existing
-- Auth users (including existing social users) never enter this creation hook.
create or replace function private.require_registered_account_for_social_oauth(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  signup_provider text := lower(coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', ''));
begin
  if signup_provider in ('google', 'facebook') then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 400,
        'message', 'Create and verify a LifeCycle account with this email before signing in with Google or Facebook.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function private.require_registered_account_for_social_oauth(jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.require_registered_account_for_social_oauth(jsonb)
  to supabase_auth_admin;
