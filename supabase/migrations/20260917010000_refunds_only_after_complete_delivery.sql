begin;

-- ==============================================================================
-- Migration: 20260917010000_refunds_only_after_complete_delivery.sql
-- Description: Enforce that refunds can only be requested, approved, or issued
-- after complete delivery of the service/casket (i.e. status = 'completed' or
-- shop has marked delivered with completion proof).
-- ==============================================================================

create or replace function public.guard_service_refund_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  actor_is_service_role boolean := false;
  service_row public.funeral_service_requests%rowtype;
  normalized_reference text;
  is_delivered boolean := false;
begin
  if current_user in ('postgres', 'supabase_admin')
     or coalesce(auth.role(), '') = 'service_role' then
    actor_is_service_role := true;
    actor_is_admin := true;
  else
    select exists (
      select 1 from public.users
      where id = actor_id
        and role in ('admin', 'super_admin', 'funeral_admin')
    ) into actor_is_admin;
  end if;

  if tg_op = 'INSERT' then
    select * into service_row
    from public.funeral_service_requests
    where id = new.service_request_id;

    if not found then
      raise exception 'Service request not found.';
    end if;

    if not actor_is_service_role and actor_id is distinct from service_row."requesterId" and not actor_is_admin then
      raise exception 'Only the requester can ask for a refund.';
    end if;

    -- Complete delivery check:
    -- The service must either be confirmed completed, or marked delivered by the shop with completion proof
    is_delivered := (service_row.status = 'completed')
      or (service_row.status = 'awaiting_customer_confirmation' and service_row."shopMarkedCompletedAt" is not null);

    if not is_delivered then
      raise exception 'Refunds can only be requested after complete delivery of the service.';
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

  -- Load the service request to verify delivery status during updates
  select * into service_row
  from public.funeral_service_requests
  where id = old.service_request_id;

  is_delivered := (service_row.status = 'completed')
    or (service_row.status = 'awaiting_customer_confirmation' and service_row."shopMarkedCompletedAt" is not null);

  if actor_id = old.requester_id and not actor_is_admin and not actor_is_service_role then
    if old.status <> 'pending' or new.status <> 'cancelled' then
      raise exception 'A requester may only cancel a pending refund request.';
    end if;
    new.response_note := null;
    new.refund_reference_number := null;
  elsif actor_id = old.shop_id or actor_is_admin or actor_is_service_role then
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      if new.status = 'approved' and not is_delivered then
        raise exception 'Refunds can only be approved after complete delivery of the service.';
      end if;
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
      if not is_delivered then
        raise exception 'Refunds can only be issued after complete delivery of the service.';
      end if;
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
    when new.status in ('rejected', 'refunded') then coalesce(actor_id, old.resolved_by)
    when new.status = 'cancelled' then coalesce(actor_id, old.requester_id)
    else null
  end;

  return new;
end;
$$;

commit;
