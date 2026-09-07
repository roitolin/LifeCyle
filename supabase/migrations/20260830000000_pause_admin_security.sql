-- Temporarily remove administrator-management and mandatory admin MFA controls.
-- The public password-hash mirror intentionally remains removed.

begin;

-- Refuse to discard administrator-management lifecycle data if the feature was used.
do $rollback_guard$
begin
  if exists (
    select 1
    from public.users
    where role in ('admin', 'super_admin', 'funeral_admin')
      and (
        "adminStatus" <> 'active'
        or "adminInvitedBy" is not null
        or "roleUpdatedBy" is not null
        or "adminScope" <> '{}'::jsonb
      )
  ) then
    raise exception 'Admin-management lifecycle data exists; review it before removing the feature.';
  end if;
end;
$rollback_guard$;

-- Remove restrictive AAL2 policies added dynamically by the security migration.
do $policy_cleanup$
declare
  target record;
begin
  for target in
    select schemaname, tablename
    from pg_policies
    where policyname = 'Administrator sessions require MFA'
  loop
    execute format(
      'drop policy if exists "Administrator sessions require MFA" on %I.%I',
      target.schemaname,
      target.tablename
    );
  end loop;
end;
$policy_cleanup$;

drop trigger if exists on_auth_admin_invite_confirmed on auth.users;
drop trigger if exists protect_final_active_super_admin_update on public.users;
drop trigger if exists protect_final_active_super_admin_delete on public.users;
drop trigger if exists protect_admin_audit_provenance on public.admin_audit_logs;

drop function if exists public.activate_invited_admin_after_confirmation();
drop function if exists public.protect_final_active_super_admin();
drop function if exists public.protect_admin_audit_provenance();
drop function if exists public.record_admin_mfa_event(text);
drop function if exists public.admin_revoke_user_sessions_service(uuid, text);
drop function if exists public.current_admin_session_is_secure();

-- Restore the pre-MFA administrator role helpers.
create or replace function public.current_user_can_read_all_users()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'super_admin', 'funeral_admin')
  );
$function$;

create or replace function public.current_user_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'super_admin')
  );
$function$;

revoke all on function public.current_user_can_read_all_users() from public, anon;
revoke all on function public.current_user_can_manage_users() from public, anon;
grant execute on function public.current_user_can_read_all_users() to authenticated;
grant execute on function public.current_user_can_manage_users() to authenticated;

drop policy if exists "Admins can read all user profiles" on public.users;
create policy "Admins can read all user profiles"
on public.users for select to authenticated
using (public.current_user_can_read_all_users());

drop policy if exists "Admins can update user profiles" on public.users;
create policy "Admins can update user profiles"
on public.users for update to authenticated
using (public.current_user_can_manage_users())
with check (public.current_user_can_manage_users());

-- Restore the original profile security-field trigger behavior.
create or replace function public.protect_user_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or public.current_user_can_manage_users() then
    return new;
  end if;

  if new.role is distinct from old.role
    or new.disabled is distinct from old.disabled
    or new."banReason" is distinct from old."banReason"
    or new."bannedBy" is distinct from old."bannedBy"
    or new."bannedAt" is distinct from old."bannedAt"
    or new."bannedUntil" is distinct from old."bannedUntil"
  then
    raise exception 'Only an administrator can change account security fields.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_user_profile_security_fields() from public, anon, authenticated;
drop trigger if exists protect_user_profile_security_fields on public.users;
create trigger protect_user_profile_security_fields
before update on public.users
for each row execute function public.protect_user_profile_security_fields();

-- Restore pre-MFA audit visibility and client audit inserts.
drop policy if exists "Admins can read permitted activity logs" on public.admin_audit_logs;
create policy "Admins can read permitted activity logs"
on public.admin_audit_logs for select to authenticated
using (
  "adminId" = (select auth.uid())
  or exists (
    select 1 from public.users viewer
    where viewer.id = (select auth.uid()) and viewer.role = 'super_admin'
  )
);

drop policy if exists "Admins can insert audit logs" on public.admin_audit_logs;
create policy "Admins can insert audit logs"
on public.admin_audit_logs for insert to authenticated
with check (
  "adminId" = (select auth.uid())
  and exists (
    select 1 from public.users actor
    where actor.id = (select auth.uid())
      and actor.role in ('admin', 'super_admin', 'funeral_admin')
  )
);

drop function if exists public.current_user_has_admin_role(text[]);

alter table public.users drop constraint if exists users_admin_scope_object;
alter table public.users drop constraint if exists users_admin_status_allowed;
alter table public.users
  drop column if exists "adminScope",
  drop column if exists "adminInvitedBy",
  drop column if exists "adminInvitedAt",
  drop column if exists "roleUpdatedBy",
  drop column if exists "roleUpdatedAt",
  drop column if exists "mfaRequired",
  drop column if exists "adminStatus";

-- Keep direct profile creation disabled; profiles are created by trusted trigger/RPC.
revoke insert, delete on public.users from anon, authenticated;
grant select, update on public.users to authenticated;

commit;
