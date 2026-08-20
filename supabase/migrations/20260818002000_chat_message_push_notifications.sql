-- Turn every newly stored chat message into an in-app notification. The
-- existing notifications-table webhook then delivers it through Expo Push.
-- Keeping this in Postgres makes delivery consistent for web and mobile
-- senders and prevents either client from having to create its own push row.

create or replace function public.create_chat_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  sender_label text;
  message_preview text;
begin
  select coalesce(
    nullif(btrim(shop."shopName"), ''),
    nullif(btrim(sender."fullName"), ''),
    nullif(split_part(sender.email, '@', 1), ''),
    'Someone'
  )
  into sender_label
  from public.users as sender
  left join public.funeral_shops as shop
    on shop.id = sender.id
  where sender.id = new."senderId";

  sender_label := coalesce(sender_label, 'Someone');
  message_preview := regexp_replace(btrim(new.text), E'\s+', ' ', 'g');
  if message_preview = '' then
    message_preview := 'Sent you a message.';
  elsif char_length(message_preview) > 160 then
    message_preview := left(message_preview, 157) || '...';
  end if;

  insert into public.notifications (
    "userId",
    type,
    title,
    body,
    data,
    read,
    "createdAt"
  )
  select
    participant.recipient_id,
    'chat_message',
    'New message from ' || sender_label,
    message_preview,
    jsonb_build_object(
      'conversationId', new."conversationId",
      'otherUserId', new."senderId",
      'senderId', new."senderId",
      'messageId', new.id,
      'screen', 'Chat'
    ),
    false,
    coalesce(new.timestamp, now())
  from public.conversations as conversation
  cross join lateral unnest(conversation.participants)
    as participant(recipient_id)
  where conversation.id = new."conversationId"
    and participant.recipient_id <> new."senderId"
    and not (
      participant.recipient_id = any(
        coalesce(new."readBy", array[]::uuid[])
      )
    );

  return new;
end;
$$;

revoke all on function public.create_chat_message_notifications()
  from public, anon, authenticated;

drop trigger if exists lifecycle_chat_message_notifications
  on public.messages;
create trigger lifecycle_chat_message_notifications
  after insert on public.messages
  for each row
  execute function public.create_chat_message_notifications();

notify pgrst, 'reload schema';
