-- RETIRED SECURITY SCRIPT - DO NOT EXECUTE.
-- Password credentials must remain exclusively in Supabase Auth (auth.users).
-- The former script is retained inside a block comment for historical reference.
/*
-- ═══════════════════════════════════════════════════════
-- LifeCycle — PASSWORD HASHING HELPERS (bcrypt via pgcrypto)
-- Run this in the Supabase SQL editor.
--
-- The app signs users up through Supabase Auth, which already
-- stores bcrypt-hashed passwords in auth.users — never store a
-- plaintext password. This file is for any CUSTOM table that has
-- a `password` column:
--
--   1. hash_password('secret')      -> salted bcrypt hash string
--   2. verify_password('secret', hash) -> true/false
--   3. add_password_hash_trigger('my_table')
--      auto-hashes the `password` column on insert/update so
--      plaintext is never stored.
-- ═══════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Hash a plaintext password (bcrypt, cost 10, salted) ──
-- gen_salt('bf', 10) generates a NEW random salt on every call,
-- so hashing the same password twice produces different hashes.
-- The salt is embedded in the bcrypt hash string itself
-- ($2b$10$<22-char salt><31-char hash>), so verify_password can
-- read it back out of the stored hash — no separate salt column.
create or replace function public.hash_password(password text)
returns text
language sql
immutable
as $$
  select crypt($1, gen_salt('bf', 10));
$$;

-- ── Verify a plaintext password against a stored hash ──
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

-- ── Trigger: hash NEW."password" before insert/update ──
-- Attach to any custom table that has a `password` column.
create or replace function public.handle_password_hash()
returns trigger
language plpgsql
as $$
declare
  new_hash text;
begin
  if NEW."password" is null then
    return NEW;
  end if;

  -- Skip re-hashing if the value is already a bcrypt hash.
  if NEW."password" like '$2a$%' or NEW."password" like '$2b$%' then
    return NEW;
  end if;

  new_hash := public.hash_password(NEW."password");
  NEW."password" := new_hash;
  return NEW;
end;
$$;

-- ── Attach the trigger to a table that has `password` ──
create or replace function public.add_password_hash_trigger(table_name text)
returns void
language plpgsql
as $$
declare
  trigger_name text := 'trg_hash_password';
begin
  execute format('drop trigger if exists %I on public.%I', trigger_name, table_name);
  execute format(
    'create trigger %I before insert or update on public.%I
     for each row execute procedure public.handle_password_hash()',
    trigger_name, table_name
  );
end;
$$;

-- ── Example (only if you actually have a custom table) ──
-- create table if not exists public.my_custom_table (
--   id uuid primary key default gen_random_uuid(),
--   email text not null,
--   password text not null
-- );
-- select public.add_password_hash_trigger('my_custom_table');
--
-- insert into public.my_custom_table (email, password)
-- values ('demo@lifecycle.ph', 'secret123');
--
-- select email, password from public.my_custom_table; -- password is hashed
-- select public.verify_password('secret123', password) as matches
-- from public.my_custom_table; -- true
--
-- Salt proof: same password -> different hash every time:
--   select public.hash_password('secret123'), public.hash_password('secret123');
--   select public.verify_password('secret123', public.hash_password('secret123')) as matches; -- true
*/
