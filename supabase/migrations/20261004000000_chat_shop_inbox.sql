-- Separate a shop owner's customer inbox from their personal conversations.
alter table public.conversations
  add column if not exists "shopId" uuid references public.funeral_shops(id) on delete cascade;

comment on column public.conversations."shopId" is
  'The funeral shop receiving this conversation. Null means a personal or legacy conversation.';

-- Existing conversations are assigned to the shop that received the first
-- message. This preserves customer-to-shop chats without guessing from names.
with first_senders as (
  select distinct on (message."conversationId")
    message."conversationId",
    message."senderId"
  from public.messages as message
  order by message."conversationId", message.timestamp asc, message.id asc
), inferred_shops as (
  select
    conversation.id as conversation_id,
    shop.id as shop_id
  from public.conversations as conversation
  join first_senders as first_message
    on first_message."conversationId" = conversation.id
  join lateral unnest(conversation.participants) as participant(id)
    on participant.id <> first_message."senderId"
  join public.funeral_shops as shop
    on shop.id = participant.id
  where conversation."shopId" is null
)
update public.conversations as conversation
set "shopId" = inferred_shops.shop_id
from inferred_shops
where conversation.id = inferred_shops.conversation_id;

create index if not exists conversations_shop_updated_idx
  on public.conversations ("shopId", "updatedAt" desc)
  where "shopId" is not null;
