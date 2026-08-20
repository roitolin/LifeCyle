-- LifeCycle - repair missing public chat-profile columns
-- Run this once in the Supabase SQL Editor for an existing deployment.
-- It is idempotent and does not overwrite any existing profile data.

begin;

alter table public.users
  add column if not exists "photoURL" text;

comment on column public.users."photoURL" is
  'Public profile avatar URL used by chat and account screens.';

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

notify pgrst, 'reload schema';

commit;
