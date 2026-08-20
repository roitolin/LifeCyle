-- Chat notifications represent the sender as a person even when that account
-- also owns a funeral shop. Storefront identity remains available in the
-- clients when the user opens the shop itself.

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

notify pgrst, 'reload schema';
