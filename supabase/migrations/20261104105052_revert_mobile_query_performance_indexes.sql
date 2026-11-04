begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
drop index if exists public.notifications_user_created_at_idx;
drop index if exists public.notifications_user_unread_idx;
drop index if exists public.conversations_participants_gin_idx;
drop index if exists public.funeral_products_active_name_idx;
commit;
