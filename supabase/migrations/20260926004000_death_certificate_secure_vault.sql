-- Private Death Certificate vault. This intentionally supports one document
-- type only; additional checklist items can be added later without exposing
-- certificate files through a public bucket.

alter table public.death_certificate_requests
  add column if not exists storage_path text,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint;

alter table public.death_certificate_requests
  drop constraint if exists death_certificate_file_size_check;
alter table public.death_certificate_requests
  add constraint death_certificate_file_size_check
  check (file_size_bytes is null or file_size_bytes between 1 and 10485760);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'death-certificates',
  'death-certificates',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Participants can read private Death Certificates"
  on storage.objects;
create policy "Participants can read private Death Certificates"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'death-certificates'
    and exists (
      select 1
      from public.death_certificate_requests as document
      join public.funeral_service_requests as request
        on request.id = document.service_request_id
      where document.id::text = (storage.foldername(storage.objects.name))[1]
        and auth.uid() in (request."requesterId", request."shopId")
    )
  );

drop policy if exists "Assigned shop can upload private Death Certificates"
  on storage.objects;
create policy "Assigned shop can upload private Death Certificates"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'death-certificates'
    and exists (
      select 1
      from public.death_certificate_requests as document
      join public.funeral_service_requests as request
        on request.id = document.service_request_id
      where document.id::text = (storage.foldername(storage.objects.name))[1]
        and request."shopId" = auth.uid()
    )
  );

drop policy if exists "Assigned shop can update private Death Certificates"
  on storage.objects;
create policy "Assigned shop can update private Death Certificates"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'death-certificates'
    and exists (
      select 1
      from public.death_certificate_requests as document
      join public.funeral_service_requests as request
        on request.id = document.service_request_id
      where document.id::text = (storage.foldername(storage.objects.name))[1]
        and request."shopId" = auth.uid()
    )
  )
  with check (
    bucket_id = 'death-certificates'
    and exists (
      select 1
      from public.death_certificate_requests as document
      join public.funeral_service_requests as request
        on request.id = document.service_request_id
      where document.id::text = (storage.foldername(storage.objects.name))[1]
        and request."shopId" = auth.uid()
    )
  );

drop policy if exists "Assigned shop can delete private Death Certificates"
  on storage.objects;
create policy "Assigned shop can delete private Death Certificates"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'death-certificates'
    and exists (
      select 1
      from public.death_certificate_requests as document
      join public.funeral_service_requests as request
        on request.id = document.service_request_id
      where document.id::text = (storage.foldername(storage.objects.name))[1]
        and request."shopId" = auth.uid()
    )
  );

create or replace function public.complete_death_certificate_secure(
  p_document_id uuid,
  p_storage_path text,
  p_original_file_name text default null,
  p_mime_type text default null,
  p_file_size_bytes bigint default null
)
returns public.death_certificate_requests
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  certificate_row public.death_certificate_requests%rowtype;
  requester_id uuid;
  stored_mime_type text;
  stored_file_size bigint;
begin
  select * into certificate_row
  from public.death_certificate_requests
  where id = p_document_id
  for update;

  if not found then
    raise exception 'Death Certificate request not found.';
  end if;
  if not exists (
    select 1
    from public.funeral_service_requests as request
    where request.id = certificate_row.service_request_id
      and request."shopId" = auth.uid()
  ) then
    raise exception 'Only the assigned funeral shop can send the Death Certificate.';
  end if;
  if nullif(trim(p_storage_path), '') is null
     or split_part(trim(p_storage_path), '/', 1) <> p_document_id::text then
    raise exception 'The Death Certificate vault path is invalid.';
  end if;

  select
    coalesce(nullif(object.metadata ->> 'mimetype', ''), nullif(lower(trim(p_mime_type)), '')),
    case
      when object.metadata ->> 'size' ~ '^[0-9]+$'
        then (object.metadata ->> 'size')::bigint
      else p_file_size_bytes
    end
    into stored_mime_type, stored_file_size
  from storage.objects as object
  where object.bucket_id = 'death-certificates'
    and object.name = trim(p_storage_path);

  if not found then
    raise exception 'Upload the Death Certificate to the secure vault first.';
  end if;
  if stored_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'The Death Certificate must be a JPEG, PNG, WebP, or PDF file.';
  end if;
  if stored_file_size is null or stored_file_size < 1 or stored_file_size > 10485760 then
    raise exception 'The Death Certificate file must be 10 MB or smaller.';
  end if;

  update public.death_certificate_requests
  set status = 'ready',
      file_url = null,
      storage_path = trim(p_storage_path),
      original_file_name = left(coalesce(nullif(trim(p_original_file_name), ''), 'Death Certificate'), 180),
      mime_type = stored_mime_type,
      file_size_bytes = stored_file_size,
      processed_by = auth.uid(),
      completed_at = now(),
      updated_at = now()
  where id = p_document_id
  returning * into certificate_row;

  select request."requesterId" into requester_id
  from public.funeral_service_requests as request
  where request.id = certificate_row.service_request_id;

  insert into public.notifications (
    "userId", type, title, body, data, read, dedupe_key
  ) values (
    requester_id,
    'death_certificate_ready',
    'Death Certificate Ready',
    'Your Death Certificate is ready in your private document vault.',
    jsonb_build_object('requestId', certificate_row.service_request_id),
    false,
    'death-certificate:' || certificate_row.id::text || ':ready'
  )
  on conflict ("userId", dedupe_key) do update
    set title = excluded.title,
        body = excluded.body,
        data = excluded.data,
        read = false,
        "createdAt" = now();

  return certificate_row;
end;
$$;

-- Prevent new public-link certificate deliveries. Historical file_url values
-- remain readable for customers who received a certificate before this change.
create or replace function public.complete_death_certificate(
  p_document_id uuid,
  p_file_url text
)
returns public.death_certificate_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Use the secure Death Certificate vault uploader.';
end;
$$;

revoke all on function public.complete_death_certificate_secure(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function public.complete_death_certificate_secure(uuid, text, text, text, bigint)
  to authenticated;

comment on column public.death_certificate_requests.storage_path is
  'Private object path in the death-certificates Storage bucket.';
comment on function public.complete_death_certificate_secure(uuid, text, text, text, bigint) is
  'Marks a Death Certificate ready only after the assigned shop uploads it to the private vault.';

notify pgrst, 'reload schema';
