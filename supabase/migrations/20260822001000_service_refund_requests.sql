-- Track paid-order refund requests separately from the fulfilment status.
-- This preserves the original payment audit trail while giving both parties
-- an explicit request, decision, and refund-reference record.

create table if not exists public.service_refund_requests (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  requester_id uuid not null references public.users(id) on delete cascade,
  shop_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'refunded', 'cancelled')),
  reason text not null,
  response_note text,
  refund_reference_number text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null
);

create unique index if not exists service_refund_requests_one_active
  on public.service_refund_requests (service_request_id)
  where status in ('pending', 'approved');

create unique index if not exists service_refund_reference_unique
  on public.service_refund_requests (
    public.normalize_payment_reference(refund_reference_number)
  )
  where nullif(trim(refund_reference_number), '') is not null;

create index if not exists service_refund_requests_requester_created
  on public.service_refund_requests (requester_id, requested_at desc);
create index if not exists service_refund_requests_shop_created
  on public.service_refund_requests (shop_id, requested_at desc);

alter table public.service_refund_requests enable row level security;

drop policy if exists "Refund participants can read requests"
  on public.service_refund_requests;
create policy "Refund participants can read requests"
  on public.service_refund_requests for select to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Requesters can create refund requests"
  on public.service_refund_requests;
create policy "Requesters can create refund requests"
  on public.service_refund_requests for insert to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists "Refund participants can update requests"
  on public.service_refund_requests;
create policy "Refund participants can update requests"
  on public.service_refund_requests for update to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  )
  with check (
    auth.uid() = requester_id
    or auth.uid() = shop_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create or replace function public.guard_service_refund_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  service_row public.funeral_service_requests%rowtype;
  normalized_reference text;
begin
  select exists (
    select 1 from public.users
    where id = actor_id
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  if tg_op = 'INSERT' then
    select * into service_row
    from public.funeral_service_requests
    where id = new.service_request_id;

    if not found then
      raise exception 'Service request not found.';
    end if;
    if actor_id is distinct from service_row."requesterId" then
      raise exception 'Only the requester can ask for a refund.';
    end if;
    if service_row.status not in (
      'payment_submitted',
      'payment_verified',
      'awaiting_customer_confirmation',
      'completed'
    ) then
      raise exception 'A refund can be requested only after payment was submitted.';
    end if;
    if nullif(trim(new.reason), '') is null or char_length(trim(new.reason)) < 10 then
      raise exception 'Explain the refund request in at least 10 characters.';
    end if;

    new.requester_id := service_row."requesterId";
    new.shop_id := service_row."shopId";
    new.status := 'pending';
    new.reason := trim(new.reason);
    new.response_note := null;
    new.refund_reference_number := null;
    new.requested_at := now();
    new.updated_at := now();
    new.resolved_at := null;
    new.resolved_by := null;
    return new;
  end if;

  if new.service_request_id is distinct from old.service_request_id
     or new.requester_id is distinct from old.requester_id
     or new.shop_id is distinct from old.shop_id
     or new.reason is distinct from old.reason
     or new.requested_at is distinct from old.requested_at then
    raise exception 'Refund request identity and reason cannot be changed.';
  end if;

  if actor_id = old.requester_id and not actor_is_admin then
    if old.status <> 'pending' or new.status <> 'cancelled' then
      raise exception 'A requester may only cancel a pending refund request.';
    end if;
    new.response_note := null;
    new.refund_reference_number := null;
  elsif actor_id = old.shop_id or actor_is_admin then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      if new.status = 'rejected' and nullif(trim(new.response_note), '') is null then
        raise exception 'Explain why the refund request was rejected.';
      end if;
      if new.status = 'approved' then
        new.response_note := nullif(trim(new.response_note), '');
      else
        new.response_note := trim(new.response_note);
      end if;
      new.refund_reference_number := null;
    elsif old.status = 'approved' and new.status = 'refunded' then
      normalized_reference := public.normalize_payment_reference(new.refund_reference_number);
      if normalized_reference is null
         or char_length(normalized_reference) < 6
         or char_length(normalized_reference) > 32 then
        raise exception 'A valid refund transaction reference is required.';
      end if;
      new.refund_reference_number := normalized_reference;
    else
      raise exception 'Invalid refund transition: % -> %', old.status, new.status;
    end if;
  else
    raise exception 'You cannot update this refund request.';
  end if;

  new.updated_at := now();
  new.resolved_at := case
    when new.status in ('rejected', 'refunded', 'cancelled') then now()
    else null
  end;
  new.resolved_by := case
    when new.status = 'cancelled' then old.requester_id
    else actor_id
  end;
  return new;
end;
$$;

drop trigger if exists guard_service_refund_request
  on public.service_refund_requests;
create trigger guard_service_refund_request
before insert or update on public.service_refund_requests
for each row execute function public.guard_service_refund_request();

create or replace function public.notify_service_refund_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      new.shop_id,
      'funeral_refund_requested',
      'Refund Requested',
      'A family requested a refund for a service payment.',
      jsonb_build_object(
        'requestId', new.service_request_id,
        'refundRequestId', new.id,
        'requesterId', new.requester_id
      ),
      false
    );
  elsif new.status is distinct from old.status then
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      new.requester_id,
      'funeral_refund_updated',
      case new.status
        when 'approved' then 'Refund Approved'
        when 'rejected' then 'Refund Request Rejected'
        when 'refunded' then 'Refund Sent'
        else 'Refund Request Updated'
      end,
      case new.status
        when 'approved' then 'The shop approved your refund request and will record the refund after sending it.'
        when 'rejected' then 'The shop could not approve your refund request. Open the request to review the response.'
        when 'refunded' then 'The shop marked your refund as sent. Open the request to view the reference.'
        else 'Your refund request status changed.'
      end,
      jsonb_build_object(
        'requestId', new.service_request_id,
        'refundRequestId', new.id,
        'shopId', new.shop_id
      ),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_service_refund_change
  on public.service_refund_requests;
create trigger notify_service_refund_change
after insert or update of status on public.service_refund_requests
for each row execute function public.notify_service_refund_change();

notify pgrst, 'reload schema';
