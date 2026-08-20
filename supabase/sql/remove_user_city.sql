-- Remove the legacy city field from account profiles.
-- Funeral provider locations remain in funeral_shops.generalLocation and
-- service-request locations remain in funeral_service_requests.city.

begin;

-- This function previously returned users.city, so replace it before the
-- column is dropped. The conversation membership check remains unchanged.
drop function if exists public.get_chat_partner_profiles(uuid[]);

alter table public.users
  drop column if exists city;

create function public.get_chat_partner_profiles(target_ids uuid[])
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
