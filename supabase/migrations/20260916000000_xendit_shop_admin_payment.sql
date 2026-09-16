begin;

alter table public.shop_payments
  add column if not exists "providerBusinessId" text,
  add column if not exists "providerCurrency" text,
  add column if not exists "providerCheckoutCreatedAt" timestamptz;

create unique index if not exists shop_payments_xendit_pending_per_shop
  on public.shop_payments ("shopId")
  where "paymentProvider" = 'xendit' and status = 'pending';

create unique index if not exists shop_payments_xendit_payment_unique
  on public.shop_payments ("providerPaymentId")
  where "paymentProvider" = 'xendit' and "providerPaymentId" is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.xendit_shop_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_kind text not null check (event_kind in ('payment_completed', 'payment_expired')),
  shop_payment_id uuid not null references public.shop_payments(id) on delete cascade,
  checkout_id text,
  provider_payment_id text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  resulting_payment_status text,
  resulting_provider_status text
);

create index if not exists xendit_shop_webhook_events_payment_received
  on private.xendit_shop_webhook_events (shop_payment_id, received_at desc);

alter table private.xendit_shop_webhook_events enable row level security;
revoke all on table private.xendit_shop_webhook_events from public, anon, authenticated;
grant select, insert, update on table private.xendit_shop_webhook_events to service_role;

create or replace function public.enforce_shop_admin_payment_flow()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  actor_is_service_role boolean := coalesce(auth.role(), '') = 'service_role';
  hosted_provider boolean;
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
  if new."paymentProvider" not in ('manual', 'paymongo', 'xendit') then
    raise exception 'Unsupported shop payment provider.';
  end if;
  hosted_provider := new."paymentProvider" in ('paymongo', 'xendit');

  if tg_op = 'INSERT' then
    if not actor_is_service_role
       and (actor_id is null or actor_id <> new."shopId") then
      raise exception 'Shops may submit only their own payments.';
    end if;
    if hosted_provider and not actor_is_service_role then
      raise exception 'Hosted checkout records can be created only by the payment service.';
    end if;
    if new.status <> 'pending' then
      raise exception 'New shop payments must start as pending.';
    end if;
    if coalesce(new.amount, 0) <= 0 then
      raise exception 'A positive payment amount is required.';
    end if;

    if hosted_provider then
      if nullif(trim(coalesce(new."referenceNumber", '')), '') is null then
        raise exception 'A hosted checkout reference is required.';
      end if;
      if new."paymentProvider" = 'xendit' then
        if new."providerLivemode" is distinct from false
           or upper(trim(coalesce(new."providerCurrency", ''))) <> 'PHP'
           or nullif(trim(coalesce(new."providerBusinessId", '')), '') is null then
          raise exception 'A valid Xendit Test Mode payment context is required.';
        end if;
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

  if old."providerCheckoutId" is distinct from new."providerCheckoutId"
     or old."providerCheckoutUrl" is distinct from new."providerCheckoutUrl"
     or old."providerPaymentId" is distinct from new."providerPaymentId"
     or old."providerPaymentMethod" is distinct from new."providerPaymentMethod"
     or old."providerStatus" is distinct from new."providerStatus"
     or old."providerLivemode" is distinct from new."providerLivemode"
     or old."providerEventId" is distinct from new."providerEventId"
     or old."providerBusinessId" is distinct from new."providerBusinessId"
     or old."providerCurrency" is distinct from new."providerCurrency"
     or old."providerCheckoutCreatedAt" is distinct from new."providerCheckoutCreatedAt" then
    if not actor_is_service_role then
      raise exception 'Hosted checkout fields can be changed only by the payment service.';
    end if;
  end if;

  if old.status is distinct from new.status then
    if old."paymentProvider" = 'xendit' and not actor_is_service_role then
      raise exception 'Only a verified Xendit webhook can review this payment.';
    end if;
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

create or replace function public.reconcile_xendit_shop_payment_event(
  p_event_id text,
  p_event_type text,
  p_event_kind text,
  p_checkout_id text,
  p_reference_number text,
  p_provider_payment_id text default null,
  p_payment_method text default null,
  p_business_id text default null,
  p_currency text default null,
  p_amount numeric default null,
  p_livemode boolean default false,
  p_payer_name text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  payment_row public.shop_payments%rowtype;
  normalized_event_id text := nullif(trim(p_event_id), '');
  event_type text := nullif(trim(p_event_type), '');
  event_kind text := lower(trim(coalesce(p_event_kind, '')));
  checkout_id text := nullif(trim(p_checkout_id), '');
  reference_number text := public.normalize_payment_reference(p_reference_number);
  provider_payment_id text := nullif(trim(p_provider_payment_id), '');
  payment_method text := nullif(trim(p_payment_method), '');
  business_id text := nullif(trim(p_business_id), '');
  currency_code text := upper(trim(coalesce(p_currency, '')));
  inserted_event_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the verified Xendit webhook service.';
  end if;
  if normalized_event_id is null or event_type is null
     or char_length(normalized_event_id) > 255 or char_length(event_type) > 255 then
    raise exception 'Valid Xendit event identifiers are required.';
  end if;
  if event_kind not in ('payment_completed', 'payment_expired') then
    raise exception 'Unsupported Xendit shop payment event.';
  end if;
  if p_livemode then
    raise exception 'Live Xendit events are not accepted by this Test Mode integration.';
  end if;
  if checkout_id is null or reference_number is null then
    raise exception 'The Xendit session and shop payment reference are required.';
  end if;

  select * into payment_row
  from public.shop_payments
  where "paymentProvider" = 'xendit'
    and (
      "providerCheckoutId" = checkout_id
      or public.normalize_payment_reference("referenceNumber") = reference_number
    )
  order by "createdAt" desc
  limit 1
  for update;

  if not found then
    raise exception 'No LifeCycle shop payment matches this Xendit checkout.';
  end if;
  if payment_row.status = 'rejected' then
    raise exception 'This Xendit shop checkout is no longer active.';
  end if;
  if payment_row."providerCheckoutId" is distinct from checkout_id
     or public.normalize_payment_reference(payment_row."referenceNumber") is distinct from reference_number then
    raise exception 'The Xendit shop checkout identity does not match.';
  end if;
  if payment_row."providerLivemode" is distinct from p_livemode
     or payment_row."providerBusinessId" is distinct from business_id
     or payment_row."providerCurrency" is distinct from currency_code then
    raise exception 'The Xendit shop payment context does not match.';
  end if;

  if event_kind = 'payment_completed' then
    if provider_payment_id is null or p_amount is null
       or p_amount <> round(p_amount, 2)
       or payment_row.amount is distinct from p_amount then
      raise exception 'The Xendit payment does not match the LifeCycle registration fee.';
    end if;
    if payment_row."providerPaymentId" is not null
       and payment_row."providerPaymentId" <> provider_payment_id then
      raise exception 'A different Xendit payment is already attached to this checkout.';
    end if;
  end if;

  insert into private.xendit_shop_webhook_events (
    event_id,
    event_type,
    event_kind,
    shop_payment_id,
    checkout_id,
    provider_payment_id,
    payload
  ) values (
    normalized_event_id,
    event_type,
    event_kind,
    payment_row.id,
    checkout_id,
    provider_payment_id,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return jsonb_build_object(
      'paymentId', payment_row.id,
      'status', payment_row.status,
      'providerStatus', payment_row."providerStatus",
      'duplicate', true
    );
  end if;

  if event_kind = 'payment_completed' and payment_row.status = 'pending' then
    update public.shop_payments
    set status = 'verified',
        "providerStatus" = 'payment_verified',
        "providerPaymentId" = provider_payment_id,
        "providerPaymentMethod" = payment_method,
        "providerEventId" = normalized_event_id,
        "payerName" = coalesce(nullif(trim(p_payer_name), ''), "payerName"),
        "verifiedAt" = now(),
        "expiresAt" = now() + interval '1 month',
        "rejectionReason" = null,
        "updatedAt" = now()
    where id = payment_row.id
    returning * into payment_row;

    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      payment_row."shopId",
      'shop_payment_verified',
      'Xendit Payment Confirmed',
      'Your LifeCycle registration payment was confirmed automatically. You can now make your shop live.',
      jsonb_build_object(
        'paymentId', payment_row.id,
        'checkoutId', checkout_id,
        'provider', 'xendit'
      ),
      false
    );
  elsif event_kind = 'payment_expired' and payment_row.status = 'pending' then
    update public.shop_payments
    set "providerStatus" = 'expired',
        "providerEventId" = normalized_event_id,
        "updatedAt" = now()
    where id = payment_row.id
    returning * into payment_row;
  end if;

  update private.xendit_shop_webhook_events
  set processed_at = now(),
      resulting_payment_status = payment_row.status,
      resulting_provider_status = payment_row."providerStatus"
  where event_id = normalized_event_id;

  return jsonb_build_object(
    'paymentId', payment_row.id,
    'status', payment_row.status,
    'providerStatus', payment_row."providerStatus",
    'duplicate', false
  );
end;
$$;

revoke all on function public.reconcile_xendit_shop_payment_event(
  text, text, text, text, text, text, text, text, text, numeric, boolean, text, jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_xendit_shop_payment_event(
  text, text, text, text, text, text, text, text, text, numeric, boolean, text, jsonb
) to service_role;

comment on column public.shop_payments."providerBusinessId" is
  'Provider business ID snapshotted when a hosted shop-to-admin checkout is created.';
comment on column public.shop_payments."providerCurrency" is
  'Provider checkout currency. Xendit shop-to-admin payments are restricted to PHP.';
comment on function public.reconcile_xendit_shop_payment_event(
  text, text, text, text, text, text, text, text, text, numeric, boolean, text, jsonb
) is
  'Idempotently confirms direct Xendit Test Mode registration payments to the LifeCycle master account.';

notify pgrst, 'reload schema';

commit;
