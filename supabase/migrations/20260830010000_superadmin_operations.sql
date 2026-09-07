-- Root-admin operations release: durable announcements and transactional delivery.
-- Command-center, deletion, and finance queues reuse the existing operational tables.

begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  audience text not null default 'all'
    check (audience in ('all', 'users', 'funeral_shops')),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  "isPinned" boolean not null default false,
  "recipientCount" integer not null default 0 check ("recipientCount" >= 0),
  "createdBy" uuid not null references public.users(id) on delete restrict,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists announcements_status_created_idx
  on public.announcements (status, "createdAt" desc);
create index if not exists announcements_active_pinned_idx
  on public.announcements ("isPinned" desc, "createdAt" desc)
  where status = 'active';

alter table public.announcements enable row level security;

drop policy if exists "Authenticated users can read active announcements"
  on public.announcements;
create policy "Authenticated users can read active announcements"
  on public.announcements for select to authenticated
  using (status = 'active');

drop policy if exists "Root admins can read all announcements"
  on public.announcements;
create policy "Root admins can read all announcements"
  on public.announcements for select to authenticated
  using (public.current_user_can_manage_users());

drop policy if exists "Root admins can create announcements"
  on public.announcements;
create policy "Root admins can create announcements"
  on public.announcements for insert to authenticated
  with check (
    public.current_user_can_manage_users()
    and "createdBy" = (select auth.uid())
  );

drop policy if exists "Root admins can update announcements"
  on public.announcements;
create policy "Root admins can update announcements"
  on public.announcements for update to authenticated
  using (public.current_user_can_manage_users())
  with check (public.current_user_can_manage_users());

revoke all on public.announcements from anon;
grant select, insert, update on public.announcements to authenticated;

create or replace function public.publish_announcement(
  p_title text,
  p_body text,
  p_audience text default 'all',
  p_is_pinned boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  announcement_id uuid;
  recipient_count integer := 0;
  clean_title text := trim(coalesce(p_title, ''));
  clean_body text := trim(coalesce(p_body, ''));
  clean_audience text := lower(trim(coalesce(p_audience, 'all')));
begin
  if actor_id is null or not public.current_user_can_manage_users() then
    raise exception 'Root administrator access is required.' using errcode = '42501';
  end if;
  if char_length(clean_title) < 1 or char_length(clean_title) > 120 then
    raise exception 'Announcement title must be between 1 and 120 characters.';
  end if;
  if char_length(clean_body) < 1 or char_length(clean_body) > 2000 then
    raise exception 'Announcement message must be between 1 and 2000 characters.';
  end if;
  if clean_audience not in ('all', 'users', 'funeral_shops') then
    raise exception 'Unsupported announcement audience.';
  end if;

  insert into public.announcements (
    title, body, audience, status, "isPinned", "createdBy"
  ) values (
    clean_title, clean_body, clean_audience, 'active', coalesce(p_is_pinned, false), actor_id
  )
  returning id into announcement_id;

  insert into public.notifications ("userId", type, title, body, data, read)
  select
    recipient.id,
    'announcement_new',
    'Announcement: ' || clean_title,
    clean_body,
    jsonb_build_object(
      'announcementId', announcement_id,
      'audience', clean_audience
    ),
    false
  from public.users recipient
  where recipient.role not in ('admin', 'super_admin')
    and case clean_audience
      when 'users' then recipient.role = 'user'
      when 'funeral_shops' then recipient.role = 'funeral_admin'
      else true
    end;

  get diagnostics recipient_count = row_count;

  update public.announcements
  set "recipientCount" = recipient_count,
      "updatedAt" = now()
  where id = announcement_id;

  insert into public.admin_audit_logs (
    "adminId", action, "targetType", "targetId", summary, metadata
  ) values (
    actor_id,
    'announcement_published',
    'announcement',
    announcement_id::text,
    'Published announcement "' || clean_title || '".',
    jsonb_build_object(
      'source', 'database_rpc',
      'audience', clean_audience,
      'recipientCount', recipient_count,
      'isPinned', coalesce(p_is_pinned, false)
    )
  );

  return jsonb_build_object(
    'id', announcement_id,
    'recipientCount', recipient_count
  );
end;
$function$;

revoke all on function public.publish_announcement(text, text, text, boolean)
  from public, anon;
grant execute on function public.publish_announcement(text, text, text, boolean)
  to authenticated;

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end;
$realtime$;

notify pgrst, 'reload schema';

commit;
