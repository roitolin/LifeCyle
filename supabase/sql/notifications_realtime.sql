-- Notifications realtime: adds the `notifications` table to Supabase's
-- `supabase_realtime` publication so the mobile unread badge (useUnreadCount)
-- and admin notification counts update live via postgres_changes.
-- Run this once in the Supabase SQL Editor.

begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

commit;
