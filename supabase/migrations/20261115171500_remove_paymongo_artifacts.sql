-- Remove legacy PayMongo database functions, webhook tables, and index.
-- Keeps provider-neutral columns (paymentProvider, providerCheckoutId, etc.)
-- that are actively used by Xendit.

begin;

drop function if exists public.complete_paymongo_shop_payment(text, text, text, text, text, bigint, boolean, text);
drop function if exists public.complete_paymongo_service_payment(text, text, text, text, text, bigint, boolean, text);

drop index if exists public.shop_payments_paymongo_pending_per_shop;

drop table if exists public.paymongo_webhook_events;
drop table if exists public.paymongo_service_webhook_events;

commit;

