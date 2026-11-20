create schema if not exists feedback_private;
revoke all on schema feedback_private from public, anon, authenticated;

-- Feed reads omit author emails, private author IDs, and reaction account IDs.
create or replace function feedback_private.get_app_feedback_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
  caller_disabled boolean;
  board jsonb;
begin
  if caller is null then
    raise exception 'Sign in to view feedback.' using errcode = '42501';
  end if;

  select role, disabled into caller_role, caller_disabled from public.users where id = caller;

  with latest_ratings as (
    select distinct on (r."userId") r.*
    from public.app_ratings r
    order by r."userId", r."updatedAt" desc, r."createdAt" desc, r.id desc
  ),
  recent_posts as (
    select f.* from public.app_feedback f
    order by f."createdAt" desc, f.id desc
    limit 1000
  )
  select jsonb_build_object(
    'canModerate', coalesce(caller_role in ('admin', 'super_admin'), false) and not coalesce(caller_disabled, false),
    'canRate', caller_role is distinct from 'super_admin',
    'myRating', coalesce((select jsonb_build_object('rating', r.rating, 'isAnonymous', r."isAnonymous") from latest_ratings r where r."userId" = caller), 'null'::jsonb),
    'ratings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'displayName', case when not r."isAnonymous" then u."fullName" end,
        'isAnonymous', r."isAnonymous", 'rating', r.rating,
        'createdAt', r."createdAt", 'updatedAt', r."updatedAt"
      ) order by r."updatedAt" desc, r.id desc)
      from latest_ratings r left join public.users u on u.id = r."userId"
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'mine', f."userId" = caller,
        'displayName', case when not f."isAnonymous" then u."fullName" end,
        'isAnonymous', f."isAnonymous", 'feedback', f.feedback,
        'createdAt', f."createdAt", 'updatedAt', f."updatedAt",
        'publicRating', case when not f."isAnonymous" and not r."isAnonymous" then r.rating end,
        'liked', f.reactions ->> caller::text = 'like',
        'reactionCount', (select count(*) from jsonb_each_text(case when jsonb_typeof(f.reactions) = 'object' then f.reactions else '{}'::jsonb end) kv where kv.value = 'like'),
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'mine', a."userId" = caller,
            'displayName', case when not a."isAnonymous" then au."fullName" end,
            'staff', not a."isAnonymous" and au.role in ('admin', 'super_admin'),
            'isAnonymous', a."isAnonymous", 'text', a.text,
            'createdAt', a."createdAt", 'updatedAt', a."updatedAt",
            'liked', a.reactions ->> caller::text = 'like',
            'reactionCount', (select count(*) from jsonb_each_text(case when jsonb_typeof(a.reactions) = 'object' then a.reactions else '{}'::jsonb end) kv where kv.value = 'like')
          ) order by a."createdAt", a.id)
          from public.app_feedback_replies a left join public.users au on au.id = a."userId"
          where a."feedbackId" = f.id
        ), '[]'::jsonb)
      ) order by f."createdAt" desc, f.id desc)
      from recent_posts f
      left join public.users u on u.id = f."userId"
      left join latest_ratings r on r."userId" = f."userId"
    ), '[]'::jsonb)
  ) into board;
  return board;
end;
$$;

-- Serialize rating writes for one account and keep every historic row until its owner removes the rating.
create or replace function feedback_private.save_app_feedback_rating(p_rating integer, p_anonymous boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  rating_id uuid;
begin
  if caller is null or exists (select 1 from public.users where id = caller and role = 'super_admin') then
    raise exception 'This account cannot submit a rating.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 0 and 5 then
    raise exception 'Choose a rating from 1 to 5.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 103647));
  if p_rating = 0 then
    delete from public.app_ratings where "userId" = caller;
    return;
  end if;

  select id into rating_id from public.app_ratings where "userId" = caller
  order by "updatedAt" desc, "createdAt" desc, id desc limit 1;

  if rating_id is null then
    insert into public.app_ratings ("userId", rating, "isAnonymous") values (caller, p_rating, coalesce(p_anonymous, false));
  else
    update public.app_ratings set rating = p_rating, "isAnonymous" = coalesce(p_anonymous, false), "updatedAt" = now()
    where id = rating_id;
  end if;
end;
$$;

-- One idempotent write for the caller's own reaction. No client receives the reaction map.
create or replace function feedback_private.set_app_feedback_reaction(p_kind text, p_id uuid, p_liked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to react.' using errcode = '42501';
  end if;
  if p_id is null or p_liked is null then
    raise exception 'Choose a feedback entry to react to.' using errcode = '22023';
  end if;

  if p_kind = 'post' then
    update public.app_feedback
    set reactions = case when jsonb_typeof(reactions) = 'object' then reactions else '{}'::jsonb end
      - caller::text || case when p_liked then jsonb_build_object(caller::text, 'like') else '{}'::jsonb end
    where id = p_id;
  elsif p_kind = 'reply' then
    update public.app_feedback_replies
    set reactions = case when jsonb_typeof(reactions) = 'object' then reactions else '{}'::jsonb end
      - caller::text || case when p_liked then jsonb_build_object(caller::text, 'like') else '{}'::jsonb end
    where id = p_id;
  else
    raise exception 'Unsupported feedback entry.' using errcode = '22023';
  end if;
  if not found then
    raise exception 'This feedback entry is no longer available.' using errcode = 'P0002';
  end if;
end;
$$;

-- Expose invoker wrappers. The parsed SQL bodies reference the private functions
-- without granting callers usage of the implementation schema.
create or replace function public.get_app_feedback_board()
returns jsonb
language sql
stable
security invoker
set search_path = ''
return feedback_private.get_app_feedback_board();

create or replace function public.save_app_feedback_rating(p_rating integer, p_anonymous boolean)
returns void
language sql
security invoker
set search_path = ''
return feedback_private.save_app_feedback_rating(p_rating, p_anonymous);

create or replace function public.set_app_feedback_reaction(p_kind text, p_id uuid, p_liked boolean)
returns void
language sql
security invoker
set search_path = ''
return feedback_private.set_app_feedback_reaction(p_kind, p_id, p_liked);

revoke all on function
  public.get_app_feedback_board(), public.save_app_feedback_rating(integer, boolean),
  public.set_app_feedback_reaction(text, uuid, boolean),
  feedback_private.get_app_feedback_board(), feedback_private.save_app_feedback_rating(integer, boolean),
  feedback_private.set_app_feedback_reaction(text, uuid, boolean)
from public, anon;
grant execute on function
  public.get_app_feedback_board(), public.save_app_feedback_rating(integer, boolean),
  public.set_app_feedback_reaction(text, uuid, boolean),
  feedback_private.get_app_feedback_board(), feedback_private.save_app_feedback_rating(integer, boolean),
  feedback_private.set_app_feedback_reaction(text, uuid, boolean)
to authenticated;

-- Older installed apps still query these tables after sign-in. Keep their
-- existing authenticated grants until those app versions are retired.
revoke all on public.app_feedback, public.app_feedback_replies, public.app_ratings from public, anon;

drop policy if exists "Administrators can remove feedback" on public.app_feedback;
create policy "Administrators can remove feedback" on public.app_feedback for delete to authenticated
using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('admin', 'super_admin') and not coalesce(u.disabled, false)));

drop policy if exists "Administrators can remove feedback replies" on public.app_feedback_replies;
create policy "Administrators can remove feedback replies" on public.app_feedback_replies for delete to authenticated
using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('admin', 'super_admin') and not coalesce(u.disabled, false)));

create index if not exists app_feedback_board_created_idx on public.app_feedback ("createdAt" desc, id desc);
create index if not exists app_feedback_replies_thread_idx on public.app_feedback_replies ("feedbackId", "createdAt", id);
create index if not exists app_ratings_current_user_idx on public.app_ratings ("userId", "updatedAt" desc, "createdAt" desc, id desc);

-- Subscribers only need an ID to reload the board. Keep other columns out of change events.
do $$
declare
  target_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target_table in array array['app_feedback', 'app_feedback_replies', 'app_ratings'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I (id)', target_table);
      end if;
    end loop;
  end if;
end;
$$;

-- Validate new messages and edits without rewriting historic posts or reacting on their text.
create or replace function public.validate_app_feedback_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  body text;
begin
  if tg_table_name = 'app_feedback' then
    body := new.feedback;
  else
    body := new.text;
  end if;

  body := pg_catalog.regexp_replace(body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if body is null or pg_catalog.char_length(body) not between 1 and 1200 then
    raise exception 'Write a message between 1 and 1200 characters.' using errcode = '22023';
  end if;

  if tg_table_name = 'app_feedback' then
    new.feedback := body;
  else
    new.text := body;
  end if;
  return new;
end;
$$;

revoke all on function public.validate_app_feedback_text() from public, anon, authenticated;
drop trigger if exists validate_app_feedback_text on public.app_feedback;
create trigger validate_app_feedback_text before insert or update of feedback on public.app_feedback
for each row execute function public.validate_app_feedback_text();
drop trigger if exists validate_app_feedback_text on public.app_feedback_replies;
create trigger validate_app_feedback_text before insert or update of text on public.app_feedback_replies
for each row execute function public.validate_app_feedback_text();

notify pgrst, 'reload schema';
