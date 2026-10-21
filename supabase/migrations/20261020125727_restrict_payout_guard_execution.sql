-- This trigger function is internal implementation detail and must not be
-- callable through the Data API as an RPC.
begin;

revoke all on function public.protect_shop_payout_fields() from public;
revoke all on function public.protect_shop_payout_fields() from anon;
revoke all on function public.protect_shop_payout_fields() from authenticated;

commit;
