-- Message bodies are encrypted before AFTER INSERT triggers run. Notifications
-- therefore use a generic preview rather than copying either plaintext or
-- ciphertext into another table.

create or replace function public.create_chat_message_notifications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  sender_label text;
begin
  select coalesce(
    nullif(btrim(sender."fullName"), ''),
    nullif(btrim(shop."shopName"), ''),
    nullif(split_part(sender.email, '@', 1), ''),
    'Someone'
  )
  into sender_label
  from public.users as sender
  left join public.funeral_shops as shop
    on shop.id = sender.id
  where sender.id = new."senderId";

  sender_label := coalesce(sender_label, 'Someone');

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
    'You received a new encrypted message.',
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
