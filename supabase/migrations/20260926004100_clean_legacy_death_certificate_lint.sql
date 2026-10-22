-- Keep the former public-URL delivery endpoint disabled while retaining its
-- signature for older app versions. Referencing both arguments avoids leaving
-- misleading unused-parameter warnings in database lint output.

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
  raise exception 'Use the secure Death Certificate vault uploader.'
    using detail = format(
      'Legacy public-link delivery was blocked for document %s; the supplied URL was %s.',
      coalesce(p_document_id::text, 'unknown'),
      case
        when nullif(trim(p_file_url), '') is null then 'empty'
        else 'ignored'
      end
    );
end;
$$;

revoke all on function public.complete_death_certificate(uuid, text)
  from public, anon;
grant execute on function public.complete_death_certificate(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
