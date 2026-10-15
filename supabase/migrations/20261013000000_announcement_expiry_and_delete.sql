-- Add administrator-controlled expiry and deletion for announcements.
begin;

alter table public.announcements
  add column if not exists "expiresAt" timestamptz;

create index if not exists announcements_active_expiry_idx
  on public.announcements ("expiresAt", "createdAt" desc)
  where status = 'active';

drop policy if exists "Authenticated users can read active announcements"
  on public.announcements;
create policy "Authenticated users can read active announcements"
  on public.announcements for select to authenticated
  using (status = 'active' and ("expiresAt" is null or "expiresAt" > now()));

drop policy if exists "Root admins can delete announcements"
  on public.announcements;
drop policy if exists "Admins can delete announcements"
  on public.announcements;
create policy "Admins can delete announcements"
  on public.announcements for delete to authenticated
  using (public.current_user_can_manage_users());

grant delete on public.announcements to authenticated;

drop function if exists public.publish_announcement(text, text, text, boolean);

create or replace function public.publish_announcement(
  p_title text,
  p_body text,
  p_audience text default 'all',
  p_is_pinned boolean default false,
  p_expires_at timestamptz default null
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
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Announcement expiry must be in the future.';
  end if;
  if p_expires_at is not null and p_expires_at > now() + interval '365 days' then
    raise exception 'Announcement duration cannot exceed 365 days.';
  end if;

  insert into public.announcements (
    title, body, audience, status, "isPinned", "createdBy", "expiresAt"
  ) values (
    clean_title, clean_body, clean_audience, 'active', coalesce(p_is_pinned, false), actor_id, p_expires_at
  )
  returning id into announcement_id;

  insert into public.notifications ("userId", type, title, body, data, read)
  select
    recipient.id,
    'announcement_new',
    'Announcement: ' || clean_title,
    clean_body,
    jsonb_build_object('announcementId', announcement_id, 'audience', clean_audience, 'expiresAt', p_expires_at),
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
  set "recipientCount" = recipient_count, "updatedAt" = now()
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
      'isPinned', coalesce(p_is_pinned, false),
      'expiresAt', p_expires_at
    )
  );

  return jsonb_build_object('id', announcement_id, 'recipientCount', recipient_count, 'expiresAt', p_expires_at);
end;
$function$;

revoke all on function public.publish_announcement(text, text, text, boolean, timestamptz)
  from public, anon;
grant execute on function public.publish_announcement(text, text, text, boolean, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';

commit;
