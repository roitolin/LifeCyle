-- Remaining balances are direct settlements reviewed by the assigned shop.
-- Never overwrite the original Xendit downpayment, commission, or payout record.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create policy "Confirmed downpayment customers can view balance receivers"
on public.funeral_shop_payout_accounts for select to authenticated
using (
  active and "verifiedByAdmin"
  and exists (
    select 1 from public.funeral_service_requests r
    where r."shopId" = funeral_shop_payout_accounts."shopId"
      and r."requesterId" = (select auth.uid())
      and r."paymentOption" = 'downpayment'
      and r."remainingBalance" > 0
      and r."paymentVerifiedAt" is not null
      and r.status in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
  )
);

create table public.funeral_balance_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.funeral_service_requests(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash', 'wallet', 'bank')),
  status text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
  receiver_account_id uuid references public.funeral_shop_payout_accounts(id),
  receiver_channel text,
  receiver_name text,
  receiver_number text,
  payer_name text,
  reference_number text,
  proof_image_url text,
  submitted_by uuid not null references public.users(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  constraint balance_payment_evidence check (
    (method = 'cash' and receiver_account_id is null)
    or (method in ('wallet', 'bank') and receiver_account_id is not null
      and char_length(payer_name) between 2 and 120
      and char_length(reference_number) between 6 and 100
      and proof_image_url is not null)
  ),
  constraint balance_payment_review check (
    (status = 'submitted' and reviewed_by is null and reviewed_at is null and rejection_reason is null)
    or (status = 'verified' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null
      and char_length(rejection_reason) between 3 and 500)
  )
);

-- A pending review or a confirmed settlement prevents duplicate collection.
create unique index funeral_balance_payments_one_open_or_paid
  on public.funeral_balance_payments(request_id) where status <> 'rejected';
create index funeral_balance_payments_request_history
  on public.funeral_balance_payments(request_id, submitted_at desc);
create unique index funeral_balance_payments_receipt_unique
  on public.funeral_balance_payments(receiver_account_id, reference_number)
  where reference_number is not null and status <> 'rejected';
create index funeral_balance_payments_submitted_by on public.funeral_balance_payments(submitted_by);
create index funeral_balance_payments_reviewed_by on public.funeral_balance_payments(reviewed_by);

alter table public.funeral_balance_payments enable row level security;
create policy "Balance participants can read settlements"
on public.funeral_balance_payments for select to authenticated
using (exists (
  select 1 from public.funeral_service_requests r where r.id = request_id
    and (r."requesterId" = (select auth.uid()) or r."shopId" = (select auth.uid()))
));
create policy "Customers can submit their balance payment"
on public.funeral_balance_payments for insert to authenticated
with check (submitted_by = (select auth.uid()) and exists (
  select 1 from public.funeral_service_requests r where r.id = request_id
    and r."requesterId" = (select auth.uid())
));
create policy "Assigned shops can review balance payments"
on public.funeral_balance_payments for update to authenticated
using (exists (
  select 1 from public.funeral_service_requests r where r.id = request_id
    and r."shopId" = (select auth.uid())
))
with check (exists (
  select 1 from public.funeral_service_requests r where r.id = request_id
    and r."shopId" = (select auth.uid())
));

create function public.guard_funeral_balance_payment()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  r public.funeral_service_requests%rowtype;
  receiver public.funeral_shop_payout_accounts%rowtype;
begin
  select * into r from public.funeral_service_requests where id = new.request_id for share;
  if not found or auth.uid() is null then
    raise exception 'Service request is unavailable.';
  end if;
  if r."paymentOption" is distinct from 'downpayment'
     or r."paymentVerifiedAt" is null
     or r.status not in ('payment_verified', 'awaiting_customer_confirmation', 'completed')
     or coalesce(r."remainingBalance", 0) <= 0 then
    raise exception 'A confirmed downpayment with an outstanding balance is required.';
  end if;
  if tg_op = 'INSERT' then
    if r."requesterId" is distinct from auth.uid() then
      raise exception 'Only the requesting customer can submit the remaining balance.';
    end if;
    new.amount := round(r."remainingBalance", 2);
    new.status := 'submitted';
    new.submitted_by := auth.uid();
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
      new.proof_image_url := null;
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
         or new.proof_image_url is null
         or new.proof_image_url !~ ('^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/avatars/service-media/' || auth.uid()::text || '/[A-Za-z0-9.-]+[.]jpg$') then
        raise exception 'Provide the sender name, transaction reference, and an uploaded receipt.';
      end if;
    else
      raise exception 'Choose cash, e-wallet, or bank transfer.';
    end if;
  else
    if r."shopId" is distinct from auth.uid() then
      raise exception 'Only the assigned shop can confirm receipt of the balance.';
    end if;
    if old.status <> 'submitted' or new.status not in ('verified', 'rejected') then
      raise exception 'Only payments awaiting review can be confirmed or rejected.';
    end if;
    -- Column grants also prevent clients changing the amount or receipt.
    if (to_jsonb(new) - array['status', 'rejection_reason', 'reviewed_by', 'reviewed_at'])
       is distinct from (to_jsonb(old) - array['status', 'rejection_reason', 'reviewed_by', 'reviewed_at']) then
      raise exception 'Submitted balance payment details cannot be edited.';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    new.rejection_reason := case when new.status = 'rejected' then nullif(trim(new.rejection_reason), '') else null end;
    if new.status = 'rejected' and coalesce(char_length(new.rejection_reason), 0) not between 3 and 500 then
      raise exception 'Explain why the balance payment was rejected (3-500 characters).';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_funeral_balance_payment before insert or update
on public.funeral_balance_payments for each row execute function public.guard_funeral_balance_payment();
revoke all on function public.guard_funeral_balance_payment() from public, anon, authenticated;

revoke all on public.funeral_balance_payments from public, anon, authenticated;
grant select on public.funeral_balance_payments to authenticated;
grant insert(request_id, method, receiver_account_id, payer_name, reference_number, proof_image_url)
  on public.funeral_balance_payments to authenticated;
grant update(status, rejection_reason) on public.funeral_balance_payments to authenticated;
comment on table public.funeral_balance_payments is
  'Direct remaining-balance settlements after a verified downpayment. Cash and receipt submissions are unpaid until the assigned shop verifies receipt. Original provider payment and payout records are unchanged.';
notify pgrst, 'reload schema';
commit;
