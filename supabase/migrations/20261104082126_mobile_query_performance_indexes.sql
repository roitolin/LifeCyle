begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index if not exists notifications_user_created_at_idx
  on public.notifications ("userId", "createdAt" desc);

create index if not exists notifications_user_unread_idx
  on public.notifications ("userId", "createdAt" desc)
  include (type)
  where read = false;

create index if not exists conversations_participants_gin_idx
  on public.conversations using gin (participants);

create index if not exists funeral_products_active_name_idx
  on public.funeral_products (name)
  where active = true and stock > 0;

commit;
