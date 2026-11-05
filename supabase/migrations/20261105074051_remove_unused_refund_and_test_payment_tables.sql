-- Remove two empty, unused features after retiring their application references.
-- Keep historical migrations intact so earlier schema history remains auditable.
drop function if exists public.register_shop_test_payment_account(text, boolean) restrict;
drop table if exists public.shop_test_payment_accounts restrict;
drop function if exists private.notify_shop_test_payment_account_registered() restrict;

drop table if exists public.service_refund_requests restrict;
drop function if exists public.guard_service_refund_request() restrict;
drop function if exists public.notify_service_refund_change() restrict;

notify pgrst, 'reload schema';
