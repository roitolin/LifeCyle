-- LifeCycle - FIX NOTIFICATIONS ROW LEVEL SECURITY
-- Run this once in the Supabase SQL editor.
--
-- The master schema previously created a single policy:
--   for all to authenticated using ("userId" = auth.uid())
-- which ALSO applies its "using" clause as the INSERT check, so a shop
-- could not insert a notification addressed to a customer (and vice versa).
-- Those inserts failed silently -> nothing appeared on the notification
-- screen and the unread badge stayed at 0.
--
-- Replace it with the intended policies:
--   - any authenticated user may CREATE notifications (for anyone)
--   - users may read/update/delete only their own notifications

begin;

drop policy if exists "Users can manage their notifications" on public.notifications;
drop policy if exists "Users can read their notifications" on public.notifications;
drop policy if exists "Users can update their notifications" on public.notifications;
drop policy if exists "Users can delete their notifications" on public.notifications;
drop policy if exists "Authenticated users can create notifications" on public.notifications;

create policy "Users can read their notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = "userId");

create policy "Users can update their notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = "userId")
with check (auth.uid() = "userId");

create policy "Users can delete their notifications"
on public.notifications
for delete
to authenticated
using (auth.uid() = "userId");

create policy "Authenticated users can create notifications"
on public.notifications
for insert
to authenticated
with check (true);

commit;
