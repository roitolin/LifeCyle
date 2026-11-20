-- Add accountEmail to funeral_shop_payout_accounts and payout_account_change_challenges

alter table public.funeral_shop_payout_accounts
  add column if not exists "accountEmail" text;

alter table public.payout_account_change_challenges
  add column if not exists "accountEmail" text;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261115124000', 'add_email_to_shop_payout_accounts')
on conflict (version) do nothing;

