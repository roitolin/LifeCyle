begin;

alter table public.funeral_balance_payments
  add column if not exists provider_checkout_id text,
  add column if not exists provider_checkout_url text,
  add column if not exists provider_reference_id uuid,
  add column if not exists provider_payment_id text,
  add column if not exists provider_status text,
  add column if not exists provider_payment_method text,
  add column if not exists provider_livemode boolean,
  add column if not exists checkout_claim_id uuid,
  add column if not exists checkout_claimed_at timestamptz,
  add column if not exists provider_updated_at timestamptz;

create unique index if not exists funeral_balance_payments_provider_checkout_unique
  on public.funeral_balance_payments(provider_checkout_id)
  where provider_checkout_id is not null;
create unique index if not exists funeral_balance_payments_provider_reference_unique
  on public.funeral_balance_payments(provider_reference_id)
  where provider_reference_id is not null;
create unique index if not exists funeral_balance_payments_provider_payment_unique
  on public.funeral_balance_payments(provider_payment_id)
  where provider_payment_id is not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'funeral_balance_payments_provider_status_check'
      and conrelid = 'public.funeral_balance_payments'::regclass
  ) then
    alter table public.funeral_balance_payments
      add constraint funeral_balance_payments_provider_status_check
      check (provider_status is null or provider_status in ('creating', 'active', 'completed', 'expired'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'funeral_balance_payments_provider_livemode_check'
      and conrelid = 'public.funeral_balance_payments'::regclass
  ) then
    alter table public.funeral_balance_payments
      add constraint funeral_balance_payments_provider_livemode_check
      check (provider_livemode is null or provider_livemode = false);
  end if;
end
$constraints$;

create or replace function public.guard_funeral_balance_payment()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $function$
declare
  r public.funeral_service_requests%rowtype;
  receiver public.funeral_shop_payout_accounts%rowtype;
  provider_write boolean :=
    pg_catalog.current_setting('lifecycle.balance_provider_write', true) = 'on'
    and (
      current_user in ('postgres', 'supabase_admin')
      or pg_catalog.current_setting('role', true) = 'service_role'
    );
begin
  if provider_write then
    return new;
  end if;

  select * into r from public.funeral_service_requests where id = new.request_id for share;
  if not found or (select auth.uid()) is null then
    raise exception 'Service request is unavailable.';
  end if;
  if r."paymentOption" is distinct from 'downpayment'
     or r."paymentVerifiedAt" is null
     or r.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
     or coalesce(r."remainingBalance", 0) <= 0 then
    raise exception 'A confirmed downpayment with an outstanding balance is required.';
  end if;
  if tg_op = 'INSERT' then
    if r."requesterId" is distinct from (select auth.uid())
       and r."shopId" is distinct from (select auth.uid()) then
      raise exception 'Only the requesting customer or assigned shop can submit the remaining balance.';
    end if;
    if r."requesterId" is distinct from (select auth.uid()) and new.method is distinct from 'cash' then
      raise exception 'Shops can only directly record cash balance payments.';
    end if;
    if new.provider_checkout_id is not null
       or new.provider_checkout_url is not null
       or new.provider_reference_id is not null
       or new.provider_payment_id is not null
       or new.provider_status is not null
       or new.provider_payment_method is not null
       or new.provider_livemode is not null
       or new.checkout_claim_id is not null
       or new.checkout_claimed_at is not null
       or new.provider_updated_at is not null then
      raise exception 'Payment-provider fields can only be set by the payment service.';
    end if;
    new.amount := round(r."remainingBalance", 2);
    new.status := 'submitted';
    new.submitted_by := r."requesterId";
    new.submitted_at := now();
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
    if new.method = 'cash' then
      new.receiver_account_id := null;
      new.receiver_channel := null;
      new.receiver_name := null;
      new.receiver_number := null;
      new.payer_name := null;
      new.reference_number := null;
      new.proof_image_path := null;
    elsif new.method in ('wallet', 'bank') then
      select * into receiver from public.funeral_shop_payout_accounts
      where id = new.receiver_account_id and "shopId" = r."shopId"
        and active and "verifiedByAdmin";
      if not found or (new.method = 'wallet') is distinct from
          (receiver."channelCode" in ('PH_GCASH', 'PH_MAYA')) then
        raise exception 'Choose an active verified shop account matching the payment method.';
      end if;
      new.receiver_channel := receiver."channelCode";
      new.receiver_name := receiver."accountName";
      new.receiver_number := receiver."accountNumber";
      new.payer_name := nullif(trim(new.payer_name), '');
      new.reference_number := nullif(upper(regexp_replace(trim(new.reference_number), '[^A-Za-z0-9-]', '', 'g')), '');
      if new.payer_name is null or char_length(new.payer_name) not between 2 and 120
         or new.reference_number is null or char_length(new.reference_number) not between 6 and 100
         or new.proof_image_path is null
         or new.proof_image_path !~ ('^' || new.request_id::text || '/' || (select auth.uid())::text || '/[A-Za-z0-9.-]+[.]jpg$')
         or not exists (select 1 from storage.objects o
           where o.bucket_id = 'funeral-balance-receipts' and o.name = new.proof_image_path) then
        raise exception 'Provide the sender name, transaction reference, and a private uploaded receipt.';
      end if;
    else
      raise exception 'Choose cash, e-wallet, or bank transfer.';
    end if;
  else
    if old.provider_reference_id is not null then
      raise exception 'Only the payment provider can confirm an online checkout.';
    end if;
    if r."shopId" is distinct from (select auth.uid()) then
      raise exception 'Only the assigned shop can confirm receipt of the balance.';
    end if;
    if old.status <> 'submitted' or new.status not in ('verified', 'rejected') then
      raise exception 'Only payments awaiting review can be confirmed or rejected.';
    end if;
    if (to_jsonb(new) - array['status', 'rejection_reason', 'reviewed_by', 'reviewed_at'])
       is distinct from (to_jsonb(old) - array['status', 'rejection_reason', 'reviewed_by', 'reviewed_at']) then
      raise exception 'Submitted balance payment details cannot be edited.';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
    new.rejection_reason := case when new.status = 'rejected' then nullif(trim(new.rejection_reason), '') else null end;
    if new.status = 'rejected' and coalesce(char_length(new.rejection_reason), 0) not between 3 and 500 then
      raise exception 'Explain why the balance payment was rejected (3-500 characters).';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.claim_xendit_balance_checkout(
  p_request_id uuid,
  p_user_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  request_row public.funeral_service_requests%rowtype;
  payment_row public.funeral_balance_payments%rowtype;
  receiver_row public.funeral_shop_payout_accounts%rowtype;
  normalized_method text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_payment_method, '')));
  reference_id uuid;
  claim_id uuid;
begin
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Payment service authorization is required.';
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id
  for update;

  if not found or request_row."requesterId" is distinct from p_user_id then
    raise exception 'This service request is not available to this customer.';
  end if;
  if request_row."paymentOption" is distinct from 'downpayment'
     or request_row."paymentVerifiedAt" is null
     or request_row.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
     or coalesce(request_row."remainingBalance", 0) <= 0 then
    raise exception 'A confirmed downpayment with an outstanding balance is required.';
  end if;

  if normalized_method = 'PH_CARDS' then
    -- Card brands are customer checkout channels, not shop payout accounts.
    -- Route the collected balance to the shop's first active verified bank receiver.
    select * into receiver_row
    from public.funeral_shop_payout_accounts
    where "shopId" = request_row."shopId"
      and "channelCode" in (
        'PH_BDO', 'PH_BPI', 'PH_UBP', 'PH_METROBANK', 'PH_LANDBANK',
        'PH_PNB', 'PH_RCBC', 'PH_CHINABANK', 'PH_SECURITYBANK'
      )
      and active
      and "verifiedByAdmin"
    order by "verifiedAt" asc nulls last, "createdAt" asc, id
    limit 1
    for share;
  else
    select * into receiver_row
    from public.funeral_shop_payout_accounts
    where "shopId" = request_row."shopId"
      and "channelCode" = normalized_method
      and active
      and "verifiedByAdmin"
    order by "updatedAt" desc nulls last, id
    limit 1
    for share;
  end if;
  if not found then
    raise exception 'Choose an active payment method configured by this shop.';
  end if;

  select * into payment_row
  from public.funeral_balance_payments
  where request_id = p_request_id and status <> 'rejected'
  order by submitted_at desc
  limit 1
  for update;

  if found then
    if payment_row.provider_reference_id is null then
      raise exception 'A cash or manual balance payment is already awaiting review.';
    end if;
    if payment_row.status = 'verified' then
      return pg_catalog.jsonb_build_object(
        'paymentId', payment_row.id,
        'requestId', payment_row.request_id,
        'paid', true,
        'status', payment_row.status,
        'providerStatus', payment_row.provider_status
      );
    end if;
    if coalesce(payment_row.provider_payment_method, payment_row.receiver_channel) is distinct from normalized_method then
      raise exception 'This checkout is already locked to another payment method.';
    end if;
    if payment_row.provider_status = 'creating'
       and payment_row.provider_checkout_id is null
       and payment_row.checkout_claimed_at < pg_catalog.clock_timestamp() - interval '2 minutes' then
      claim_id := gen_random_uuid();
      perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
      update public.funeral_balance_payments
      set checkout_claim_id = claim_id,
          checkout_claimed_at = pg_catalog.clock_timestamp(),
          provider_updated_at = pg_catalog.clock_timestamp()
      where id = payment_row.id
      returning * into payment_row;
      perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);
    end if;
    return pg_catalog.jsonb_build_object(
      'paymentId', payment_row.id,
      'requestId', payment_row.request_id,
      'amount', payment_row.amount,
      'referenceId', payment_row.provider_reference_id,
      'checkoutClaimId', payment_row.checkout_claim_id,
      'idempotencyKey', 'lifecycle-balance-' || payment_row.provider_reference_id::text,
      'checkoutId', payment_row.provider_checkout_id,
      'checkoutUrl', payment_row.provider_checkout_url,
      'providerStatus', payment_row.provider_status,
      'shouldCreate', payment_row.provider_checkout_id is null,
      'inProgress', payment_row.provider_checkout_id is null
        and payment_row.checkout_claimed_at >= pg_catalog.clock_timestamp() - interval '2 minutes'
        and payment_row.checkout_claim_id is distinct from claim_id,
      'paid', false
    );
  end if;

  reference_id := gen_random_uuid();
  claim_id := gen_random_uuid();
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
  insert into public.funeral_balance_payments (
    request_id, amount, method, status, receiver_account_id,
    receiver_channel, receiver_name, receiver_number, reference_number,
    submitted_by, provider_reference_id, provider_status,
    provider_payment_method, provider_livemode, checkout_claim_id,
    checkout_claimed_at, provider_updated_at
  ) values (
    p_request_id,
    pg_catalog.round(request_row."remainingBalance", 2),
    case when normalized_method in ('PH_GCASH', 'PH_MAYA') then 'wallet' else 'bank' end,
    'submitted',
    receiver_row.id,
    receiver_row."channelCode",
    receiver_row."accountName",
    receiver_row."accountNumber",
    'XEN-' || pg_catalog.upper(pg_catalog.left(reference_id::text, 8)),
    request_row."requesterId",
    reference_id,
    'creating',
    normalized_method,
    false,
    claim_id,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ) returning * into payment_row;
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);

  return pg_catalog.jsonb_build_object(
    'paymentId', payment_row.id,
    'requestId', payment_row.request_id,
    'amount', payment_row.amount,
    'referenceId', payment_row.provider_reference_id,
    'checkoutClaimId', payment_row.checkout_claim_id,
    'idempotencyKey', 'lifecycle-balance-' || payment_row.provider_reference_id::text,
    'providerStatus', payment_row.provider_status,
    'shouldCreate', true,
    'inProgress', false,
    'paid', false
  );
end;
$function$;

create or replace function public.store_xendit_balance_checkout(
  p_payment_id uuid,
  p_checkout_claim_id uuid,
  p_payment_session_id text,
  p_payment_link_url text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_row public.funeral_balance_payments%rowtype;
begin
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Payment service authorization is required.';
  end if;
  if p_payment_session_id !~ '^ps-[A-Za-z0-9_-]{5,125}$'
     or p_payment_link_url !~ '^https://(checkout-staging[.]xendit[.]co|dev[.]xen[.]to)/'
     or p_amount <= 0 then
    raise exception 'The payment provider returned an invalid checkout.';
  end if;

  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
  update public.funeral_balance_payments
  set provider_checkout_id = p_payment_session_id,
      provider_checkout_url = p_payment_link_url,
      provider_status = 'active',
      provider_updated_at = pg_catalog.clock_timestamp()
  where id = p_payment_id
    and checkout_claim_id = p_checkout_claim_id
    and provider_status = 'creating'
    and provider_checkout_id is null
    and amount = pg_catalog.round(p_amount, 2)
  returning * into payment_row;
  perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);

  if not found then
    raise exception 'This balance checkout claim is no longer active.';
  end if;
  return pg_catalog.jsonb_build_object(
    'paymentId', payment_row.id,
    'requestId', payment_row.request_id,
    'checkoutId', payment_row.provider_checkout_id,
    'checkoutUrl', payment_row.provider_checkout_url,
    'status', payment_row.status,
    'providerStatus', payment_row.provider_status
  );
end;
$function$;

create or replace function public.reconcile_xendit_balance_event(
  p_event_id text,
  p_event_kind text,
  p_checkout_id text,
  p_reference_id uuid,
  p_provider_payment_id text,
  p_currency text,
  p_amount numeric,
  p_livemode boolean,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_row public.funeral_balance_payments%rowtype;
  request_row public.funeral_service_requests%rowtype;
  duplicate_event boolean := false;
begin
  if pg_catalog.current_setting('role', true) <> 'service_role'
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Payment service authorization is required.';
  end if;
  if p_event_kind not in ('payment_completed', 'payment_expired')
     or pg_catalog.upper(coalesce(p_currency, '')) <> 'PHP'
     or coalesce(p_livemode, true) then
    raise exception 'Unsupported balance payment event.';
  end if;

  select * into payment_row
  from public.funeral_balance_payments
  where provider_reference_id = p_reference_id
  for update;
  if not found then
    raise exception 'Balance payment reference was not found.';
  end if;
  if p_checkout_id is not null and payment_row.provider_checkout_id is distinct from p_checkout_id then
    raise exception 'Balance payment session does not match.';
  end if;
  if p_event_kind = 'payment_completed'
     and (p_amount is null or pg_catalog.round(p_amount, 2) <> payment_row.amount) then
    raise exception 'Balance payment amount does not match.';
  end if;

  duplicate_event := payment_row.status = 'verified'
    and payment_row.provider_status = 'completed';
  if not duplicate_event then
    perform pg_catalog.set_config('lifecycle.balance_provider_write', 'on', true);
    if p_event_kind = 'payment_completed' then
      update public.funeral_balance_payments
      set status = 'verified',
          reviewed_by = null,
          reviewed_at = pg_catalog.clock_timestamp(),
          rejection_reason = null,
          provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
          provider_status = 'completed',
          provider_payment_method = coalesce(nullif(pg_catalog.upper(pg_catalog.btrim(p_payment_method)), ''), provider_payment_method),
          provider_updated_at = pg_catalog.clock_timestamp()
      where id = payment_row.id
      returning * into payment_row;
    elsif payment_row.status <> 'verified' then
      update public.funeral_balance_payments
      set status = 'rejected',
          reviewed_by = null,
          reviewed_at = pg_catalog.clock_timestamp(),
          rejection_reason = 'The online payment link expired before payment was completed.',
          provider_status = 'expired',
          provider_updated_at = pg_catalog.clock_timestamp()
      where id = payment_row.id
      returning * into payment_row;
    end if;
    perform pg_catalog.set_config('lifecycle.balance_provider_write', 'off', true);
  end if;

  select * into request_row
  from public.funeral_service_requests
  where id = payment_row.request_id;

  if p_event_kind = 'payment_completed' and not duplicate_event then
    insert into public.notifications ("userId", type, title, body, data, read, dedupe_key)
    values (
      request_row."requesterId",
      'payment_remaining_verified',
      'Remaining balance paid',
      'Your remaining balance payment was confirmed.',
      pg_catalog.jsonb_build_object('requestId', payment_row.request_id, 'paymentId', payment_row.id),
      false,
      'balance-paid-customer:' || payment_row.id::text
    ) on conflict ("userId", dedupe_key) do nothing;

    insert into public.notifications ("userId", type, title, body, data, read, dedupe_key)
    values (
      request_row."shopId",
      'payment_remaining_received',
      'Remaining balance received',
      'The customer completed the remaining balance payment.',
      pg_catalog.jsonb_build_object('requestId', payment_row.request_id, 'paymentId', payment_row.id),
      false,
      'balance-paid-shop:' || payment_row.id::text
    ) on conflict ("userId", dedupe_key) do nothing;
  end if;

  return pg_catalog.jsonb_build_object(
    'paymentId', payment_row.id,
    'requestId', payment_row.request_id,
    'status', payment_row.status,
    'providerStatus', payment_row.provider_status,
    'duplicate', duplicate_event,
    'eventId', pg_catalog.left(coalesce(p_event_id, ''), 255)
  );
end;
$function$;

revoke all on function public.claim_xendit_balance_checkout(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.store_xendit_balance_checkout(uuid, uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.reconcile_xendit_balance_event(text, text, text, uuid, text, text, numeric, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_xendit_balance_checkout(uuid, uuid, text) to service_role;
grant execute on function public.store_xendit_balance_checkout(uuid, uuid, text, text, numeric) to service_role;
grant execute on function public.reconcile_xendit_balance_event(text, text, text, uuid, text, text, numeric, boolean, text) to service_role;

comment on function public.claim_xendit_balance_checkout(uuid, uuid, text) is
  'Creates or reuses an authoritative test-mode Xendit checkout claim for a confirmed remaining balance.';
comment on function public.reconcile_xendit_balance_event(text, text, text, uuid, text, text, numeric, boolean, text) is
  'Verifies a test-mode Xendit remaining-balance event and marks the balance paid or expired.';

commit;
