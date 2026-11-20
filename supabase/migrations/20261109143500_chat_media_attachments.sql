-- Allow chat participants to send media attachments (photos, videos, voice
-- messages, and files) in conversations across web and mobile.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  52428800,
  null
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read chat media" on storage.objects;
create policy "Public can read chat media"
  on storage.objects for select
  using (bucket_id = 'chat-media');

drop policy if exists "Authenticated users can upload chat media" on storage.objects;
create policy "Authenticated users can upload chat media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Authenticated users can update own chat media" on storage.objects;
create policy "Authenticated users can update own chat media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Authenticated users can delete own chat media" on storage.objects;
create policy "Authenticated users can delete own chat media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

alter table public.messages
  add column if not exists "mediaUrl" text,
  add column if not exists "mediaType" text,
  add column if not exists "mediaDuration" numeric(10, 2),
  add column if not exists "mediaName" text;

alter table public.messages
  drop constraint if exists messages_media_type_valid;

alter table public.messages
  add constraint messages_media_type_valid
    check ("mediaType" is null or "mediaType" in ('image', 'video', 'audio', 'file'));

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

  if (new."mediaUrl" is null and char_length(plaintext) < 1)
     or char_length(plaintext) > 1500 then
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

create or replace function private.sanitize_conversation_message_preview()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  media_type text;
  preview_label text;
begin
  if new."lastMessage" is not null
     and jsonb_typeof(new."lastMessage") = 'object'
     and new."lastMessage" ? 'text' then
    media_type := coalesce(new."lastMessage" ->> 'mediaType', '');
    preview_label := case media_type
      when 'image' then 'Sent a photo'
      when 'video' then 'Sent a video'
      when 'audio' then 'Sent a voice message'
      when 'file' then 'Sent a file'
      else 'Encrypted message'
    end;
    new."lastMessage" := jsonb_set(
      new."lastMessage",
      '{text}',
      to_jsonb(preview_label),
      true
    );
  end if;
  return new;
end;
$$;

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
    or new."mediaUrl" is distinct from old."mediaUrl"
    or new."mediaType" is distinct from old."mediaType"
    or new."mediaDuration" is distinct from old."mediaDuration"
    or new."mediaName" is distinct from old."mediaName"
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

create or replace view public.chat_messages
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
  message."editedAt",
  message."mediaUrl",
  message."mediaType",
  message."mediaDuration",
  message."mediaName"
from public.messages as message;

revoke all on function private.encrypt_chat_message_text() from public, anon, authenticated;
revoke all on function private.sanitize_conversation_message_preview() from public, anon, authenticated;
revoke all on function public.guard_chat_message_receipt_update() from public, anon, authenticated;

grant insert (
  "conversationId",
  "senderId",
  text,
  "readBy",
  timestamp,
  "replyToId",
  "mediaUrl",
  "mediaType",
  "mediaDuration",
  "mediaName"
) on public.messages to authenticated;

revoke all on table public.chat_messages from public, anon;
grant select on table public.chat_messages to authenticated;

notify pgrst, 'reload schema';

commit;

