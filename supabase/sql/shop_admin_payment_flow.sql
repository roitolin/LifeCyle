-- LifeCycle - SHOP TO ADMIN PAYMENT FLOW
-- Run this once in the Supabase SQL editor before releasing the matching apps.
--
-- Mirrors the customer-to-shop payment review lifecycle:
--   shop submits proof -> admin verifies OR rejects with a reason.

begin;

alter table public.shop_payments
  add column if not exists "gcashName" text,
  add column if not exists "rejectionReason" text,
  add column if not exists "updatedAt" timestamptz not null default now();

update public.shop_payments
set "updatedAt" = coalesce("updatedAt", "createdAt", now());

alter table public.shop_payments
  drop constraint if exists shop_payments_status_check;

alter table public.shop_payments
  add constraint shop_payments_status_check
  check (status in ('pending', 'verified', 'rejected')) not valid;

create index if not exists shop_payments_shop_created_idx
  on public.shop_payments ("shopId", "createdAt" desc);

create index if not exists shop_payments_status_created_idx
  on public.shop_payments (status, "createdAt" desc);

create or replace function public.enforce_shop_admin_payment_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
begin
  if actor_id is not null then
    select exists (
      select 1
      from public.users
      where id = actor_id
        and role in ('super_admin', 'admin', 'funeral_admin')
    ) into actor_is_admin;
  end if;

  if tg_op = 'INSERT' then
    if actor_id is not null and not actor_is_admin and actor_id <> new."shopId" then
      raise exception 'Shops may submit only their own payments.';
    end if;

    if new.status <> 'pending' then
      raise exception 'New shop payments must start as pending.';
    end if;

    if nullif(trim(new."payerName"), '') is null
       or nullif(trim(new."gcashName"), '') is null
       or nullif(trim(new."gcashNumber"), '') is null
       or nullif(trim(new."proofImageUrl"), '') is null
       or coalesce(new.amount, 0) <= 0 then
      raise exception 'Sender name, GCash name, GCash number, amount, and payment proof are required.';
    end if;

    new."rejectionReason" := null;
    new."verifiedAt" := null;
    new."expiresAt" := null;
    new."updatedAt" := now();
    return new;
  end if;

  if old.status is distinct from new.status then
    if not actor_is_admin then
      raise exception 'Only an administrator can review shop payments.';
    end if;

    if old.status <> 'pending' or new.status not in ('verified', 'rejected') then
      raise exception 'Invalid shop payment transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'verified' then
      new."verifiedAt" := coalesce(new."verifiedAt", now());
      new."rejectionReason" := null;
    else
      if nullif(trim(new."rejectionReason"), '') is null then
        raise exception 'A rejection reason is required.';
      end if;
      new."verifiedAt" := null;
      new."expiresAt" := null;
    end if;
  end if;

  new."updatedAt" := now();
  return new;
end;
$$;

drop trigger if exists enforce_shop_admin_payment_flow on public.shop_payments;
create trigger enforce_shop_admin_payment_flow
before insert or update on public.shop_payments
for each row execute function public.enforce_shop_admin_payment_flow();

comment on column public.shop_payments."gcashName" is
  'Name shown on the GCash account used to send the payment.';
comment on column public.shop_payments."rejectionReason" is
  'Required explanation shown to the shop when an admin rejects the proof.';

notify pgrst, 'reload schema';

commit;
