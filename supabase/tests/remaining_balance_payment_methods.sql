-- Integration checks clone a confirmed downpayment into a transaction-only fixture.
-- All submitted/reviewed payments below are rolled back. No provider is called.
begin;
set local statement_timeout = '30s';
do $$
declare
  r public.funeral_service_requests%rowtype;
  wallet_id uuid;
  bank_id uuid;
  stranger_id uuid;
  payment_id uuid;
  row_count integer;
  before_requests text;
  before_payments bigint;
  fixture jsonb;
  customer_id uuid;
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select count(*) into before_payments from public.funeral_balance_payments;
  select * into r from public.funeral_service_requests
  where "paymentOption" = 'downpayment' and "paymentVerifiedAt" is not null
    and "remainingBalance" > 0 and status = 'payment_verified'
  order by "createdAt" desc limit 1;
  if r.id is null then raise exception 'Fixture required: confirmed downpayment with a remaining balance.'; end if;
  select id into customer_id from public.users where id <> r."shopId" order by id limit 1;
  select jsonb_object_agg(key, case
    when key like 'provider%' or key like 'payout%' or key like 'commission%'
      or key in ('paymentProvider', 'paymentReferenceNumber', 'shopNetAmount', 'cartId') then 'null'::jsonb
    else value end) into fixture from jsonb_each(to_jsonb(r));
  fixture := fixture || jsonb_build_object(
    'id', gen_random_uuid(), 'requesterId', customer_id, 'status', 'awaiting_payment', 'paymentProvider', 'xendit',
    'wakeStartDate', current_date + 730, 'wakeEndDate', current_date + 731,
    'deceasedFullName', 'Transaction-only balance test', 'createdAt', now());
  insert into public.funeral_service_requests select *
    from jsonb_populate_record(null::public.funeral_service_requests, fixture)
    returning * into r;
  perform set_config('lifecycle.payment_selection', 'on', true);
  update public.funeral_service_requests set "paymentOption" = 'downpayment',
    status = 'payment_verified', "paymentVerifiedAt" = now()
    where id = r.id returning * into r;
  -- Metadata-only receipt fixture. No real file is uploaded; rollback removes it.
  insert into storage.objects(bucket_id, name)
    values ('funeral-balance-receipts', r.id || '/' || r."requesterId" || '/balance-test.jpg');
  select md5(string_agg(to_jsonb(t)::text, ',' order by id)) into before_requests
    from public.funeral_service_requests t;
  select id into wallet_id from public.funeral_shop_payout_accounts
    where "shopId" = r."shopId" and active and "verifiedByAdmin"
      and "channelCode" in ('PH_GCASH', 'PH_MAYA') limit 1;
  select id into bank_id from public.funeral_shop_payout_accounts
    where "shopId" = r."shopId" and active and "verifiedByAdmin"
      and "channelCode" not in ('PH_GCASH', 'PH_MAYA') limit 1;
  select id into stranger_id from public.users
    where id not in (r."shopId", r."requesterId") limit 1;
  if wallet_id is null or bank_id is null or stranger_id is null then
    raise exception 'Fixture requires wallet, bank, and an unrelated user.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', r."requesterId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."requesterId"::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.funeral_shop_payout_accounts where id in (wallet_id, bank_id)) <> 2 then
    raise exception 'The customer cannot read the verified balance receiver accounts.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'funeral-balance-receipts'
    and name = r.id || '/' || r."requesterId" || '/balance-test.jpg') then
    raise exception 'The customer cannot read their private receipt.';
  end if;
  insert into public.funeral_balance_payments(request_id, method)
    values (r.id, 'cash') returning id into payment_id;
  if not exists (select 1 from public.funeral_balance_payments
    where id = payment_id and amount = r."remainingBalance" and status = 'submitted'
      and reviewed_at is null and submitted_by = r."requesterId") then
    raise exception 'Cash was not recorded as unpaid with the trusted remaining amount.';
  end if;
  update public.funeral_balance_payments set status = 'verified' where id = payment_id;
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'A customer was able to confirm their own payment.'; end if;
  begin
    insert into public.funeral_balance_payments(request_id, method) values (r.id, 'cash');
    raise exception using errcode = 'ZX001', message = 'Duplicate balance payment was allowed.';
  exception when unique_violation then null; end;
  begin
    insert into public.funeral_balance_payments(request_id, method, amount) values (r.id, 'cash', 1);
    raise exception using errcode = 'ZX001', message = 'Client-supplied amount was allowed.';
  exception when insufficient_privilege then null; end;

  -- An unrelated customer cannot read payments/accounts or submit against this request.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', stranger_id::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.funeral_balance_payments where id = payment_id)
    or exists (select 1 from public.funeral_shop_payout_accounts where id in (wallet_id, bank_id))
    or exists (select 1 from storage.objects where bucket_id = 'funeral-balance-receipts'
      and name = r.id || '/' || r."requesterId" || '/balance-test.jpg') then
    raise exception 'Balance details were exposed to an unrelated user.';
  end if;
  begin
    insert into public.funeral_balance_payments(request_id, method) values (r.id, 'cash');
    raise exception using errcode = 'ZX001', message = 'Unrelated customer submitted a payment.';
  exception when raise_exception or insufficient_privilege then null; end;

  -- Confirm cash, assert it is paid, and undo just this review to also test rejection.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', r."shopId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."shopId"::text, true);
  execute 'set local role authenticated';
  if not exists (select 1 from storage.objects where bucket_id = 'funeral-balance-receipts'
    and name = r.id || '/' || r."requesterId" || '/balance-test.jpg') then
    raise exception 'The assigned shop cannot read the private receipt.';
  end if;
  begin
    update public.funeral_balance_payments set status = 'verified' where id = payment_id;
    if not exists (select 1 from public.funeral_balance_payments where id = payment_id
      and status = 'verified' and reviewed_by = r."shopId" and reviewed_at is not null) then
      raise exception 'Shop cash confirmation failed.';
    end if;
    raise exception using errcode = 'ZX002', message = 'Undo successful cash verification test.';
  exception when sqlstate 'ZX002' then null; end;
  begin
    update public.funeral_balance_payments set status = 'rejected' where id = payment_id;
    raise exception using errcode = 'ZX001', message = 'A rejection without a reason was allowed.';
  exception when raise_exception then null; end;
  update public.funeral_balance_payments set status = 'rejected', rejection_reason = 'Cash not received.' where id = payment_id;

  -- E-wallet receipts must match the selected receiver type and include evidence.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', r."requesterId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."requesterId"::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.funeral_balance_payments(request_id, method, receiver_account_id)
      values (r.id, 'wallet', wallet_id);
    raise exception using errcode = 'ZX001', message = 'A wallet transfer without evidence was accepted.';
  exception when raise_exception then null; end;
  begin
    insert into public.funeral_balance_payments(request_id, method, receiver_account_id)
      values (r.id, 'wallet', bank_id);
    raise exception using errcode = 'ZX001', message = 'A bank receiver was accepted as a wallet.';
  exception when raise_exception then null; end;
  insert into public.funeral_balance_payments(request_id, method, receiver_account_id, payer_name, reference_number, proof_image_path)
    values (r.id, 'wallet', wallet_id, 'Integration Test', 'BALANCE-WALLET-TEST',
      r.id || '/' || r."requesterId" || '/balance-test.jpg')
    returning id into payment_id;
  if not exists (select 1 from public.funeral_balance_payments where id = payment_id
    and status = 'submitted' and receiver_channel in ('PH_GCASH', 'PH_MAYA') and receiver_number is not null) then
    raise exception 'Wallet transfer or receiver snapshot failed.';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', r."shopId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."shopId"::text, true);
  execute 'set local role authenticated';
  update public.funeral_balance_payments set status = 'rejected', rejection_reason = 'Receipt does not match.' where id = payment_id;

  -- After rejection a new bank submission is allowed; final verification locks collection.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', r."requesterId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."requesterId"::text, true);
  execute 'set local role authenticated';
  insert into public.funeral_balance_payments(request_id, method, receiver_account_id, payer_name, reference_number, proof_image_path)
    values (r.id, 'bank', bank_id, 'Integration Test', 'BALANCE-BANK-TEST',
      r.id || '/' || r."requesterId" || '/balance-test.jpg')
    returning id into payment_id;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', r."shopId", 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', r."shopId"::text, true);
  execute 'set local role authenticated';
  update public.funeral_balance_payments set status = 'verified' where id = payment_id;
  if not exists (select 1 from public.funeral_balance_payments where id = payment_id
    and status = 'verified' and amount = r."remainingBalance") then
    raise exception 'The bank balance payment was not verified correctly.';
  end if;
  begin
    update public.funeral_balance_payments set status = 'rejected', rejection_reason = 'Invalid edit' where id = payment_id;
    raise exception using errcode = 'ZX001', message = 'A confirmed payment was editable.';
  exception when raise_exception then null; end;
  execute 'reset role';
  if (select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from public.funeral_service_requests t)
      is distinct from before_requests then
    raise exception 'An original request, payment, or payout was changed.';
  end if;
  if (select count(*) from public.funeral_balance_payments) <> before_payments + 3 then
    raise exception 'Payment submission history was not preserved.';
  end if;
end;
$$;
select 'PASS: cash, wallet, bank, private receipt access, review, rejection/resubmission, duplicate prevention, role isolation, and original payment preservation. All fixtures rolled back.' as result;
rollback;
