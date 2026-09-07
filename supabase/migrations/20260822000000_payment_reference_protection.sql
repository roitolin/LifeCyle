-- Prevent a payment receipt reference from being reused for multiple records.
-- Client validation improves the message; these constraints are the final
-- server-side protection against concurrent or modified-client submissions.

create or replace function public.normalize_payment_reference(value text)
returns text
language sql
immutable
returns null on null input
set search_path = public
as $$
  select upper(regexp_replace(trim(value), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.validate_service_payment_reference()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_reference text;
begin
  if new.status = 'payment_submitted' then
    normalized_reference := public.normalize_payment_reference(new."paymentReferenceNumber");
    if normalized_reference is null
       or char_length(normalized_reference) < 6
       or char_length(normalized_reference) > 32 then
      raise exception 'A valid 6-32 character payment reference is required.';
    end if;
    new."paymentReferenceNumber" := normalized_reference;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_service_payment_reference
  on public.funeral_service_requests;
create trigger validate_service_payment_reference
before insert or update of status, "paymentReferenceNumber"
on public.funeral_service_requests
for each row execute function public.validate_service_payment_reference();

create unique index if not exists funeral_service_requests_payment_reference_unique
  on public.funeral_service_requests (
    public.normalize_payment_reference("paymentReferenceNumber")
  )
  where nullif(trim("paymentReferenceNumber"), '') is not null;

create or replace function public.validate_shop_payment_reference()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  normalized_reference text;
begin
  normalized_reference := public.normalize_payment_reference(new."referenceNumber");
  if normalized_reference is null
     or char_length(normalized_reference) < 6
     or char_length(normalized_reference) > 32 then
    raise exception 'A valid 6-32 character payment reference is required.';
  end if;
  new."referenceNumber" := normalized_reference;
  return new;
end;
$$;

drop trigger if exists validate_shop_payment_reference on public.shop_payments;
create trigger validate_shop_payment_reference
before insert or update of "referenceNumber"
on public.shop_payments
for each row execute function public.validate_shop_payment_reference();

create unique index if not exists shop_payments_payment_reference_unique
  on public.shop_payments (
    public.normalize_payment_reference("referenceNumber")
  )
  where nullif(trim("referenceNumber"), '') is not null
    and status in ('pending', 'verified');

notify pgrst, 'reload schema';
