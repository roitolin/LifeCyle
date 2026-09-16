begin;

alter table public.shop_payments
  add column if not exists "paymentProvider" text not null default 'manual',
  add column if not exists "providerCheckoutId" text,
  add column if not exists "providerCheckoutUrl" text,
  add column if not exists "providerPaymentId" text,
  add column if not exists "providerPaymentMethod" text,
  add column if not exists "providerStatus" text,
  add column if not exists "providerLivemode" boolean,
  add column if not exists "providerEventId" text;

create unique index if not exists shop_payments_provider_checkout_unique
  on public.shop_payments ("providerCheckoutId")
  where "providerCheckoutId" is not null;

create unique index if not exists shop_payments_paymongo_pending_per_shop
  on public.shop_payments ("shopId")
  where "paymentProvider" = 'paymongo' and status = 'pending';

create table if not exists public.paymongo_webhook_events (
  id text primary key,
  "eventType" text not null,
  "checkoutId" text not null,
  "paymentId" uuid references public.shop_payments(id) on delete set null,
  livemode boolean not null,
  "receivedAt" timestamptz not null default now()
);

alter table public.paymongo_webhook_events enable row level security;
revoke all on table public.paymongo_webhook_events from anon, authenticated;
grant all on table public.paymongo_webhook_events to service_role;

create or replace function public.enforce_shop_admin_payment_flow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  actor_is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if actor_id is not null then
    select exists (
      select 1
      from public.users
      where id = actor_id
        and role in ('super_admin', 'admin', 'funeral_admin')
    ) into actor_is_admin;
  end if;

  new."paymentProvider" := lower(trim(coalesce(new."paymentProvider", 'manual')));
  if new."paymentProvider" not in ('manual', 'paymongo') then
    raise exception 'Unsupported shop payment provider.';
  end if;

  if tg_op = 'INSERT' then
    if actor_id is not null
       and not actor_is_admin
       and not actor_is_service_role
       and actor_id <> new."shopId" then
      raise exception 'Shops may submit only their own payments.';
    end if;

    if new.status <> 'pending' then
      raise exception 'New shop payments must start as pending.';
    end if;

    if coalesce(new.amount, 0) <= 0 then
      raise exception 'A positive payment amount is required.';
    end if;

    if new."paymentProvider" = 'paymongo' then
      if nullif(trim(coalesce(new."referenceNumber", '')), '') is null then
        raise exception 'A PayMongo checkout reference is required.';
      end if;
    elsif nullif(trim(new."payerName"), '') is null
       or nullif(trim(new."gcashName"), '') is null
       or nullif(trim(new."gcashNumber"), '') is null
       or nullif(trim(new."proofImageUrl"), '') is null then
      raise exception 'Sender name, GCash name, GCash number, and payment proof are required.';
    end if;

    new."rejectionReason" := null;
    new."verifiedAt" := null;
    new."expiresAt" := null;
    new."updatedAt" := now();
    return new;
  end if;

  if old."shopId" is distinct from new."shopId"
     or old."paymentProvider" is distinct from new."paymentProvider"
     or old.amount is distinct from new.amount
     or old."referenceNumber" is distinct from new."referenceNumber" then
    if not actor_is_admin and not actor_is_service_role then
      raise exception 'Payment identity fields cannot be changed.';
    end if;
  end if;

  if old.status is distinct from new.status then
    if not actor_is_admin and not actor_is_service_role then
      raise exception 'Only an administrator or verified payment provider can review shop payments.';
    end if;

    if old.status <> 'pending' or new.status not in ('verified', 'rejected') then
      raise exception 'Invalid shop payment transition: % -> %', old.status, new.status;
    end if;

    if new.status = 'verified' then
      new."verifiedAt" := coalesce(new."verifiedAt", now());
      new."expiresAt" := coalesce(new."expiresAt", now() + interval '1 month');
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

create or replace function public.complete_paymongo_shop_payment(
  p_event_id text,
  p_checkout_id text,
  p_reference_number text,
  p_provider_payment_id text,
  p_payment_method text,
  p_amount_cents bigint,
  p_livemode boolean,
  p_payer_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.shop_payments%rowtype;
  inserted_event_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the payment service.';
  end if;

  select * into payment_row
  from public.shop_payments
  where "paymentProvider" = 'paymongo'
    and (
      "providerCheckoutId" = nullif(trim(p_checkout_id), '')
      or "referenceNumber" = public.normalize_payment_reference(p_reference_number)
    )
  order by "createdAt" desc
  limit 1
  for update;

  if not found then
    raise exception 'No LifeCycle payment matches this PayMongo checkout.';
  end if;

  if payment_row.status = 'rejected' then
    raise exception 'This payment checkout is no longer active.';
  end if;

  if round(payment_row.amount * 100)::bigint <> p_amount_cents then
    raise exception 'PayMongo payment amount does not match the LifeCycle fee.';
  end if;

  if payment_row."providerLivemode" is distinct from p_livemode then
    raise exception 'PayMongo payment mode does not match the checkout.';
  end if;

  insert into public.paymongo_webhook_events (
    id, "eventType", "checkoutId", "paymentId", livemode
  ) values (
    p_event_id,
    'checkout_session.payment.paid',
    p_checkout_id,
    payment_row.id,
    p_livemode
  )
  on conflict (id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return payment_row.id;
  end if;

  if payment_row.status = 'pending' then
    update public.shop_payments
    set status = 'verified',
        "providerStatus" = 'paid',
        "providerPaymentId" = nullif(trim(p_provider_payment_id), ''),
        "providerPaymentMethod" = nullif(trim(p_payment_method), ''),
        "providerEventId" = p_event_id,
        "payerName" = coalesce(nullif(trim(p_payer_name), ''), "payerName"),
        "verifiedAt" = now(),
        "expiresAt" = now() + interval '1 month',
        "rejectionReason" = null
    where id = payment_row.id;

    insert into public.notifications ("userId", type, title, body, data)
    values (
      payment_row."shopId",
      'shop_payment_verified',
      'PayMongo Payment Confirmed',
      'Your registration payment was confirmed automatically. You can now make your shop live.',
      jsonb_build_object(
        'paymentId', payment_row.id,
        'checkoutId', p_checkout_id,
        'provider', 'paymongo'
      )
    );
  end if;

  return payment_row.id;
end;
$$;

revoke all on function public.complete_paymongo_shop_payment(text, text, text, text, text, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_paymongo_shop_payment(text, text, text, text, text, bigint, boolean, text)
  to service_role;

comment on column public.shop_payments."paymentProvider" is
  'manual for legacy receipt review, or paymongo for hosted checkout.';
comment on column public.shop_payments."providerCheckoutId" is
  'PayMongo Checkout Session ID used for reconciliation.';
comment on function public.complete_paymongo_shop_payment(text, text, text, text, text, bigint, boolean, text) is
  'Atomically deduplicates a verified PayMongo event and confirms the matching shop payment.';

notify pgrst, 'reload schema';

commit;
