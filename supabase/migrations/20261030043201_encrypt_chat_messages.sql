-- Protect chat bodies at the column level while keeping the existing chat
-- experience usable. The raw messages table stores only ciphertext and a
-- keyed SHA-256 integrity hash. Authorized participants read plaintext through
-- the security-invoker chat_messages view, so the table's existing RLS remains
-- the source of truth for access control.

create schema if not exists private;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'chat_message_encryption_key'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'chat_message_encryption_key',
      'AES-256 key used only by database chat encryption functions.'
    );
  end if;
end;
$$;

-- The requested one-time purge. Conversation rows remain so users can start a
-- fresh thread, but no old message body or preview survives the migration.
delete from public.messages;
update public.conversations
set
  "lastMessage" = null,
  "unreadFor" = array[]::uuid[];

alter table public.messages
  add column if not exists "textHash" text,
  add column if not exists "encryptionVersion" smallint not null default 1;

alter table public.messages
  alter column "textHash" set not null;

alter table public.messages
  drop constraint if exists messages_text_hash_format,
  drop constraint if exists messages_encryption_version_valid;

alter table public.messages
  add constraint messages_text_hash_format
    check ("textHash" ~ '^[0-9a-f]{64}$'),
  add constraint messages_encryption_version_valid
    check ("encryptionVersion" = 1);

create or replace function private.chat_message_key()
returns text
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
declare
  secret_value text;
begin
  select decrypted_secret
  into secret_value
  from vault.decrypted_secrets
  where name = 'chat_message_encryption_key'
  limit 1;

  if secret_value is null then
    raise exception 'Chat encryption key is unavailable.';
  end if;

  return secret_value;
end;
$$;

create or replace function private.decrypt_chat_message(ciphertext text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, private, extensions
as $$
  select extensions.pgp_sym_decrypt(
    decode(ciphertext, 'base64'),
    private.chat_message_key()
  );
$$;

create or replace function private.encrypt_chat_message_text()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  plaintext text := btrim(coalesce(new.text, ''));
  encryption_key text;
begin
  if tg_op = 'UPDATE' and new.text is not distinct from old.text then
    return new;
  end if;

  if char_length(plaintext) < 1 or char_length(plaintext) > 1500 then
    raise exception 'Message text must be between 1 and 1500 characters.'
      using errcode = '22023';
  end if;

  encryption_key := private.chat_message_key();
  new.text := encode(
    extensions.pgp_sym_encrypt(
      plaintext,
      encryption_key,
      'cipher-algo=aes256,compress-algo=1'
    ),
    'base64'
  );
  new."textHash" := encode(
    extensions.hmac(
      convert_to(plaintext, 'UTF8'),
      convert_to(encryption_key, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  new."encryptionVersion" := 1;
  return new;
end;
$$;

drop trigger if exists zz_encrypt_chat_message_text on public.messages;
create trigger zz_encrypt_chat_message_text
before insert or update of text on public.messages
for each row execute function private.encrypt_chat_message_text();

create or replace function private.sanitize_conversation_message_preview()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new."lastMessage" is not null
     and jsonb_typeof(new."lastMessage") = 'object'
     and new."lastMessage" ? 'text' then
    new."lastMessage" := jsonb_set(
      new."lastMessage",
      '{text}',
      to_jsonb('Encrypted message'::text),
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sanitize_conversation_message_preview on public.conversations;
create trigger sanitize_conversation_message_preview
before insert or update of "lastMessage" on public.conversations
for each row execute function private.sanitize_conversation_message_preview();

drop view if exists public.chat_messages;
create view public.chat_messages
with (security_invoker = true)
as
select
  message.id,
  message."conversationId",
  message."senderId",
  private.decrypt_chat_message(message.text) as text,
  message."readBy",
  message.timestamp,
  message."deliveredTo",
  message.reactions,
  message."replyToId",
  message."editedAt"
from public.messages as message;

revoke all on function private.chat_message_key() from public, anon, authenticated;
revoke all on function private.encrypt_chat_message_text() from public, anon, authenticated;
revoke all on function private.sanitize_conversation_message_preview() from public, anon, authenticated;
revoke all on function private.decrypt_chat_message(text) from public, anon;
grant execute on function private.decrypt_chat_message(text) to authenticated;

revoke all on table public.chat_messages from public, anon;
grant select on table public.chat_messages to authenticated;

comment on column public.messages.text is
  'Base64-encoded AES-256 PGP ciphertext. Read plaintext through public.chat_messages.';
comment on column public.messages."textHash" is
  'Keyed HMAC-SHA-256 of the plaintext for integrity checks; never the plaintext itself.';
comment on view public.chat_messages is
  'RLS-respecting decrypted chat messages for authenticated conversation participants.';

notify pgrst, 'reload schema';
