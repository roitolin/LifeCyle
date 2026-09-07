-- Administrator lifecycle hardening, mandatory MFA authorization, and audit controls.
-- Privileged administrator mutations are performed by the admin-management Edge Function.

begin;

-- Password hashes belong only in auth.users. Remove the public mirror and its sync machinery.
drop trigger if exists on_auth_user_created_profile_sync_password on auth.users;
drop trigger if exists trg_hash_password on public.users;
drop function if exists public.sync_auth_user_password();
drop function if exists public.handle_password_hash();
drop function if exists public.add_password_hash_trigger(text);
drop function if exists public.verify_password(text, text);
drop function if exists public.hash_password(text);
alter table public.users drop column if exists password;

alter table public.users
  add column if not exists "adminStatus" text not null default 'active',
  add column if not exists "adminScope" jsonb not null default '{}'::jsonb,
  add column if not exists "adminInvitedBy" uuid references public.users(id) on delete set null,
  add column if not exists "adminInvitedAt" timestamptz,
  add column if not exists "roleUpdatedBy" uuid references public.users(id) on delete set null,
  add column if not exists "roleUpdatedAt" timestamptz,
  add column if not exists "mfaRequired" boolean not null default false;

update public.users
set role = 'user'
where role not in ('user', 'funeral', 'funeral_admin', 'admin', 'super_admin');

update public.users
set
  "adminStatus" = case
    when role in ('admin', 'super_admin', 'funeral_admin') and disabled then 'suspended'
    else 'active'
  end,
  "mfaRequired" = role in ('admin', 'super_admin', 'funeral_admin');

alter table public.users drop constraint if exists users_role_allowed;
alter table public.users
  add constraint users_role_allowed
  check (role in ('user', 'funeral', 'funeral_admin', 'admin', 'super_admin'));

alter table public.users drop constraint if exists users_admin_status_allowed;
alter table public.users
  add constraint users_admin_status_allowed
  check ("adminStatus" in ('invited', 'active', 'suspended', 'deactivated'));

alter table public.users drop constraint if exists users_admin_scope_object;
alter table public.users
  add constraint users_admin_scope_object
  check (jsonb_typeof("adminScope") = 'object');

-- Serialize changes to active super administrators so concurrent requests can
-- never demote, suspend, deactivate, or delete the final active account.
create or replace function public.protect_final_active_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  other_active_super_admins integer;
begin
  if old.role <> 'super_admin' or old.disabled or old."adminStatus" <> 'active' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op <> 'DELETE'
     and new.role = 'super_admin'
     and new.disabled = false
     and new."adminStatus" = 'active' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(97348125);
  select count(*)
  into other_active_super_admins
  from public.users
  where id <> old.id
    and role = 'super_admin'
    and disabled = false
    and "adminStatus" = 'active';

  if other_active_super_admins = 0 then
    raise exception 'The final active super administrator cannot be changed.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_final_active_super_admin() from public, anon, authenticated;
drop trigger if exists protect_final_active_super_admin_update on public.users;
create trigger protect_final_active_super_admin_update
before update of role, disabled, "adminStatus" on public.users
for each row execute function public.protect_final_active_super_admin();
drop trigger if exists protect_final_active_super_admin_delete on public.users;
create trigger protect_final_active_super_admin_delete
before delete on public.users
for each row execute function public.protect_final_active_super_admin();

create or replace function public.current_user_has_admin_role(p_roles text[])
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
      and profile.role = any(p_roles)
      and profile.disabled = false
      and profile."adminStatus" = 'active'
      and coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
  );
$function$;

revoke all on function public.current_user_has_admin_role(text[]) from public, anon;
grant execute on function public.current_user_has_admin_role(text[]) to authenticated;

create or replace function public.current_user_can_read_all_users()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.current_user_has_admin_role(array['admin', 'super_admin', 'funeral_admin']);
$function$;

create or replace function public.current_user_can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.current_user_has_admin_role(array['admin', 'super_admin']);
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

revoke insert, delete on public.users from anon, authenticated;
grant select, update on public.users to authenticated;

-- Existing policies across the product use administrator roles directly. Add a
-- restrictive policy to every table with an administrator-aware policy so a
-- suspended or AAL1 administrator token cannot keep using those permissions.
create or replace function public.current_admin_session_is_secure()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when not exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'super_admin', 'funeral_admin')
    ) then true
    else exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role in ('admin', 'super_admin', 'funeral_admin')
        and disabled = false
        and "adminStatus" = 'active'
        and coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    )
  end;
$function$;

revoke all on function public.current_admin_session_is_secure() from public, anon;
grant execute on function public.current_admin_session_is_secure() to authenticated;

do $policy_setup$
declare
  target record;
begin
  for target in
    select distinct schemaname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'users'
      and (
        coalesce(qual, '') ilike '%super_admin%'
        or coalesce(with_check, '') ilike '%super_admin%'
        or coalesce(qual, '') ilike '%funeral_admin%'
        or coalesce(with_check, '') ilike '%funeral_admin%'
      )
  loop
    execute format(
      'drop policy if exists "Administrator sessions require MFA" on %I.%I',
      target.schemaname,
      target.tablename
    );
    execute format(
      'create policy "Administrator sessions require MFA" on %I.%I as restrictive for all to authenticated using (public.current_admin_session_is_secure()) with check (public.current_admin_session_is_secure())',
      target.schemaname,
      target.tablename
    );
  end loop;
end;
$policy_setup$;
-- Browser clients may moderate ordinary users, but administrator role/lifecycle
-- changes can only come through the service-role Edge Function.
create or replace function public.protect_user_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_disabled boolean;
  actor_status text;
  actor_aal text := coalesce((select auth.jwt() ->> 'aal'), 'aal1');
  admin_roles constant text[] := array['admin', 'super_admin', 'funeral_admin'];
begin
  if (select auth.role()) = 'service_role' or actor_id is null then
    return new;
  end if;

  select role, disabled, "adminStatus"
  into actor_role, actor_disabled, actor_status
  from public.users
  where id = actor_id;

  if actor_role in ('admin', 'super_admin')
     and actor_disabled = false
     and actor_status = 'active'
     and actor_aal = 'aal2' then
    if old.role = any(admin_roles) or new.role = any(admin_roles) then
      raise exception 'Administrator accounts must be changed through protected admin management.'
        using errcode = '42501';
    end if;

    if (to_jsonb(new) - array[
          'disabled', 'banReason', 'bannedBy', 'bannedAt', 'bannedUntil', 'updatedAt'
        ]) is distinct from
       (to_jsonb(old) - array[
          'disabled', 'banReason', 'bannedBy', 'bannedAt', 'bannedUntil', 'updatedAt'
        ]) then
      raise exception 'Administrators may directly change only moderation fields for ordinary users.'
        using errcode = '42501';
    end if;

    if new.disabled then
      new."bannedBy" := actor_id;
      new."bannedAt" := coalesce(new."bannedAt", now());
    else
      new."banReason" := null;
      new."bannedBy" := null;
      new."bannedAt" := null;
      new."bannedUntil" := null;
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
    or new.disabled is distinct from old.disabled
    or new."banReason" is distinct from old."banReason"
    or new."bannedBy" is distinct from old."bannedBy"
    or new."bannedAt" is distinct from old."bannedAt"
    or new."bannedUntil" is distinct from old."bannedUntil"
    or new."adminStatus" is distinct from old."adminStatus"
    or new."adminScope" is distinct from old."adminScope"
    or new."adminInvitedBy" is distinct from old."adminInvitedBy"
    or new."adminInvitedAt" is distinct from old."adminInvitedAt"
    or new."roleUpdatedBy" is distinct from old."roleUpdatedBy"
    or new."roleUpdatedAt" is distinct from old."roleUpdatedAt"
    or new."mfaRequired" is distinct from old."mfaRequired"
  then
    raise exception 'Only protected administrator management can change account security fields.'
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

-- Promote an invited administrator to active after their email invitation is accepted.
create or replace function public.activate_invited_admin_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.users
    set "adminStatus" = 'active', "updatedAt" = now()
    where id = new.id
      and role in ('admin', 'super_admin', 'funeral_admin')
      and "adminStatus" = 'invited';
  end if;
  return new;
end;
$function$;

revoke all on function public.activate_invited_admin_after_confirmation() from public, anon, authenticated;
drop trigger if exists on_auth_admin_invite_confirmed on auth.users;
create trigger on_auth_admin_invite_confirmed
after update of email_confirmed_at on auth.users
for each row execute function public.activate_invited_admin_after_confirmation();

-- Ensure the audit table and richer event shape exist even when the older setup SQL was not applied.
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  "adminId" uuid not null references public.users(id) on delete cascade,
  action text not null,
  details text,
  "targetUserId" uuid references public.users(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

alter table public.admin_audit_logs
  add column if not exists "targetType" text,
  add column if not exists "targetId" text,
  add column if not exists summary text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.admin_audit_logs enable row level security;
create index if not exists admin_activity_created_at_idx
  on public.admin_audit_logs ("createdAt" desc);
create index if not exists admin_activity_admin_id_idx
  on public.admin_audit_logs ("adminId", "createdAt" desc);

revoke update, delete, truncate on public.admin_audit_logs from anon, authenticated;

-- Browser clients may add ordinary audit events, but only the service-role Edge
-- Function or a verified database RPC may claim server-verified provenance.
create or replace function public.protect_admin_audit_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.metadata @> '{"serverVerified": true}'::jsonb
     and coalesce((select auth.role()), '') <> 'service_role'
     and coalesce(current_setting('lifecycle.server_verified_audit', true), '') <> 'on' then
    raise exception 'Server-verified audit provenance is reserved for trusted operations.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_admin_audit_provenance() from public, anon, authenticated;
drop trigger if exists protect_admin_audit_provenance on public.admin_audit_logs;
create trigger protect_admin_audit_provenance
before insert or update on public.admin_audit_logs
for each row execute function public.protect_admin_audit_provenance();

drop policy if exists "Admins can insert audit logs" on public.admin_audit_logs;
create policy "Admins can insert audit logs"
on public.admin_audit_logs for insert to authenticated
with check (
  "adminId" = (select auth.uid())
  and public.current_user_has_admin_role(array['admin', 'super_admin', 'funeral_admin'])
);

drop policy if exists "Superadmins can read audit logs" on public.admin_audit_logs;
drop policy if exists "Admins can read permitted activity logs" on public.admin_audit_logs;
create policy "Admins can read permitted activity logs"
on public.admin_audit_logs for select to authenticated
using (
  public.current_user_has_admin_role(array['super_admin'])
  or (
    "adminId" = (select auth.uid())
    and public.current_user_has_admin_role(array['admin', 'funeral_admin'])
  )
);

create or replace function public.record_admin_mfa_event(p_action text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  event_id uuid;
begin
  if p_action not in ('mfa_enrolled', 'mfa_challenge_verified') then
    raise exception 'Unsupported MFA audit event.' using errcode = '22023';
  end if;
  if not public.current_user_has_admin_role(array['admin', 'super_admin', 'funeral_admin']) then
    raise exception 'Active administrator AAL2 session required.' using errcode = '42501';
  end if;

  perform set_config('lifecycle.server_verified_audit', 'on', true);

  insert into public.admin_audit_logs (
    "adminId", action, "targetType", "targetId", summary, metadata
  ) values (
    actor_id,
    p_action,
    'security',
    actor_id::text,
    case p_action
      when 'mfa_enrolled' then 'Enrolled an administrator authenticator factor.'
      else 'Completed an administrator MFA challenge.'
    end,
    jsonb_build_object('source', 'database_rpc', 'serverVerified', true)
  )
  returning id into event_id;
  return event_id;
end;
$function$;

revoke all on function public.record_admin_mfa_event(text) from public, anon;
grant execute on function public.record_admin_mfa_event(text) to authenticated;

-- Called only by the service-role Edge Function after it has verified the actor.
create or replace function public.admin_revoke_user_sessions_service(
  p_target_user_id uuid,
  p_reason text default 'revoked_by_super_admin'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  revoked_count integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;

  delete from auth.sessions where user_id = p_target_user_id;
  get diagnostics revoked_count = row_count;

  if to_regclass('public.account_sessions') is not null then
    execute 'update public.account_sessions
             set revoked_at = now(), revocation_reason = $1
             where user_id = $2 and revoked_at is null'
      using left(coalesce(p_reason, 'revoked_by_super_admin'), 160), p_target_user_id;
  end if;

  return revoked_count;
end;
$function$;

revoke all on function public.admin_revoke_user_sessions_service(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions_service(uuid, text) to service_role;

commit;
