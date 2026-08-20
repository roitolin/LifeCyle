-- LifeCycle chat delivery receipts and message actions.
-- Safe to rerun in the Supabase SQL Editor when chat features are upgraded.

begin;

alter table public.messages
  add column if not exists "deliveredTo" uuid[] not null default array[]::uuid[];

alter table public.messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists "replyToId" uuid,
  add column if not exists "editedAt" timestamptz;

-- Normalize legacy rows before enforcing immutable receipt invariants.
drop trigger if exists guard_chat_message_receipt_update on public.messages;

update public.messages as message
set
  "readBy" = (
    select array(
      select distinct receipt_id
      from unnest(
        coalesce(message."readBy", array[]::uuid[])
        || array[message."senderId"]::uuid[]
      ) as receipts(receipt_id)
      where receipt_id = message."senderId"
        or receipt_id = any(conversation.participants)
      order by receipt_id
    )
  ),
  "deliveredTo" = (
    select array(
      select distinct receipt_id
      from unnest(coalesce(message."deliveredTo", array[]::uuid[])) as receipts(receipt_id)
      where receipt_id = any(conversation.participants)
        and receipt_id <> message."senderId"
      order by receipt_id
    )
  )
from public.conversations as conversation
where conversation.id = message."conversationId";

update public.messages
set reactions = '{}'::jsonb
where reactions is null or jsonb_typeof(reactions) <> 'object';

alter table public.messages
  alter column "readBy" set default array[]::uuid[],
  alter column "readBy" set not null,
  alter column "deliveredTo" set default array[]::uuid[],
  alter column "deliveredTo" set not null,
  alter column reactions set default '{}'::jsonb,
  alter column reactions set not null;

alter table public.messages
  drop constraint if exists messages_sender_is_read_by,
  drop constraint if exists messages_sender_not_delivered_to,
  drop constraint if exists messages_reactions_is_object;

alter table public.messages
  add constraint messages_sender_is_read_by
    check ("senderId" = any("readBy")),
  add constraint messages_sender_not_delivered_to
    check (not ("senderId" = any("deliveredTo"))),
  add constraint messages_reactions_is_object
    check (jsonb_typeof(reactions) = 'object');

create index if not exists messages_delivered_to_idx
  on public.messages using gin ("deliveredTo");

create index if not exists messages_conversation_timestamp_idx
  on public.messages ("conversationId", timestamp desc);

create or replace function public.acknowledge_chat_deliveries(
  target_conversation_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  updated_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  update public.messages as message
  set "deliveredTo" = array_append(
    coalesce(message."deliveredTo", array[]::uuid[]),
    current_user_id
  )
  where message."senderId" <> current_user_id
    and (
      target_conversation_ids is null
      or message."conversationId" = any(target_conversation_ids)
    )
    and not (
      current_user_id = any(coalesce(message."deliveredTo", array[]::uuid[]))
    )
    and exists (
      select 1
      from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.acknowledge_chat_deliveries(uuid[]) from public, anon;
grant execute on function public.acknowledge_chat_deliveries(uuid[]) to authenticated;

create or replace function public.mark_chat_messages_seen(
  target_conversation_id uuid,
  target_message_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  updated_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.conversations as conversation
    where conversation.id = target_conversation_id
      and current_user_id = any(conversation.participants)
  ) then
    raise exception 'Conversation access is required.' using errcode = '42501';
  end if;

  update public.messages as message
  set "readBy" = array_append(
    coalesce(message."readBy", array[]::uuid[]),
    current_user_id
  )
  where message."conversationId" = target_conversation_id
    and message."senderId" <> current_user_id
    and (
      target_message_ids is null
      or message.id = any(target_message_ids)
    )
    and not (
      current_user_id = any(coalesce(message."readBy", array[]::uuid[]))
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_chat_messages_seen(uuid, uuid[]) from public, anon;
grant execute on function public.mark_chat_messages_seen(uuid, uuid[]) to authenticated;

create or replace function public.react_to_chat_message(
  target_message_id uuid,
  reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  updated_reactions jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if reaction is not null and not (
    reaction = any(array['heart', 'like', 'dislike', 'laugh', 'emphasis', 'question']::text[])
  ) then
    raise exception 'Unsupported message reaction.' using errcode = '22023';
  end if;

  update public.messages as message
  set reactions = case
    when reaction is null then coalesce(message.reactions, '{}'::jsonb) - current_user_id::text
    else jsonb_set(
      coalesce(message.reactions, '{}'::jsonb),
      array[current_user_id::text],
      to_jsonb(reaction),
      true
    )
  end
  where message.id = target_message_id
    and exists (
      select 1
      from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    )
  returning message.reactions into updated_reactions;

  if updated_reactions is null then
    raise exception 'Message access is required.' using errcode = '42501';
  end if;
  return updated_reactions;
end;
$$;

revoke all on function public.react_to_chat_message(uuid, text) from public, anon;
grant execute on function public.react_to_chat_message(uuid, text) to authenticated;

create or replace function public.edit_chat_message(
  target_message_id uuid,
  new_text text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_text text := btrim(coalesce(new_text, ''));
  target_conversation_id uuid;
  edit_time timestamptz := now();
  latest_message public.messages%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if char_length(clean_text) < 1 or char_length(clean_text) > 1500 then
    raise exception 'Message text must be between 1 and 1500 characters.' using errcode = '22023';
  end if;

  select message."conversationId"
  into target_conversation_id
  from public.messages as message
  where message.id = target_message_id
    and message."senderId" = current_user_id
    and exists (
      select 1
      from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    );

  if target_conversation_id is null then
    raise exception 'Only the sender can edit this message.' using errcode = '42501';
  end if;

  update public.messages
  set text = clean_text, "editedAt" = edit_time
  where id = target_message_id;

  select message.*
  into latest_message
  from public.messages as message
  where message."conversationId" = target_conversation_id
  order by message.timestamp desc, message.id desc
  limit 1;

  update public.conversations
  set "lastMessage" = jsonb_build_object(
    'id', latest_message.id,
    'text', latest_message.text,
    'senderId', latest_message."senderId",
    'timestamp', latest_message.timestamp,
    'readBy', latest_message."readBy"
  )
  where id = target_conversation_id;

  return edit_time;
end;
$$;

revoke all on function public.edit_chat_message(uuid, text) from public, anon;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;

create or replace function public.unsend_chat_message(
  target_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_conversation_id uuid;
  latest_message public.messages%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select message."conversationId"
  into target_conversation_id
  from public.messages as message
  where message.id = target_message_id
    and message."senderId" = current_user_id
    and exists (
      select 1
      from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    );

  if target_conversation_id is null then
    raise exception 'Only the sender can unsend this message.' using errcode = '42501';
  end if;

  delete from public.messages where id = target_message_id;

  select message.*
  into latest_message
  from public.messages as message
  where message."conversationId" = target_conversation_id
  order by message.timestamp desc, message.id desc
  limit 1;

  update public.conversations as conversation
  set
    "lastMessage" = case
      when latest_message.id is null then null
      else jsonb_build_object(
        'id', latest_message.id,
        'text', latest_message.text,
        'senderId', latest_message."senderId",
        'timestamp', latest_message.timestamp,
        'readBy', latest_message."readBy"
      )
    end,
    "updatedAt" = coalesce(latest_message.timestamp, conversation."createdAt")
  where conversation.id = target_conversation_id;

  return true;
end;
$$;

revoke all on function public.unsend_chat_message(uuid) from public, anon;
grant execute on function public.unsend_chat_message(uuid) to authenticated;

alter table public.messages enable row level security;

drop policy if exists "Users can access messages in their conversations" on public.messages;
drop policy if exists "Conversation participants can read messages" on public.messages;
drop policy if exists "Conversation participants can send messages" on public.messages;
drop policy if exists "Conversation participants can update guarded receipts" on public.messages;

create policy "Conversation participants can read messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1
      from public.conversations as conversation
      where conversation.id = public.messages."conversationId"
        and (select auth.uid()) = any(conversation.participants)
    )
  );

create policy "Conversation participants can send messages"
  on public.messages for insert to authenticated
  with check (
    "senderId" = (select auth.uid())
    and "readBy" = array[(select auth.uid())]::uuid[]
    and "deliveredTo" = array[]::uuid[]
    and reactions = '{}'::jsonb
    and "editedAt" is null
    and exists (
      select 1
      from public.conversations as conversation
      where conversation.id = public.messages."conversationId"
        and (select auth.uid()) = any(conversation.participants)
    )
  );

create policy "Conversation participants can update guarded receipts"
  on public.messages for update to authenticated
  using (
    exists (
      select 1
      from public.conversations as conversation
      where conversation.id = public.messages."conversationId"
        and (select auth.uid()) = any(conversation.participants)
    )
  )
  with check (
    exists (
      select 1
      from public.conversations as conversation
      where conversation.id = public.messages."conversationId"
        and (select auth.uid()) = any(conversation.participants)
    )
  );

create or replace function public.guard_chat_message_receipt_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new."conversationId" is distinct from old."conversationId"
    or new."senderId" is distinct from old."senderId"
    or new.timestamp is distinct from old.timestamp
    or new."replyToId" is distinct from old."replyToId"
  then
    raise exception 'Message contents are immutable.' using errcode = '42501';
  end if;

  if (
      new.text is distinct from old.text
      or new."editedAt" is distinct from old."editedAt"
    )
    and old."senderId" <> current_user_id
  then
    raise exception 'Only the sender can edit a message.' using errcode = '42501';
  end if;

  if (coalesce(new.reactions, '{}'::jsonb) - current_user_id::text)
    is distinct from (coalesce(old.reactions, '{}'::jsonb) - current_user_id::text)
  then
    raise exception 'A user may only update their own reaction.' using errcode = '42501';
  end if;

  if old."senderId" = current_user_id
    and (
      new."readBy" is distinct from old."readBy"
      or new."deliveredTo" is distinct from old."deliveredTo"
    )
  then
    raise exception 'A sender cannot update their own receipts.' using errcode = '42501';
  end if;

  if array_remove(new."readBy", current_user_id)
    is distinct from array_remove(old."readBy", current_user_id)
  then
    raise exception 'A user may only update their own seen receipt.' using errcode = '42501';
  end if;

  if array_remove(new."deliveredTo", current_user_id)
    is distinct from array_remove(old."deliveredTo", current_user_id)
  then
    raise exception 'A user may only update their own delivery receipt.' using errcode = '42501';
  end if;

  if current_user_id = any(old."readBy")
    and not (current_user_id = any(new."readBy"))
  then
    raise exception 'A seen receipt cannot be removed.' using errcode = '42501';
  end if;

  if current_user_id = any(old."deliveredTo")
    and not (current_user_id = any(new."deliveredTo"))
  then
    raise exception 'A delivery receipt cannot be removed.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_chat_message_receipt_update on public.messages;
create trigger guard_chat_message_receipt_update
before update on public.messages
for each row
execute function public.guard_chat_message_receipt_update();

revoke all privileges on table public.messages from anon, authenticated;
grant select on table public.messages to authenticated;
grant insert ("conversationId", "senderId", text, "readBy", timestamp, "replyToId")
  on public.messages to authenticated;
grant update ("readBy", "deliveredTo")
  on public.messages to authenticated;

notify pgrst, 'reload schema';

commit;
