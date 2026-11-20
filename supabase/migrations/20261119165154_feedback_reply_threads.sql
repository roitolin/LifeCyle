alter table public.app_feedback_replies
  add column "parentReplyId" uuid
    references public.app_feedback_replies (id) on delete set null;

create index app_feedback_replies_parent_idx
  on public.app_feedback_replies ("parentReplyId")
  where "parentReplyId" is not null;

-- A child must stay on the same post and can only point to a top-level comment.
-- Deleting a parent promotes its children to top-level comments.
create function feedback_private.check_reply_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new."feedbackId" is distinct from old."feedbackId"
       or (new."parentReplyId" is not null and new."parentReplyId" is distinct from old."parentReplyId") then
      raise exception 'A reply cannot be moved to another thread.' using errcode = '23514';
    end if;
  elsif new."parentReplyId" is not null and not exists (
    select 1 from public.app_feedback_replies parent
    where parent.id = new."parentReplyId"
      and parent."feedbackId" = new."feedbackId"
      and parent."parentReplyId" is null
  ) then
    raise exception 'Choose a top-level comment on this feedback post.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function feedback_private.check_reply_parent() from public, anon, authenticated;

create trigger check_reply_parent
before insert or update of "feedbackId", "parentReplyId" on public.app_feedback_replies
for each row execute function feedback_private.check_reply_parent();

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
        'photoURL', case when not f."isAnonymous" then u."photoURL" end,
        'isAnonymous', f."isAnonymous", 'feedback', f.feedback,
        'createdAt', f."createdAt", 'updatedAt', f."updatedAt",
        'publicRating', case when not f."isAnonymous" and not r."isAnonymous" then r.rating end,
        'liked', f.reactions ->> caller::text = 'like',
        'reactionCount', (select count(*) from jsonb_each_text(case when jsonb_typeof(f.reactions) = 'object' then f.reactions else '{}'::jsonb end) kv where kv.value = 'like'),
        'replies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'mine', a."userId" = caller,
            'displayName', case when not a."isAnonymous" then au."fullName" end,
            'photoURL', case when not a."isAnonymous" then au."photoURL" end,
            'parentReplyId', a."parentReplyId",
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

notify pgrst, 'reload schema';
