-- Customer-requested Death Certificate workflow. Historical Arrangement Hub
-- records are deliberately preserved, but the new app no longer exposes them.

create table if not exists public.death_certificate_requests (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null unique
    references public.funeral_service_requests(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'ready')),
  file_url text,
  requested_by uuid not null references public.users(id),
  requested_at timestamptz not null default now(),
  processed_by uuid references public.users(id),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists death_certificate_requests_status_updated
  on public.death_certificate_requests (status, updated_at desc);

alter table public.death_certificate_requests enable row level security;

drop policy if exists "Customer and shop can view Death Certificate requests"
  on public.death_certificate_requests;
create policy "Customer and shop can view Death Certificate requests"
  on public.death_certificate_requests for select to authenticated
  using (public.is_service_request_primary_participant(service_request_id));

-- Inserts and updates are intentionally performed only by the guarded RPCs
-- below. There are no direct client write policies on this table.

create or replace function public.request_death_certificate(p_request_id uuid)
returns public.death_certificate_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.funeral_service_requests%rowtype;
  certificate_row public.death_certificate_requests%rowtype;
begin
  select * into request_row
  from public.funeral_service_requests
  where id = p_request_id;

  if not found then
    raise exception 'Service request not found.';
  end if;
  if request_row."requesterId" <> auth.uid() then
    raise exception 'Only the customer who owns this service request can request the Death Certificate.';
  end if;

  insert into public.death_certificate_requests (
    service_request_id, requested_by
  ) values (
    p_request_id, auth.uid()
  )
  on conflict (service_request_id) do update
    set updated_at = public.death_certificate_requests.updated_at
  returning * into certificate_row;

  insert into public.notifications (
    "userId", type, title, body, data, read, dedupe_key
  ) values (
    request_row."shopId",
    'death_certificate_requested',
    'Death Certificate Requested',
    'A customer requested a Death Certificate for a funeral service request.',
    jsonb_build_object('requestId', p_request_id),
    false,
    'death-certificate:' || certificate_row.id::text || ':requested'
  )
  on conflict ("userId", dedupe_key) do nothing;

  return certificate_row;
end;
$$;

create or replace function public.start_death_certificate_processing(p_document_id uuid)
returns public.death_certificate_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  certificate_row public.death_certificate_requests%rowtype;
begin
  select * into certificate_row
  from public.death_certificate_requests
  where id = p_document_id;

  if not found then
    raise exception 'Death Certificate request not found.';
  end if;
  if not exists (
    select 1 from public.funeral_service_requests request
    where request.id = certificate_row.service_request_id
      and request."shopId" = auth.uid()
  ) then
    raise exception 'Only the assigned funeral shop can process the Death Certificate.';
  end if;

  update public.death_certificate_requests
  set status = 'processing',
      processed_by = auth.uid(),
      updated_at = now()
  where id = p_document_id
    and status = 'requested'
  returning * into certificate_row;

  return certificate_row;
end;
$$;

create or replace function public.complete_death_certificate(
  p_document_id uuid,
  p_file_url text
)
returns public.death_certificate_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  certificate_row public.death_certificate_requests%rowtype;
  requester_id uuid;
begin
  if nullif(trim(p_file_url), '') is null
     or trim(p_file_url) !~* '^https?://' then
    raise exception 'Upload a valid Death Certificate file.';
  end if;

  select * into certificate_row
  from public.death_certificate_requests
  where id = p_document_id;

  if not found then
    raise exception 'Death Certificate request not found.';
  end if;
  if not exists (
    select 1 from public.funeral_service_requests request
    where request.id = certificate_row.service_request_id
      and request."shopId" = auth.uid()
  ) then
    raise exception 'Only the assigned funeral shop can send the Death Certificate.';
  end if;

  update public.death_certificate_requests
  set status = 'ready',
      file_url = trim(p_file_url),
      processed_by = auth.uid(),
      completed_at = now(),
      updated_at = now()
  where id = p_document_id
  returning * into certificate_row;

  select "requesterId" into requester_id
  from public.funeral_service_requests
  where id = certificate_row.service_request_id;

  insert into public.notifications (
    "userId", type, title, body, data, read, dedupe_key
  ) values (
    requester_id,
    'death_certificate_ready',
    'Death Certificate Ready',
    'The funeral shop sent your Death Certificate. Open the service request to view it.',
    jsonb_build_object('requestId', certificate_row.service_request_id),
    false,
    'death-certificate:' || certificate_row.id::text || ':ready'
  )
  on conflict ("userId", dedupe_key) do nothing;

  return certificate_row;
end;
$$;

revoke all on function public.request_death_certificate(uuid) from public;
revoke all on function public.start_death_certificate_processing(uuid) from public;
revoke all on function public.complete_death_certificate(uuid, text) from public;
grant execute on function public.request_death_certificate(uuid) to authenticated;
grant execute on function public.start_death_certificate_processing(uuid) to authenticated;
grant execute on function public.complete_death_certificate(uuid, text) to authenticated;
