-- ═══════════════════════════════════════════════════════
-- LifeCycle — NATIVE RELATIONAL SQL SCHEMA
-- ═══════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────
-- 1. USERS
-- ───────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  "fullName" text,
  gender text,
  "dateOfBirth" text,
  "photoURL" text,
  role text not null default 'user',
  "termsAccepted" boolean not null default false,
  "termsAcceptedAt" timestamptz,
  disabled boolean not null default false,
  "banReason" text,
  "bannedBy" uuid,
  "bannedAt" timestamptz,
  "bannedUntil" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.users enable row level security;

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile"
  on public.users for select to authenticated
  using (id = auth.uid());

drop policy if exists "Users can insert their profile" on public.users;
create policy "Users can insert their profile"
  on public.users for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users for update to authenticated
  using (id = auth.uid());

drop policy if exists "Admins can read all user profiles" on public.users;
create policy "Admins can read all user profiles"
  on public.users for select to authenticated
  using (
    exists (
      select 1 from public.users admin_check
      where admin_check.id = auth.uid()
      and admin_check.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

-- ───────────────────────────────────────────────────────
-- 2. FUNERAL SHOPS (1:1 with users)
-- ───────────────────────────────────────────────────────
create table if not exists public.funeral_shops (
  id uuid primary key references public.users(id) on delete cascade,
  "shopName" text not null,
  "shopAddress" text not null,
  "shopPhoneNumber" text not null,
  "shopImageUrl" text,
  "individualRegisteredName" text not null,
  "businessName" text not null,
  "generalLocation" text not null,
  "registeredAddress" text not null,
  "zipCode" text not null,
  tin text not null,
  "vatRegistrationStatus" boolean not null default false,
  "birCertificateUrl" text not null,
  status text not null default 'pending', -- 'pending' | 'verified' | 'rejected'
  "rejectionReason" text,
  "submittedAt" timestamptz not null default now(),
  "verifiedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.funeral_shops enable row level security;

drop policy if exists "Authenticated users can view verified shops" on public.funeral_shops;
drop policy if exists "Anyone can view verified shops" on public.funeral_shops;
create policy "Anyone can view verified shops"
  on public.funeral_shops for select
  using (status = 'verified');

drop policy if exists "Shop owners can view their own shop" on public.funeral_shops;
create policy "Shop owners can view their own shop"
  on public.funeral_shops for select
  using (id = auth.uid());

drop policy if exists "Shop owners can insert their shop" on public.funeral_shops;
create policy "Shop owners can insert their shop"
  on public.funeral_shops for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "Shop owners can update their shop" on public.funeral_shops;
create policy "Shop owners can update their shop"
  on public.funeral_shops for update to authenticated
  using (id = auth.uid());

drop policy if exists "Admins can view all shops" on public.funeral_shops;
create policy "Admins can view all shops"
  on public.funeral_shops for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can update shop status" on public.funeral_shops;
create policy "Admins can update shop status"
  on public.funeral_shops for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );


-- ───────────────────────────────────────────────────────
-- 3. FUNERAL PRODUCTS (1:N with shops)
-- ───────────────────────────────────────────────────────
create table if not exists public.funeral_products (
  id uuid primary key default gen_random_uuid(),
  "shopId" uuid not null references public.funeral_shops(id) on delete cascade,
  name text not null,
  description text,
  price numeric not null,
  stock integer not null default 0,
  "imageUrl" text,
  "hasVariations" boolean not null default false,
  active boolean not null default true,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists fp_shop_idx on public.funeral_products ("shopId");

alter table public.funeral_products enable row level security;

drop policy if exists "Authenticated users can view active products" on public.funeral_products;
drop policy if exists "Anyone can view active products" on public.funeral_products;
create policy "Anyone can view active products"
  on public.funeral_products for select
  using (active = true);

drop policy if exists "Shop owners can view all their products" on public.funeral_products;
create policy "Shop owners can view all their products"
  on public.funeral_products for select
  using ("shopId" = auth.uid());

drop policy if exists "Shop owners can insert products" on public.funeral_products;
create policy "Shop owners can insert products"
  on public.funeral_products for insert to authenticated
  with check ("shopId" = auth.uid());

drop policy if exists "Shop owners can update their products" on public.funeral_products;
create policy "Shop owners can update their products"
  on public.funeral_products for update to authenticated
  using ("shopId" = auth.uid());

drop policy if exists "Shop owners can delete their products" on public.funeral_products;
create policy "Shop owners can delete their products"
  on public.funeral_products for delete to authenticated
  using ("shopId" = auth.uid());


-- ───────────────────────────────────────────────────────
-- 4. FUNERAL PRODUCT VARIATIONS
-- ───────────────────────────────────────────────────────
create table if not exists public.funeral_product_variations (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.funeral_products(id) on delete cascade,
  name text not null,
  "imageUrl" text
);

create index if not exists fpv_product_idx on public.funeral_product_variations ("productId");

alter table public.funeral_product_variations enable row level security;

drop policy if exists "Authenticated users can view product variations" on public.funeral_product_variations;
drop policy if exists "Anyone can view product variations" on public.funeral_product_variations;
create policy "Anyone can view product variations"
  on public.funeral_product_variations for select
  using (true);

drop policy if exists "Shop owners can manage variations" on public.funeral_product_variations;
create policy "Shop owners can manage variations"
  on public.funeral_product_variations for all to authenticated
  using (
    exists (
      select 1 from public.funeral_products p
      where p.id = "productId" and p."shopId" = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────
-- 5. FUNERAL PRODUCT IMAGES (Gallery)
-- ───────────────────────────────────────────────────────
create table if not exists public.funeral_product_images (
  id uuid primary key default gen_random_uuid(),
  "productId" uuid not null references public.funeral_products(id) on delete cascade,
  "imageUrl" text not null,
  "displayOrder" integer not null default 0
);

create index if not exists fpi_product_idx on public.funeral_product_images ("productId");

alter table public.funeral_product_images enable row level security;

drop policy if exists "Authenticated users can view product images" on public.funeral_product_images;
drop policy if exists "Anyone can view product images" on public.funeral_product_images;
create policy "Anyone can view product images"
  on public.funeral_product_images for select
  using (true);

drop policy if exists "Shop owners can manage images" on public.funeral_product_images;
create policy "Shop owners can manage images"
  on public.funeral_product_images for all to authenticated
  using (
    exists (
      select 1 from public.funeral_products p
      where p.id = "productId" and p."shopId" = auth.uid()
    )
  );

-- -------------------------------------------------------
-- 6. CHAT CONVERSATIONS & MESSAGES
-- -------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  participants uuid[] not null,
  "lastMessage" jsonb,
  "hiddenFor" uuid[] default array[]::uuid[],
  "pinnedFor" uuid[] not null default array[]::uuid[],
  "archivedFor" uuid[] not null default array[]::uuid[],
  "unreadFor" uuid[] not null default array[]::uuid[],
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.conversations enable row level security;
drop policy if exists "Users can access their conversations" on public.conversations;
create policy "Users can access their conversations" on public.conversations for all to authenticated using (auth.uid() = any(participants));

create index if not exists conversations_pinned_for_idx on public.conversations using gin ("pinnedFor");
create index if not exists conversations_archived_for_idx on public.conversations using gin ("archivedFor");
create index if not exists conversations_unread_for_idx on public.conversations using gin ("unreadFor");

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  "conversationId" uuid not null references public.conversations(id) on delete cascade,
  "senderId" uuid not null references public.users(id) on delete cascade,
  text text not null,
  "readBy" uuid[] not null default array[]::uuid[],
  "deliveredTo" uuid[] not null default array[]::uuid[],
  reactions jsonb not null default '{}'::jsonb,
  "replyToId" uuid,
  "editedAt" timestamptz,
  timestamp timestamptz not null default now(),
  constraint messages_sender_is_read_by check ("senderId" = any("readBy")),
  constraint messages_sender_not_delivered_to check (not ("senderId" = any("deliveredTo"))),
  constraint messages_reactions_is_object check (jsonb_typeof(reactions) = 'object')
);

create index if not exists messages_conversation_timestamp_idx
  on public.messages ("conversationId", timestamp desc);
create index if not exists messages_delivered_to_idx
  on public.messages using gin ("deliveredTo");

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

create or replace function public.react_to_chat_message(target_message_id uuid, reaction text)
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
  if reaction is not null and not (reaction = any(array['heart', 'like', 'dislike', 'laugh', 'emphasis', 'question']::text[])) then
    raise exception 'Unsupported message reaction.' using errcode = '22023';
  end if;
  update public.messages as message
  set reactions = case
    when reaction is null then coalesce(message.reactions, '{}'::jsonb) - current_user_id::text
    else jsonb_set(coalesce(message.reactions, '{}'::jsonb), array[current_user_id::text], to_jsonb(reaction), true)
  end
  where message.id = target_message_id
    and exists (
      select 1 from public.conversations as conversation
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

create or replace function public.edit_chat_message(target_message_id uuid, new_text text)
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
  select message."conversationId" into target_conversation_id
  from public.messages as message
  where message.id = target_message_id
    and message."senderId" = current_user_id
    and exists (
      select 1 from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    );
  if target_conversation_id is null then
    raise exception 'Only the sender can edit this message.' using errcode = '42501';
  end if;
  update public.messages set text = clean_text, "editedAt" = edit_time where id = target_message_id;
  select message.* into latest_message
  from public.messages as message
  where message."conversationId" = target_conversation_id
  order by message.timestamp desc, message.id desc limit 1;
  update public.conversations
  set "lastMessage" = jsonb_build_object(
    'id', latest_message.id, 'text', latest_message.text,
    'senderId', latest_message."senderId", 'timestamp', latest_message.timestamp,
    'readBy', latest_message."readBy"
  )
  where id = target_conversation_id;
  return edit_time;
end;
$$;

revoke all on function public.edit_chat_message(uuid, text) from public, anon;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;

create or replace function public.unsend_chat_message(target_message_id uuid)
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
  select message."conversationId" into target_conversation_id
  from public.messages as message
  where message.id = target_message_id
    and message."senderId" = current_user_id
    and exists (
      select 1 from public.conversations as conversation
      where conversation.id = message."conversationId"
        and current_user_id = any(conversation.participants)
    );
  if target_conversation_id is null then
    raise exception 'Only the sender can unsend this message.' using errcode = '42501';
  end if;
  delete from public.messages where id = target_message_id;
  select message.* into latest_message
  from public.messages as message
  where message."conversationId" = target_conversation_id
  order by message.timestamp desc, message.id desc limit 1;
  update public.conversations as conversation
  set
    "lastMessage" = case
      when latest_message.id is null then null
      else jsonb_build_object(
        'id', latest_message.id, 'text', latest_message.text,
        'senderId', latest_message."senderId", 'timestamp', latest_message.timestamp,
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

-- -------------------------------------------------------
-- 7. NOTIFICATIONS
-- -------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb,
  read boolean not null default false,
  "createdAt" timestamptz not null default now()
);

alter table public.notifications enable row level security;
drop policy if exists "Users can manage their notifications" on public.notifications;
drop policy if exists "Users can read their notifications" on public.notifications;
create policy "Users can read their notifications" on public.notifications for select to authenticated using ("userId" = auth.uid());
drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications" on public.notifications for update to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());
drop policy if exists "Users can delete their notifications" on public.notifications;
create policy "Users can delete their notifications" on public.notifications for delete to authenticated using ("userId" = auth.uid());
drop policy if exists "Authenticated users can create notifications" on public.notifications;
create policy "Authenticated users can create notifications" on public.notifications for insert to authenticated with check (true);

-- -------------------------------------------------------
-- 8. FEEDBACK & RATINGS
-- -------------------------------------------------------
create table if not exists public.app_ratings (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  "isAnonymous" boolean not null default false,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.app_ratings enable row level security;
drop policy if exists "Anyone can read ratings" on public.app_ratings;
create policy "Anyone can read ratings" on public.app_ratings for select
  using (true);
drop policy if exists "Users can insert ratings" on public.app_ratings;
create policy "Users can insert ratings" on public.app_ratings for insert to authenticated with check ("userId" = auth.uid());
drop policy if exists "Users can update ratings" on public.app_ratings;
create policy "Users can update ratings" on public.app_ratings for update to authenticated using ("userId" = auth.uid());
drop policy if exists "Users can delete ratings" on public.app_ratings;
create policy "Users can delete ratings" on public.app_ratings for delete to authenticated using ("userId" = auth.uid());

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  feedback text not null,
  "isAnonymous" boolean not null default false,
  reactions jsonb default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.app_feedback enable row level security;
drop policy if exists "Anyone can read feedback" on public.app_feedback;
create policy "Anyone can read feedback" on public.app_feedback for select
  using (true);
drop policy if exists "Users can insert feedback" on public.app_feedback;
create policy "Users can insert feedback" on public.app_feedback for insert to authenticated with check ("userId" = auth.uid());
drop policy if exists "Users can manage feedback" on public.app_feedback;
create policy "Users can manage feedback" on public.app_feedback for all to authenticated using ("userId" = auth.uid());

create table if not exists public.app_feedback_replies (
  id uuid primary key default gen_random_uuid(),
  "feedbackId" uuid not null references public.app_feedback(id) on delete cascade,
  "userId" uuid not null references public.users(id) on delete cascade,
  text text not null,
  "isAnonymous" boolean not null default false,
  reactions jsonb default '{}'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

alter table public.app_feedback_replies enable row level security;
drop policy if exists "Anyone can read feedback replies" on public.app_feedback_replies;
create policy "Anyone can read feedback replies" on public.app_feedback_replies for select
  using (true);
drop policy if exists "Users can manage feedback replies" on public.app_feedback_replies;
create policy "Users can manage feedback replies" on public.app_feedback_replies for all to authenticated using ("userId" = auth.uid());

-- -------------------------------------------------------
-- 9. USER BLOCKS
-- -------------------------------------------------------
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  "blockerId" uuid not null references public.users(id) on delete cascade,
  "blockedId" uuid not null references public.users(id) on delete cascade,
  "createdAt" timestamptz not null default now(),
  unique("blockerId", "blockedId")
);

alter table public.user_blocks enable row level security;
drop policy if exists "Users can manage their blocks" on public.user_blocks;
create policy "Users can manage their blocks" on public.user_blocks for all to authenticated using ("blockerId" = auth.uid());
drop policy if exists "Users can see if they are blocked" on public.user_blocks;
create policy "Users can see if they are blocked" on public.user_blocks for select to authenticated using ("blockedId" = auth.uid());


-- -------------------------------------------------------
-- 10. ADMIN AUDIT LOGS
-- -------------------------------------------------------
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  "adminId" uuid not null references public.users(id) on delete cascade,
  action text not null,
  details text,
  "targetUserId" uuid references public.users(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

alter table public.admin_audit_logs enable row level security;
drop policy if exists "Superadmins can read audit logs" on public.admin_audit_logs;
create policy "Superadmins can read audit logs" on public.admin_audit_logs for select to authenticated using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'super_admin')
);
drop policy if exists "Admins can insert audit logs" on public.admin_audit_logs;
create policy "Admins can insert audit logs" on public.admin_audit_logs for insert to authenticated with check ("adminId" = auth.uid());


create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.users(id) on delete cascade,
  email text,
  subject text not null,
  message text not null,
  read boolean not null default false,
  status text not null default 'open',
  channel text not null default 'contact_fallback',
  "createdAt" timestamptz not null default now()
);

alter table public.support_messages enable row level security;
drop policy if exists "Admins can read support messages" on public.support_messages;
create policy "Admins can read support messages" on public.support_messages for select to authenticated using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin', 'super_admin'))
);
drop policy if exists "Users can insert support messages" on public.support_messages;
create policy "Users can insert support messages" on public.support_messages for insert to authenticated with check ("userId" = auth.uid());

