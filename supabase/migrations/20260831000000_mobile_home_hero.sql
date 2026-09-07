-- Root-admin managed feature banner for the mobile customer home screen.

begin;

create table if not exists public.home_hero_content (
  id smallint primary key default 1 check (id = 1),
  title text not null default 'Explore available caskets'
    check (char_length(trim(title)) between 1 and 80),
  subtitle text not null default 'Compare current listings from approved funeral shops.'
    check (char_length(trim(subtitle)) between 1 and 160),
  button_label text not null default 'Browse now'
    check (char_length(trim(button_label)) between 1 and 30),
  image_url text,
  target text not null default 'shops'
    check (target in ('shops', 'catalog')),
  is_active boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint active_home_hero_requires_image
    check (not is_active or image_url is not null)
);

insert into public.home_hero_content (id)
values (1)
on conflict (id) do nothing;

alter table public.home_hero_content enable row level security;

drop policy if exists "Authenticated users can read active home hero" on public.home_hero_content;
create policy "Authenticated users can read active home hero"
  on public.home_hero_content for select to authenticated
  using (is_active or public.current_user_can_manage_users());

drop policy if exists "Root admins can create home hero" on public.home_hero_content;
create policy "Root admins can create home hero"
  on public.home_hero_content for insert to authenticated
  with check (
    public.current_user_can_manage_users()
    and updated_by = (select auth.uid())
  );

drop policy if exists "Root admins can update home hero" on public.home_hero_content;
create policy "Root admins can update home hero"
  on public.home_hero_content for update to authenticated
  using (public.current_user_can_manage_users())
  with check (
    public.current_user_can_manage_users()
    and updated_by = (select auth.uid())
  );

revoke all on public.home_hero_content from anon;
grant select, insert, update on public.home_hero_content to authenticated;

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'home_hero_content'
  ) then
    alter publication supabase_realtime add table public.home_hero_content;
  end if;
end;
$realtime$;

notify pgrst, 'reload schema';

commit;
