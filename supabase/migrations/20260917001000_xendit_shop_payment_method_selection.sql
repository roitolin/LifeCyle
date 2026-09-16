begin;

alter table public.shop_payments
  add column if not exists "providerChannelSelection" text;

alter table public.shop_payments
  drop constraint if exists shop_payments_provider_channel_selection_check;
alter table public.shop_payments
  add constraint shop_payments_provider_channel_selection_check
  check (
    "providerChannelSelection" is null
    or "providerChannelSelection" in ('all', 'gcash', 'ewallets', 'cards', 'qrph', 'bank_transfer')
  );

comment on column public.shop_payments."providerChannelSelection" is
  'Shop-selected Xendit hosted-checkout channel group. The verified webhook records the actual provider payment method separately.';

notify pgrst, 'reload schema';

commit;
