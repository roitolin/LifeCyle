begin;

alter table public.funeral_service_requests
  add column if not exists "paymentProvider" text not null default 'manual',
  add column if not exists "providerCheckoutId" text,
  add column if not exists "providerCheckoutUrl" text,
  add column if not exists "providerPaymentId" text,
  add column if not exists "providerPaymentMethod" text,
  add column if not exists "providerStatus" text,
  add column if not exists "providerLivemode" boolean,
  add column if not exists "providerEventId" text,
  add column if not exists "providerCheckoutCreatedAt" timestamptz;

create unique index if not exists funeral_service_requests_provider_checkout_unique
  on public.funeral_service_requests ("providerCheckoutId")
  where "providerCheckoutId" is not null;

create table if not exists public.paymongo_service_webhook_events (
  id text primary key,
  "eventType" text not null,
  "checkoutId" text not null,
  "requestId" uuid references public.funeral_service_requests(id) on delete set null,
  livemode boolean not null,
  "receivedAt" timestamptz not null default now()
);

alter table public.paymongo_service_webhook_events enable row level security;
revoke all on table public.paymongo_service_webhook_events from anon, authenticated;
grant all on table public.paymongo_service_webhook_events to service_role;

create or replace function public.complete_paymongo_service_payment(
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
  request_row public.funeral_service_requests%rowtype;
  inserted_event_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'This function is restricted to the payment service.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where "paymentProvider" = 'paymongo'
    and (
      "providerCheckoutId" = nullif(trim(p_checkout_id), '')
      or "paymentReferenceNumber" = public.normalize_payment_reference(p_reference_number)
    )
  order by "updatedAt" desc
  limit 1
  for update;

  if not found then
    raise exception 'No service request matches this PayMongo checkout.';
  end if;

  if request_row.status not in ('awaiting_payment', 'payment_verified') then
    raise exception 'This service request is not awaiting payment.';
  end if;

  if round(coalesce(nullif(trim(request_row."paymentAmount"::text), ''), '0')::numeric * 100)::bigint <> p_amount_cents then
    raise exception 'PayMongo payment amount does not match the service total.';
  end if;

  if request_row."providerLivemode" is distinct from p_livemode then
    raise exception 'PayMongo payment mode does not match the checkout.';
  end if;

  insert into public.paymongo_service_webhook_events (
    id, "eventType", "checkoutId", "requestId", livemode
  ) values (
    p_event_id,
    'checkout_session.payment.paid',
    p_checkout_id,
    request_row.id,
    p_livemode
  )
  on conflict (id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return request_row.id;
  end if;

  if request_row.status = 'awaiting_payment' then
    update public.funeral_service_requests
    set status = 'payment_verified',
        "paymentProvider" = 'paymongo',
        "providerStatus" = 'paid',
        "providerPaymentId" = nullif(trim(p_provider_payment_id), ''),
        "providerPaymentMethod" = nullif(trim(p_payment_method), ''),
        "providerEventId" = p_event_id,
        "paymentPayerName" = coalesce(nullif(trim(p_payer_name), ''), "paymentPayerName"),
        "paymentGcashName" = 'PayMongo ' || coalesce(nullif(trim(p_payment_method), ''), 'checkout'),
        "paymentGcashNumber" = null,
        "paymentReferenceNumber" = public.normalize_payment_reference(p_reference_number),
        "paymentProofImageUrl" = null,
        "paymentSubmittedAt" = now(),
        "paymentVerifiedAt" = now(),
        "paymentRejectionReason" = null,
        "updatedAt" = now()
    where id = request_row.id;

    insert into public.notifications ("userId", type, title, body, data, read)
    values
      (
        request_row."shopId",
        'funeral_payment_verified',
        'Customer Payment Confirmed',
        'PayMongo confirmed the customer payment for ' || coalesce(request_row."productName", 'the service request') || '.',
        jsonb_build_object('requestId', request_row.id, 'provider', 'paymongo'),
        false
      ),
      (
        request_row."requesterId",
        'funeral_payment_verified',
        'Payment Confirmed',
        'Your PayMongo payment to ' || coalesce(request_row."shopName", 'the funeral shop') || ' was confirmed.',
        jsonb_build_object('requestId', request_row.id, 'provider', 'paymongo'),
        false
      );
  end if;

  return request_row.id;
end;
$$;

revoke all on function public.complete_paymongo_service_payment(text, text, text, text, text, bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.complete_paymongo_service_payment(text, text, text, text, text, bigint, boolean, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
