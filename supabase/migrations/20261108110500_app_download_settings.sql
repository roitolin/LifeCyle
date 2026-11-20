-- Public "Install Our App" download/redirect URL managed by administrators.

begin;

create or replace function public.current_user_can_manage_app_settings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.users as profile
    where profile.id = (select auth.uid())
      and profile.role in ('admin', 'super_admin')
      and coalesce(profile.disabled, false) = false
  );
$function$;

revoke all on function public.current_user_can_manage_app_settings() from public, anon, authenticated;
grant execute on function public.current_user_can_manage_app_settings() to authenticated;

create table if not exists public.app_download_settings (
  id smallint primary key default 1 check (id = 1),
  download_url text
    check (
      download_url is null
      or (
        char_length(btrim(download_url)) between 8 and 2048
        and download_url = btrim(download_url)
        and download_url ~* '^https?://[^\s]+$'
      )
    ),
  is_active boolean not null default false,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint active_app_download_requires_url
    check (not is_active or download_url is not null)
);

insert into public.app_download_settings (id, download_url, is_active)
values (1, null, false)
on conflict (id) do nothing;

alter table public.app_download_settings enable row level security;

revoke all on table public.app_download_settings from public, anon, authenticated;
grant select on table public.app_download_settings to anon, authenticated;
grant insert, update on table public.app_download_settings to authenticated;

drop policy if exists "Anyone can read active app download settings" on public.app_download_settings;
create policy "Anyone can read active app download settings"
  on public.app_download_settings
  for select
  to anon, authenticated
  using (
    (is_active and download_url is not null)
    or (select public.current_user_can_manage_app_settings())
  );

drop policy if exists "Admins can create app download settings" on public.app_download_settings;
create policy "Admins can create app download settings"
  on public.app_download_settings
  for insert
  to authenticated
  with check (
    (select public.current_user_can_manage_app_settings())
    and updated_by = (select auth.uid())
  );

drop policy if exists "Admins can update app download settings" on public.app_download_settings;
create policy "Admins can update app download settings"
  on public.app_download_settings
  for update
  to authenticated
  using ((select public.current_user_can_manage_app_settings()))
  with check (
    (select public.current_user_can_manage_app_settings())
    and updated_by = (select auth.uid())
  );

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_download_settings'
  ) then
    alter publication supabase_realtime add table public.app_download_settings;
  end if;
end;
$realtime$;

notify pgrst, 'reload schema';

commit;
