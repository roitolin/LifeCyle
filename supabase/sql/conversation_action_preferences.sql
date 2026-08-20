-- LifeCycle - per-user conversation actions
-- Run once in the Supabase SQL Editor before releasing the long-press menu.
-- Safe to run more than once.

begin;

alter table public.conversations
  add column if not exists "pinnedFor" uuid[] not null default array[]::uuid[],
  add column if not exists "archivedFor" uuid[] not null default array[]::uuid[],
  add column if not exists "unreadFor" uuid[] not null default array[]::uuid[];

update public.conversations
set
  "pinnedFor" = coalesce("pinnedFor", array[]::uuid[]),
  "archivedFor" = coalesce("archivedFor", array[]::uuid[]),
  "unreadFor" = coalesce("unreadFor", array[]::uuid[])
where "pinnedFor" is null
   or "archivedFor" is null
   or "unreadFor" is null;

alter table public.conversations
  alter column "pinnedFor" set default array[]::uuid[],
  alter column "pinnedFor" set not null,
  alter column "archivedFor" set default array[]::uuid[],
  alter column "archivedFor" set not null,
  alter column "unreadFor" set default array[]::uuid[],
  alter column "unreadFor" set not null;

create index if not exists conversations_pinned_for_idx
  on public.conversations using gin ("pinnedFor");
create index if not exists conversations_archived_for_idx
  on public.conversations using gin ("archivedFor");
create index if not exists conversations_unread_for_idx
  on public.conversations using gin ("unreadFor");

create or replace function public.set_conversation_preference(
  target_conversation_id uuid,
  preference_name text,
  preference_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    return false;
  end if;

  if preference_name not in ('pinned', 'archived', 'unread') then
    raise exception 'Unsupported conversation preference: %', preference_name
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.conversations
    where id = target_conversation_id
      and current_user_id = any(participants)
  ) then
    return false;
  end if;

  if preference_name = 'pinned' then
    update public.conversations
    set "pinnedFor" = case
      when preference_enabled then array_append(array_remove("pinnedFor", current_user_id), current_user_id)
      else array_remove("pinnedFor", current_user_id)
    end
    where id = target_conversation_id;
  elsif preference_name = 'archived' then
    update public.conversations
    set "archivedFor" = case
      when preference_enabled then array_append(array_remove("archivedFor", current_user_id), current_user_id)
      else array_remove("archivedFor", current_user_id)
    end
    where id = target_conversation_id;
  else
    update public.conversations
    set "unreadFor" = case
      when preference_enabled then array_append(array_remove("unreadFor", current_user_id), current_user_id)
      else array_remove("unreadFor", current_user_id)
    end
    where id = target_conversation_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.set_conversation_preference(uuid, text, boolean) from public, anon;
grant execute on function public.set_conversation_preference(uuid, text, boolean) to authenticated;

-- A genuinely new message restores a deleted/archived conversation for both
-- participants. Read-receipt-only changes keep archive state untouched.
create or replace function public.restore_conversation_for_new_message()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if (new."lastMessage" ->> 'timestamp') is distinct from (old."lastMessage" ->> 'timestamp') then
    new."hiddenFor" := array[]::uuid[];
    new."archivedFor" := array[]::uuid[];
  end if;
  return new;
end;
$function$;

drop trigger if exists restore_conversation_for_new_message on public.conversations;
create trigger restore_conversation_for_new_message
before update of "lastMessage" on public.conversations
for each row execute function public.restore_conversation_for_new_message();

notify pgrst, 'reload schema';

commit;
