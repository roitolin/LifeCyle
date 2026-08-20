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
on public.users
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Users can create their own profile" on public.users;
create policy "Users can create their own profile"
on public.users
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update their own basic profile" on public.users;
create policy "Users can update their own basic profile"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  "updatedAt" timestamptz not null default now()
);

alter table public.settings enable row level security;

drop policy if exists "Authenticated users can read settings" on public.settings;
create policy "Authenticated users can read settings"
on public.settings
for select
to authenticated
using (true);

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

create index if not exists notifications_user_read_idx
on public.notifications ("userId", read, "createdAt" desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can read their notifications" on public.notifications;
create policy "Users can read their notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = "userId");

drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = "userId")
with check (auth.uid() = "userId");

drop policy if exists "Users can delete their notifications" on public.notifications;
create policy "Users can delete their notifications"
on public.notifications
for delete
to authenticated
using (auth.uid() = "userId");

drop policy if exists "Authenticated users can create notifications" on public.notifications;
create policy "Authenticated users can create notifications"
on public.notifications
for insert
to authenticated
with check (true);
