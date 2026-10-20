-- Return only the public profile fields a funeral shop needs for customers
-- who have sent that shop at least one service request.
create or replace function public.get_service_customer_profiles(target_ids uuid[])
returns table (
  id uuid,
  "fullName" text,
  "photoURL" text,
  gender text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    profile.id,
    profile."fullName",
    profile."photoURL",
    profile.gender
  from public.users as profile
  where profile.id = any(coalesce(target_ids, array[]::uuid[]))
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.funeral_service_requests as request
      inner join public.funeral_shops as shop
        on shop.id = request."shopId"
      where request."requesterId" = profile.id
        and shop.id = (select auth.uid())
    );
$function$;

revoke all on function public.get_service_customer_profiles(uuid[]) from public, anon;
grant execute on function public.get_service_customer_profiles(uuid[]) to authenticated;

comment on function public.get_service_customer_profiles(uuid[]) is
  'Returns public avatar fields only for customers who sent a service request to the signed-in funeral shop.';
