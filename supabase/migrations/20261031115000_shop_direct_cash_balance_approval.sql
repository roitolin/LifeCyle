-- Allow the assigned shop to directly record and approve a cash remaining-balance
-- settlement when the customer pays in cash at the shop without submitting first,
-- and allow same-account testing when requesterId = shopId.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "Assigned shops can record cash balance payments" on public.funeral_balance_payments;
create policy "Assigned shops can record cash balance payments"
on public.funeral_balance_payments for insert to authenticated
with check (
  method = 'cash'
  and exists (
    select 1 from public.funeral_service_requests r
    where r.id = request_id
      and r."shopId" = (select auth.uid())
  )
);

drop policy if exists "Assigned shops can review balance payments" on public.funeral_balance_payments;
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

create or replace function public.guard_funeral_balance_payment()
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
    if r."requesterId" is distinct from auth.uid() and r."shopId" is distinct from auth.uid() then
      raise exception 'Only the requesting customer or assigned shop can submit the remaining balance.';
    end if;
    if r."requesterId" is distinct from auth.uid() and new.method is distinct from 'cash' then
      raise exception 'Shops can only directly record cash balance payments.';
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
         or new.proof_image_path !~ ('^' || new.request_id::text || '/' || auth.uid()::text || '/[A-Za-z0-9.-]+[.]jpg$')
         or not exists (select 1 from storage.objects o
           where o.bucket_id = 'funeral-balance-receipts' and o.name = new.proof_image_path) then
        raise exception 'Provide the sender name, transaction reference, and a private uploaded receipt.';
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

revoke all on function public.guard_funeral_balance_payment() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
