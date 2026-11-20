-- Enable the existing authenticated feeds. Keep current row policies and replica identities.
do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is missing';
  end if;

  foreach target_table in array array[
    'conversations',
    'messages',
    'funeral_service_requests',
    'service_request_members',
    'funeral_balance_payments',
    'shop_payments',
    'shop_withdrawals'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_index i on i.indrelid = c.oid and i.indisprimary
      where n.nspname = 'public'
        and c.relname = target_table
        and c.relrowsecurity
    ) then
      raise exception 'Cannot enable Realtime: public.% requires row-level security and a primary key', target_table;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end $$;
