-- Defense in depth for the decrypted view: even if the helper is invoked
-- directly, it only decrypts a message that belongs to the signed-in user's
-- conversation.

drop view if exists public.chat_messages;
drop function if exists private.decrypt_chat_message(text);

create or replace function private.decrypt_chat_message(
  message_id uuid,
  ciphertext text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, extensions, auth
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.messages as message
    join public.conversations as conversation
      on conversation.id = message."conversationId"
    where message.id = message_id
      and message.text = ciphertext
      and current_user_id = any(conversation.participants)
  ) then
    raise exception 'Conversation access is required.' using errcode = '42501';
  end if;

  return extensions.pgp_sym_decrypt(
    decode(ciphertext, 'base64'),
    private.chat_message_key()
  );
end;
$$;

create view public.chat_messages
with (security_invoker = true)
as
select
  message.id,
  message."conversationId",
  message."senderId",
  private.decrypt_chat_message(message.id, message.text) as text,
  message."readBy",
  message.timestamp,
  message."deliveredTo",
  message.reactions,
  message."replyToId",
  message."editedAt"
from public.messages as message;

revoke all on function private.decrypt_chat_message(uuid, text)
  from public, anon;
grant execute on function private.decrypt_chat_message(uuid, text)
  to authenticated;

revoke all on table public.chat_messages from public, anon;
grant select on table public.chat_messages to authenticated;

comment on view public.chat_messages is
  'RLS-respecting decrypted chat messages; decryption also verifies auth.uid() is a conversation participant.';

notify pgrst, 'reload schema';
