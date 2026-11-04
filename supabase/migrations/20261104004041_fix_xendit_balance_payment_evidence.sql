begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Manual transfers still need a private receipt. Provider-created Xendit
-- checkouts are authenticated by their server-only reference/claim fields and
-- must not be forced to fabricate a sender name or receipt path.
alter table public.funeral_balance_payments
  drop constraint if exists balance_payment_evidence;

alter table public.funeral_balance_payments
  add constraint balance_payment_evidence check (
    (method = 'cash'
      and receiver_account_id is null
      and provider_reference_id is null)
    or
    (method in ('wallet', 'bank')
      and receiver_account_id is not null
      and char_length(reference_number) between 6 and 100
      and (
        (
          provider_reference_id is null
          and char_length(payer_name) between 2 and 120
          and proof_image_path is not null
        )
        or
        (
          provider_reference_id is not null
          and payer_name is null
          and proof_image_path is null
          and provider_status in ('creating', 'active', 'completed', 'expired')
          and char_length(provider_payment_method) between 2 and 100
          and provider_livemode = false
          and checkout_claim_id is not null
        )
      ))
  ) not valid;

alter table public.funeral_balance_payments
  validate constraint balance_payment_evidence;

-- A provider is the reviewer for Xendit rows, so there is intentionally no
-- application user in reviewed_by. Manual cash/receipt reviews keep the
-- original assigned-shop requirement.
alter table public.funeral_balance_payments
  drop constraint if exists balance_payment_review;

alter table public.funeral_balance_payments
  add constraint balance_payment_review check (
    (status = 'submitted'
      and reviewed_by is null
      and reviewed_at is null
      and rejection_reason is null)
    or
    (provider_reference_id is null and (
      (status = 'verified'
        and reviewed_by is not null
        and reviewed_at is not null
        and rejection_reason is null)
      or
      (status = 'rejected'
        and reviewed_by is not null
        and reviewed_at is not null
        and char_length(rejection_reason) between 3 and 500)
    ))
    or
    (provider_reference_id is not null and (
      (status = 'verified'
        and provider_status = 'completed'
        and reviewed_by is null
        and reviewed_at is not null
        and rejection_reason is null)
      or
      (status = 'rejected'
        and provider_status = 'expired'
        and reviewed_by is null
        and reviewed_at is not null
        and char_length(rejection_reason) between 3 and 500)
    ))
  ) not valid;

alter table public.funeral_balance_payments
  validate constraint balance_payment_review;

comment on constraint balance_payment_evidence on public.funeral_balance_payments is
  'Manual transfers require private receipt evidence; server-created Xendit rows require provider identity and claim fields.';

comment on constraint balance_payment_review on public.funeral_balance_payments is
  'Manual settlements are reviewed by the assigned shop; Xendit settlements are reviewed by the verified provider flow.';

notify pgrst, 'reload schema';
commit;
