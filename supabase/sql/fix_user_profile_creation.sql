-- Fix orphaned auth accounts and keep public.users creation behind the database.
-- Run this once in the Supabase SQL Editor for the project used by the apps.

begin;

alter table public.users enable row level security;

-- Role checks must use SECURITY DEFINER helpers. Querying public.users directly
-- inside a policy on public.users causes recursive RLS evaluation.
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

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile"
on public.users for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Admins can read all user profiles" on public.users;
create policy "Admins can read all user profiles"
on public.users for select to authenticated
using (public.current_user_can_read_all_users());

-- Profiles are created only by the trigger/RPC below, not with a client INSERT.
drop policy if exists "Users can insert their profile" on public.users;
drop policy if exists "Users can create their own profile" on public.users;
revoke insert on public.users from anon, authenticated;

drop policy if exists "Users can update their own profile" on public.users;
drop policy if exists "Users can update their own basic profile" on public.users;
create policy "Users can update their own basic profile"
on public.users for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Admins can update user profiles" on public.users;
create policy "Admins can update user profiles"
on public.users for update to authenticated
using (public.current_user_can_manage_users())
with check (public.current_user_can_manage_users());

grant select, update on public.users to authenticated;

-- Prevent a regular user from changing authorization or moderation fields on
-- their own row while still allowing normal profile and terms updates.
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

-- Every future Supabase auth account receives a normal user profile in the same
-- transaction. User-controlled auth metadata is never used for the role.
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.users (
    id,
    email,
    "fullName",
    gender,
    "dateOfBirth",
    role,
    "termsAccepted",
    "termsAcceptedAt",
    "createdAt",
    "updatedAt"
  )
  values (
    new.id,
    lower(coalesce(new.email, '')),
    left(nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'fullName',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      ''
    )), ''), 120),
    case lower(coalesce(new.raw_user_meta_data ->> 'gender', ''))
      when 'male' then 'male'
      when 'female' then 'female'
      when 'other' then 'other'
      else null
    end,
    left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'dateOfBirth', '')), ''), 64),
    'user',
    false,
    null,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

revoke all on function public.handle_new_auth_user_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user_profile();

-- Authenticated clients can repair only their own missing row. The function
-- reads the id from auth.uid() and always assigns the database's normal role.
create or replace function public.ensure_my_user_profile()
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.users (
    id,
    email,
    "fullName",
    gender,
    "dateOfBirth",
    role,
    "termsAccepted",
    "termsAcceptedAt",
    "createdAt",
    "updatedAt"
  )
  select
    auth_user.id,
    lower(coalesce(auth_user.email, '')),
    left(nullif(btrim(coalesce(
      auth_user.raw_user_meta_data ->> 'fullName',
      auth_user.raw_user_meta_data ->> 'full_name',
      auth_user.raw_user_meta_data ->> 'name',
      ''
    )), ''), 120),
    case lower(coalesce(auth_user.raw_user_meta_data ->> 'gender', ''))
      when 'male' then 'male'
      when 'female' then 'female'
      when 'other' then 'other'
      else null
    end,
    left(nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'dateOfBirth', '')), ''), 64),
    'user',
    false,
    null,
    coalesce(auth_user.created_at, now()),
    now()
  from auth.users as auth_user
  where auth_user.id = current_user_id
  on conflict (id) do nothing;

  return exists (
    select 1 from public.users as profile where profile.id = current_user_id
  );
end;
$function$;

revoke all on function public.ensure_my_user_profile() from public, anon;
grant execute on function public.ensure_my_user_profile() to authenticated;

-- One-time repair for accounts left orphaned by the old client-side signup.
insert into public.users (
  id,
  email,
  "fullName",
  gender,
  "dateOfBirth",
  role,
  "termsAccepted",
  "termsAcceptedAt",
  "createdAt",
  "updatedAt"
)
select
  auth_user.id,
  lower(coalesce(auth_user.email, '')),
  left(nullif(btrim(coalesce(
    auth_user.raw_user_meta_data ->> 'fullName',
    auth_user.raw_user_meta_data ->> 'full_name',
    auth_user.raw_user_meta_data ->> 'name',
    ''
  )), ''), 120),
  case lower(coalesce(auth_user.raw_user_meta_data ->> 'gender', ''))
    when 'male' then 'male'
    when 'female' then 'female'
    when 'other' then 'other'
    else null
  end,
  left(nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'dateOfBirth', '')), ''), 64),
  'user',
  false,
  null,
  coalesce(auth_user.created_at, now()),
  now()
from auth.users as auth_user
where not exists (
  select 1 from public.users as profile where profile.id = auth_user.id
)
on conflict (id) do nothing;

commit;
