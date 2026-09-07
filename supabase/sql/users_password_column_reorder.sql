-- RETIRED SECURITY SCRIPT - DO NOT EXECUTE.
-- Password credentials must remain exclusively in Supabase Auth (auth.users).
-- The former script is retained inside a block comment for historical reference.
/*
-- ═══════════════════════════════════════════════════════
-- LifeCycle — REORDER users.password AFTER email, BEFORE fullName
-- Run this in the Supabase SQL editor.
--
-- PostgreSQL has no "AFTER/FIRST" column reorder, so the table is
-- rebuilt: old table is renamed, a new public.users is created with
-- the desired column order, data is copied, every incoming foreign
-- key is re-pointed to the new table, and every RLS policy that
-- referenced users is recreated so it binds to the new table.
-- Run inside a transaction — if anything fails, nothing changes.
--
-- NOTE: Must run AFTER user_password_column.sql so the password
-- column (and its data) exists to be moved.
-- ═══════════════════════════════════════════════════════

begin;

-- Normalize the source schema before rebuilding it. Older users tables may
-- not have these optional profile fields yet.
alter table public.users
  add column if not exists "photoURL" text;

-- Guard: if a previous attempt partially applied, stop loudly.
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'users_old'
      and relnamespace = 'public'::regnamespace
  ) then
    raise exception 'users_old already exists — a previous run partially applied. Check the database before re-running this migration.';
  end if;
end
$$;

-- ── 1. Keep the existing table aside (data, triggers stay with it) ──
alter table public.users rename to users_old;

-- ── 2. New public.users with password between email and fullName ──
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  password text,
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

-- ── 3. Copy data (password keeps its stored bcrypt hash) ──
insert into public.users (
  id,
  email,
  password,
  "fullName",
  gender,
  "dateOfBirth",
  "photoURL",
  role,
  "termsAccepted",
  "termsAcceptedAt",
  disabled,
  "banReason",
  "bannedBy",
  "bannedAt",
  "bannedUntil",
  "createdAt",
  "updatedAt"
)
select
  id,
  email,
  password,
  "fullName",
  gender,
  "dateOfBirth",
  "photoURL",
  role,
  "termsAccepted",
  "termsAcceptedAt",
  disabled,
  "banReason",
  "bannedBy",
  "bannedAt",
  "bannedUntil",
  "createdAt",
  "updatedAt"
from public.users_old;

comment on column public.users.password is
  'Salted bcrypt hash only. Mirrors the Supabase auth hash; never plaintext and never used for login.';

-- ── 4. Re-point every incoming foreign key to the new table ──
do $$
declare
  r record;
  consdef text;
  newdef text;
begin
  for r in
    select c.oid as conid,
           c.conname,
           c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.users_old'::regclass
  loop
    select pg_get_constraintdef(r.conid) into consdef;
    newdef := replace(consdef, 'users_old', 'users');
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, newdef);
  end loop;
end
$$;

-- ── 5. Row level security on the new users table (same as fix_user_profile_creation.sql) ──
alter table public.users enable row level security;

drop policy if exists "Users can read their own profile" on public.users;
create policy "Users can read their own profile"
on public.users for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Admins can read all user profiles" on public.users;
create policy "Admins can read all user profiles"
on public.users for select to authenticated
using (public.current_user_can_read_all_users());

drop policy if exists "Users can update their own basic profile" on public.users;
create policy "Users can update their own basic profile"
on public.users for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Admins can update user profiles" on public.users;
create policy "Admins can update user profiles"
on public.users for update to authenticated
using (public.current_user_can_manage_users())
with check (public.current_user_can_manage_users());

grant select, update on public.users to authenticated;
revoke insert on public.users from anon, authenticated;

-- ── 6. Recreate the triggers on the new table ──
drop trigger if exists protect_user_profile_security_fields on public.users;
create trigger protect_user_profile_security_fields
before update on public.users
for each row execute function public.protect_user_profile_security_fields();

drop trigger if exists trg_hash_password on public.users;
create trigger trg_hash_password
before insert or update on public.users
for each row execute function public.handle_password_hash();

-- ── 7. Recreate RLS policies on OTHER tables that reference users, ──
--      so they bind to the NEW users table instead of users_old.
drop policy if exists "Admins can view all products" on public.funeral_products;
create policy "Admins can view all products"
  on public.funeral_products for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can manage all product ratings" on public.funeral_product_ratings;
create policy "Admins can manage all product ratings"
  on public.funeral_product_ratings for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can manage all product feedback" on public.funeral_product_feedback;
create policy "Admins can manage all product feedback"
  on public.funeral_product_feedback for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can insert payment settings" on public.settings;
create policy "Admins can insert payment settings"
  on public.settings for insert to authenticated
  with check (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can update payment settings" on public.settings;
create policy "Admins can update payment settings"
  on public.settings for update to authenticated
  using (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  )
  with check (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can delete payment settings" on public.settings;
create policy "Admins can delete payment settings"
  on public.settings for delete to authenticated
  using (
    key = 'payment_qr_code'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can read payments" on public.shop_payments;
create policy "Admins can read payments"
  on public.shop_payments for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can update payments" on public.shop_payments;
create policy "Admins can update payments"
  on public.shop_payments for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('super_admin', 'admin', 'funeral_admin')
    )
  );

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

drop policy if exists "Superadmins can read audit logs" on public.admin_audit_logs;
create policy "Superadmins can read audit logs"
  on public.admin_audit_logs for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'super_admin'
    )
  );

drop policy if exists "Admins can read support messages" on public.support_messages;
create policy "Admins can read support messages"
  on public.support_messages for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin')
    )
  );

drop policy if exists "Admins can view all requests" on public.funeral_service_requests;
create policy "Admins can view all requests"
  on public.funeral_service_requests for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Admins can update all requests" on public.funeral_service_requests;
create policy "Admins can update all requests"
  on public.funeral_service_requests for update to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

-- ── 8. Remove the old table (no dependencies remain) ──
drop table public.users_old;

commit;

-- ── Refresh PostgREST schema cache so the column order is picked up ──
notify pgrst, 'reload schema';

-- ── Verify ────────────────────────────────────────────
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'users' order by ordinal_position;
-- Expected order: id, email, password, fullName, gender, dateOfBirth,
-- photoURL, role, ..., createdAt, updatedAt
*/
