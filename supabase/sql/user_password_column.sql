-- ═══════════════════════════════════════════════════════
-- LifeCycle — PASSWORD COLUMN ON public.users (hashed + salted)
-- Run this in the Supabase SQL editor AFTER password_hashing.sql
-- (this file is self-contained, so it can also run alone).
--
-- Adds a `password` column to public.users that only ever stores
-- a salted bcrypt hash:
--
--   1. handle_password_hash trigger: if anything writes a
--      plaintext password to the column, it is bcrypt-hashed
--      (with a fresh random salt) before it is stored.
--   2. sync_auth_user_password trigger: copies Supabase's own
--      bcrypt hash from auth.users into public.users on signup
--      and on password change, so the column is populated with
--      a hashed value WITHOUT the client ever sending plaintext.
--   3. Backfill existing accounts with their auth hash.
--
-- The column is intentionally not exposed separately; bcrypt is
-- one-way, so the stored value cannot be reversed even if read.
-- Login still happens through Supabase Auth (supabase.auth) —
-- this column is a hashed mirror, never used for authentication.
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Helpers (idempotent; also defined in password_hashing.sql) ──
create or replace function public.hash_password(password text)
returns text
language sql
immutable
as $$
  select crypt($1, gen_salt('bf', 10));
$$;

create or replace function public.verify_password(
  password text,
  password_hash text
)
returns boolean
language sql
immutable
as $$
  select crypt($1, $2) = $2;
$$;

-- Before insert/update: hash NEW."password" unless already a bcrypt hash.
create or replace function public.handle_password_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  new_hash text;
begin
  if new."password" is null then
    return new;
  end if;

  if new."password" like '$2a$%' or new."password" like '$2b$%' then
    return new;
  end if;

  new_hash := public.hash_password(new."password");
  new."password" := new_hash;
  return new;
end;
$function$;

-- ── 1. Add the column ─────────────────────────────────
alter table public.users
  add column if not exists password text;

comment on column public.users.password is
  'Salted bcrypt hash only. Mirrors the Supabase auth hash; never plaintext and never used for login.';

-- ── 2. Hash any plaintext written to the column ───────
drop trigger if exists trg_hash_password on public.users;
create trigger trg_hash_password
before insert or update on public.users
for each row execute function public.handle_password_hash();

-- ── 3. Mirror the Supabase auth hash (bcrypt + salt) ──
-- Fires after on_auth_user_created_profile (alphabetical order),
-- so the profile row already exists when the hash is copied.
create or replace function public.sync_auth_user_password()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.encrypted_password is null or new.encrypted_password = '' then
    return new; -- OAuth-only account has no password to mirror.
  end if;

  update public.users
    set password = new.encrypted_password
    where id = new.id
      and password is distinct from new.encrypted_password;

  return new;
end;
$function$;

drop trigger if exists on_auth_user_created_profile_sync_password on auth.users;
create trigger on_auth_user_created_profile_sync_password
after insert or update on auth.users
for each row execute function public.sync_auth_user_password();

-- ── 4. Backfill existing accounts ─────────────────────
update public.users as profile
  set password = auth_user.encrypted_password
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.encrypted_password is not null
  and auth_user.encrypted_password <> ''
  and (profile.password is null or profile.password = '');

-- ── Verify ────────────────────────────────────────────
-- select id, email, password from public.users limit 5;
-- select public.verify_password('your-plain-password', password) as matches
-- from public.users limit 5;
