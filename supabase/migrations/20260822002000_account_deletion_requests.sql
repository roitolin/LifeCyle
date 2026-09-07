-- A durable, auditable account-deletion queue. Actual Auth user removal stays
-- server/admin controlled; no service-role key is exposed to the mobile app.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  email_snapshot text not null,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'approved', 'rejected', 'cancelled', 'completed')),
  reason text not null,
  admin_note text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null
);

create unique index if not exists account_deletion_one_active_request
  on public.account_deletion_requests (user_id)
  where user_id is not null and status in ('pending', 'in_review', 'approved');

create index if not exists account_deletion_status_requested
  on public.account_deletion_requests (status, requested_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "Users can read their deletion requests"
  on public.account_deletion_requests;
create policy "Users can read their deletion requests"
  on public.account_deletion_requests for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Users can create deletion requests"
  on public.account_deletion_requests;
create policy "Users can create deletion requests"
  on public.account_deletion_requests for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users and admins can update deletion requests"
  on public.account_deletion_requests;
create policy "Users and admins can update deletion requests"
  on public.account_deletion_requests for update to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.users
      where id = auth.uid()
        and role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

create or replace function public.guard_account_deletion_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_is_admin boolean := false;
  actor_is_service boolean := auth.role() = 'service_role';
  actor_email text;
begin
  select exists (
    select 1 from public.users
    where id = actor_id
      and role in ('admin', 'super_admin', 'funeral_admin')
  ) into actor_is_admin;

  if tg_op = 'INSERT' then
    if actor_id is null or actor_id is distinct from new.user_id then
      raise exception 'You can request deletion only for your signed-in account.';
    end if;
    if nullif(trim(new.reason), '') is null or char_length(trim(new.reason)) < 10 then
      raise exception 'Explain the deletion request in at least 10 characters.';
    end if;

    select coalesce(nullif(trim(email), ''), actor_id::text)
    into actor_email
    from public.users
    where id = actor_id;

    new.email_snapshot := coalesce(actor_email, actor_id::text);
    new.status := 'pending';
    new.reason := trim(new.reason);
    new.admin_note := null;
    new.requested_at := now();
    new.updated_at := now();
    new.resolved_at := null;
    new.resolved_by := null;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.email_snapshot is distinct from old.email_snapshot
     or new.reason is distinct from old.reason
     or new.requested_at is distinct from old.requested_at then
    raise exception 'Deletion request identity and reason cannot be changed.';
  end if;

  if actor_id = old.user_id and not actor_is_admin then
    if old.status <> 'pending' or new.status <> 'cancelled' then
      raise exception 'You may only cancel a pending deletion request.';
    end if;
    new.admin_note := null;
  elsif actor_is_admin or actor_is_service then
    if old.status = 'pending' and new.status in ('in_review', 'approved', 'rejected') then
      null;
    elsif old.status = 'in_review' and new.status in ('approved', 'rejected') then
      null;
    elsif old.status = 'approved' and new.status = 'completed' then
      null;
    else
      raise exception 'Invalid deletion-request transition: % -> %', old.status, new.status;
    end if;
    if new.status = 'rejected' and nullif(trim(new.admin_note), '') is null then
      raise exception 'A rejection explanation is required.';
    end if;
    new.admin_note := nullif(trim(new.admin_note), '');
  else
    raise exception 'You cannot update this deletion request.';
  end if;

  new.updated_at := now();
  new.resolved_at := case
    when new.status in ('rejected', 'cancelled', 'completed') then now()
    else null
  end;
  new.resolved_by := case
    when new.status = 'cancelled' then old.user_id
    else coalesce(actor_id, new.resolved_by)
  end;
  return new;
end;
$$;

drop trigger if exists guard_account_deletion_request
  on public.account_deletion_requests;
create trigger guard_account_deletion_request
before insert or update on public.account_deletion_requests
for each row execute function public.guard_account_deletion_request();

create or replace function public.notify_account_deletion_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications ("userId", type, title, body, data, read)
    select
      users.id,
      'account_deletion_requested',
      'Account Deletion Requested',
      new.email_snapshot || ' submitted an account deletion request.',
      jsonb_build_object('deletionRequestId', new.id, 'userId', new.user_id),
      false
    from public.users users
    where users.role in ('admin', 'super_admin');
  elsif new.status is distinct from old.status
        and new.user_id is not null
        and new.status <> 'cancelled' then
    insert into public.notifications ("userId", type, title, body, data, read)
    values (
      new.user_id,
      'account_deletion_updated',
      'Deletion Request Updated',
      'Your account deletion request is now ' || replace(new.status, '_', ' ') || '.',
      jsonb_build_object('deletionRequestId', new.id, 'status', new.status),
      false
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_account_deletion_change
  on public.account_deletion_requests;
create trigger notify_account_deletion_change
after insert or update of status on public.account_deletion_requests
for each row execute function public.notify_account_deletion_change();

notify pgrst, 'reload schema';
