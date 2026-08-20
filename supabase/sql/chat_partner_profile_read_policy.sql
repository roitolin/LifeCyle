-- Chat partner profiles: lets authenticated users read ONLY the public profile
-- details (name, avatar, gender, email, joined date) of users they are in
-- a conversation with. Security, role, and moderation fields stay hidden.
-- Run this once in the Supabase SQL Editor.

begin;

-- users_password_column_reorder.sql previously omitted these public profile
-- fields while rebuilding the users table. Restore them before compiling the
-- chat profile function. Both statements are safe to run more than once.
alter table public.users
  add column if not exists "photoURL" text;

-- SECURITY DEFINER: runs as the owner, bypassing RLS on `users` and
-- `conversations`, but only ever returns the public profile columns and only
-- when the caller and the target share a conversation.
drop function if exists public.get_chat_partner_profiles(uuid[]);

create or replace function public.get_chat_partner_profiles(target_ids uuid[])
returns table (
  id uuid,
  "fullName" text,
  email text,
  "photoURL" text,
  gender text,
  "createdAt" timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,
    p."fullName",
    p.email,
    p."photoURL",
    p.gender,
    p."createdAt"
  from public.users as p
  where p.id = any(target_ids)
    and exists (
      select 1
      from public.conversations as conv
      where conv.participants @> array[(select auth.uid()), p.id]
    );
$function$;

revoke all on function public.get_chat_partner_profiles(uuid[]) from public, anon;
grant execute on function public.get_chat_partner_profiles(uuid[]) to authenticated;

-- Remove the full-row SELECT policy so chat partners cannot read the whole
-- `users` row directly; they must go through the RPC above.
drop policy if exists "Users can read chat partner profiles" on public.users;

commit;
