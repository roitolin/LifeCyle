-- LifeCycle arrangement workspace: reliable notification dedupe, itemized quotes,
-- family collaboration, document tracking, and payment milestones.

alter table public.notifications
  add column if not exists dedupe_key text;

alter table public.funeral_service_requests
  add column if not exists "paymentPlanEnabled" boolean not null default false;

create unique index if not exists notifications_user_dedupe_unique
  on public.notifications ("userId", dedupe_key);

create or replace function public.notify_active_admins(
  p_type text,
  p_title text,
  p_body text,
  p_data jsonb default null,
  p_dedupe_key text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  delivered integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_type not in ('request_pending', 'shop_payment_submitted', 'support_message', 'feedback_new', 'rating_update', 'abuse_report') then
    raise exception 'Unsupported admin notification type.';
  end if;
  if char_length(trim(p_title)) not between 2 and 120 or char_length(trim(p_body)) not between 2 and 500 then
    raise exception 'Invalid notification content.';
  end if;

  insert into public.notifications ("userId", type, title, body, data, read, dedupe_key)
  select id, p_type, trim(p_title), trim(p_body), p_data, false, p_dedupe_key
  from public.users
  where role in ('admin', 'super_admin', 'funeral_admin')
    and coalesce(disabled, false) = false
  on conflict ("userId", dedupe_key) do nothing;

  get diagnostics delivered = row_count;
  return delivered;
end;
$$;

create table if not exists public.service_request_members (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  invited_email text not null,
  display_name text,
  role text not null default 'viewer'
    check (role in ('coordinator', 'payer', 'viewer')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'declined', 'revoked')),
  invited_by uuid not null references public.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists service_request_members_request_email_unique
  on public.service_request_members (service_request_id, lower(invited_email));
create index if not exists service_request_members_user_status
  on public.service_request_members (user_id, status, updated_at desc);

create or replace function public.is_service_request_primary_participant(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.funeral_service_requests request
    where request.id = p_request_id
      and (
        request."requesterId" = auth.uid()
        or request."shopId" = auth.uid()
        or exists (
          select 1 from public.users actor
          where actor.id = auth.uid()
            and actor.role in ('admin', 'super_admin', 'funeral_admin')
        )
      )
  );
$$;

create or replace function public.is_service_request_owner(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funeral_service_requests
    where id = p_request_id and "requesterId" = auth.uid()
  );
$$;

create or replace function public.is_service_request_shop_or_admin(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.funeral_service_requests request
    where request.id = p_request_id
      and (
        request."shopId" = auth.uid()
        or exists (
          select 1 from public.users actor
          where actor.id = auth.uid()
            and actor.role in ('admin', 'super_admin', 'funeral_admin')
        )
      )
  );
$$;

create or replace function public.can_access_service_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_request_primary_participant(p_request_id)
    or exists (
      select 1 from public.service_request_members member
      where member.service_request_id = p_request_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    );
$$;

create or replace function public.can_submit_service_payment(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_service_request_owner(p_request_id)
    or exists (
      select 1 from public.service_request_members member
      where member.service_request_id = p_request_id
        and member.user_id = auth.uid()
        and member.status = 'active'
        and member.role in ('coordinator', 'payer')
    );
$$;

alter table public.service_request_members enable row level security;

drop policy if exists "Participants can view arrangement members" on public.service_request_members;
create policy "Participants can view arrangement members"
  on public.service_request_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_service_request_primary_participant(service_request_id)
  );

drop policy if exists "Owners and admins can update arrangement members" on public.service_request_members;
create policy "Owners and admins can update arrangement members"
  on public.service_request_members for update to authenticated
  using (public.is_service_request_owner(service_request_id))
  with check (public.is_service_request_owner(service_request_id));

create or replace function public.guard_service_request_member_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.service_request_id is distinct from new.service_request_id
     or old.user_id is distinct from new.user_id
     or old.invited_email is distinct from new.invited_email
     or old.invited_by is distinct from new.invited_by
     or old.invited_at is distinct from new.invited_at then
    raise exception 'Invitation identity cannot be changed.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_service_request_member_update on public.service_request_members;
create trigger guard_service_request_member_update
before update on public.service_request_members
for each row execute function public.guard_service_request_member_update();

drop policy if exists "Family members can view shared service requests" on public.funeral_service_requests;
create policy "Family members can view shared service requests"
  on public.funeral_service_requests for select to authenticated
  using (
    exists (
      select 1 from public.service_request_members member
      where member.service_request_id = id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  );

create or replace function public.invite_service_request_member(
  p_request_id uuid,
  p_email text,
  p_role text default 'viewer'
)
returns public.service_request_members
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  invited_user public.users%rowtype;
  result public.service_request_members%rowtype;
begin
  if not public.is_service_request_owner(p_request_id) then
    raise exception 'Only the family coordinator can invite arrangement members.';
  end if;
  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid account email address.';
  end if;
  if p_role not in ('coordinator', 'payer', 'viewer') then
    raise exception 'Invalid family member role.';
  end if;

  select * into invited_user from public.users
  where lower(email) = normalized_email
  limit 1;

  if invited_user.id is null then
    raise exception 'That email does not have a LifeCycle account yet.';
  end if;
  if invited_user.id = auth.uid() then
    raise exception 'You already coordinate this arrangement.';
  end if;

  insert into public.service_request_members (
    service_request_id, user_id, invited_email, display_name, role, status, invited_by
  ) values (
    p_request_id,
    invited_user.id,
    normalized_email,
    coalesce(invited_user."fullName", invited_user.email),
    p_role,
    'invited',
    auth.uid()
  )
  on conflict (service_request_id, lower(invited_email)) do update set
    user_id = excluded.user_id,
    display_name = excluded.display_name,
    role = excluded.role,
    status = 'invited',
    invited_by = auth.uid(),
    invited_at = now(),
    responded_at = null,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.respond_service_request_invite(
  p_member_id uuid,
  p_accept boolean
)
returns public.service_request_members
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.service_request_members%rowtype;
begin
  update public.service_request_members
  set status = case when p_accept then 'active' else 'declined' end,
      responded_at = now(),
      updated_at = now()
  where id = p_member_id
    and user_id = auth.uid()
    and status = 'invited'
  returning * into result;

  if result.id is null then
    raise exception 'This invitation is no longer available.';
  end if;
  return result;
end;
$$;

create table if not exists public.service_request_quotes (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  shop_id uuid not null references public.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  notes text,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  expires_at timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_request_id, version)
);

create table if not exists public.service_request_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.service_request_quotes(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 2 and 120),
  description text,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  included boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists service_request_quotes_request_updated
  on public.service_request_quotes (service_request_id, updated_at desc);
create index if not exists service_request_quote_items_quote_sort
  on public.service_request_quote_items (quote_id, sort_order, created_at);

alter table public.service_request_quotes enable row level security;
alter table public.service_request_quote_items enable row level security;

create policy "Participants can view service quotes"
  on public.service_request_quotes for select to authenticated
  using (public.can_access_service_request(service_request_id));
create policy "Shops can create service quotes"
  on public.service_request_quotes for insert to authenticated
  with check (
    public.is_service_request_shop_or_admin(service_request_id)
    and shop_id = (select "shopId" from public.funeral_service_requests where id = service_request_id)
  );
create policy "Participants can update service quotes"
  on public.service_request_quotes for update to authenticated
  using (public.can_access_service_request(service_request_id))
  with check (public.can_access_service_request(service_request_id));
create policy "Shops can delete draft service quotes"
  on public.service_request_quotes for delete to authenticated
  using (
    status = 'draft'
    and public.is_service_request_shop_or_admin(service_request_id)
  );

create policy "Participants can view quote items"
  on public.service_request_quote_items for select to authenticated
  using (exists (
    select 1 from public.service_request_quotes quote
    where quote.id = quote_id and public.can_access_service_request(quote.service_request_id)
  ));
create policy "Shops can create quote items"
  on public.service_request_quote_items for insert to authenticated
  with check (exists (
    select 1 from public.service_request_quotes quote
    where quote.id = quote_id
      and quote.status = 'draft'
      and public.is_service_request_shop_or_admin(quote.service_request_id)
  ));
create policy "Shops can update quote items"
  on public.service_request_quote_items for update to authenticated
  using (exists (
    select 1 from public.service_request_quotes quote
    where quote.id = quote_id
      and quote.status = 'draft'
      and public.is_service_request_shop_or_admin(quote.service_request_id)
  ));
create policy "Shops can delete quote items"
  on public.service_request_quote_items for delete to authenticated
  using (exists (
    select 1 from public.service_request_quotes quote
    where quote.id = quote_id
      and quote.status = 'draft'
      and public.is_service_request_shop_or_admin(quote.service_request_id)
  ));

create or replace function public.recalculate_service_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_quote_id uuid := coalesce(new.quote_id, old.quote_id);
begin
  update public.service_request_quotes quote
  set subtotal = totals.subtotal,
      total = greatest(totals.subtotal - quote.discount, 0),
      updated_at = now()
  from (
    select coalesce(sum(quantity * unit_price) filter (where included), 0) as subtotal
    from public.service_request_quote_items
    where quote_id = target_quote_id
  ) totals
  where quote.id = target_quote_id;
  return null;
end;
$$;

drop trigger if exists recalculate_service_quote_items on public.service_request_quote_items;
create trigger recalculate_service_quote_items
after insert or update or delete on public.service_request_quote_items
for each row execute function public.recalculate_service_quote();

create or replace function public.guard_service_quote_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.service_request_id is distinct from new.service_request_id
     or old.shop_id is distinct from new.shop_id
     or old.version is distinct from new.version
     or old.created_by is distinct from new.created_by then
    raise exception 'Quote identity cannot be changed.';
  end if;

  if public.is_service_request_shop_or_admin(old.service_request_id) then
    if old.status <> 'draft' and new.status is distinct from old.status then
      raise exception 'Only a draft quote can be sent or changed by the shop.';
    end if;
    if new.status = 'sent' and old.status = 'draft' then
      new.sent_at := now();
    end if;
    new.total := greatest(new.subtotal - new.discount, 0);
  elsif public.is_service_request_owner(old.service_request_id) then
    if old.status <> 'sent' or new.status not in ('accepted', 'declined') then
      raise exception 'The family may only accept or decline a sent quote.';
    end if;
    if new.subtotal is distinct from old.subtotal
       or new.discount is distinct from old.discount
       or new.total is distinct from old.total
       or new.notes is distinct from old.notes
       or new.expires_at is distinct from old.expires_at then
      raise exception 'The family cannot change quote pricing.';
    end if;
    new.responded_at := now();
  else
    raise exception 'You cannot update this quote.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_service_quote_update on public.service_request_quotes;
create trigger guard_service_quote_update
before update on public.service_request_quotes
for each row execute function public.guard_service_quote_update();

create table if not exists public.service_request_documents (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  category text not null default 'other'
    check (category in ('civil_registry', 'burial', 'identity', 'venue', 'contract', 'other')),
  status text not null default 'needed'
    check (status in ('needed', 'in_progress', 'ready', 'submitted', 'verified', 'not_applicable')),
  required boolean not null default true,
  assignee_id uuid references public.users(id) on delete set null,
  due_date date,
  notes text,
  file_url text,
  created_by uuid not null references public.users(id),
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_request_documents_request_title_unique
  on public.service_request_documents (service_request_id, lower(title));
create index if not exists service_request_documents_request_status
  on public.service_request_documents (service_request_id, status, due_date);

alter table public.service_request_documents enable row level security;

create policy "Participants can view arrangement documents"
  on public.service_request_documents for select to authenticated
  using (public.can_access_service_request(service_request_id));
create policy "Participants can create arrangement documents"
  on public.service_request_documents for insert to authenticated
  with check (
    public.can_access_service_request(service_request_id)
    and created_by = auth.uid()
  );
create policy "Participants can update arrangement documents"
  on public.service_request_documents for update to authenticated
  using (public.can_access_service_request(service_request_id))
  with check (public.can_access_service_request(service_request_id));
create policy "Owners and shops can delete arrangement documents"
  on public.service_request_documents for delete to authenticated
  using (public.is_service_request_primary_participant(service_request_id));

create or replace function public.touch_service_request_document()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.service_request_id is distinct from new.service_request_id
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Document identity cannot be changed.';
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    if not public.is_service_request_shop_or_admin(old.service_request_id) then
      raise exception 'Only the assigned shop can verify a document.';
    end if;
    new.verified_by := auth.uid();
    new.verified_at := now();
  elsif new.status <> 'verified' then
    new.verified_by := null;
    new.verified_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_service_request_document on public.service_request_documents;
create trigger touch_service_request_document
before update on public.service_request_documents
for each row execute function public.touch_service_request_document();

create or replace function public.ensure_service_request_default_documents(p_request_id uuid)
returns setof public.service_request_documents
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_service_request(p_request_id) then
    raise exception 'You cannot access this arrangement.';
  end if;

  insert into public.service_request_documents (
    service_request_id, title, category, required, created_by
  ) values
    (p_request_id, 'Death Certificate', 'civil_registry', true, auth.uid())
  on conflict (service_request_id, lower(title)) do nothing;

  return query
    select * from public.service_request_documents
    where service_request_id = p_request_id
    order by required desc, due_date nulls last, created_at;
end;
$$;

create table if not exists public.service_payment_milestones (
  id uuid primary key default gen_random_uuid(),
  service_request_id uuid not null references public.funeral_service_requests(id) on delete cascade,
  quote_id uuid references public.service_request_quotes(id) on delete set null,
  label text not null check (char_length(trim(label)) between 2 and 120),
  amount numeric(12,2) not null check (amount > 0),
  due_date date,
  status text not null default 'pending'
    check (status in ('pending', 'submitted', 'verified', 'waived', 'refunded')),
  payment_method text,
  payer_name text,
  reference_number text,
  proof_image_url text,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  notes text,
  sort_order integer not null default 0,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_payment_milestones_request_label_unique
  on public.service_payment_milestones (service_request_id, lower(label));
create unique index if not exists service_payment_milestones_reference_unique
  on public.service_payment_milestones (upper(trim(reference_number)))
  where nullif(trim(reference_number), '') is not null;
create index if not exists service_payment_milestones_request_sort
  on public.service_payment_milestones (service_request_id, sort_order, due_date);

alter table public.service_payment_milestones enable row level security;

create policy "Participants can view payment milestones"
  on public.service_payment_milestones for select to authenticated
  using (public.can_access_service_request(service_request_id));
create policy "Shops can create payment milestones"
  on public.service_payment_milestones for insert to authenticated
  with check (
    public.is_service_request_shop_or_admin(service_request_id)
    and created_by = auth.uid()
  );
create policy "Participants can update payment milestones"
  on public.service_payment_milestones for update to authenticated
  using (public.can_access_service_request(service_request_id))
  with check (public.can_access_service_request(service_request_id));
create policy "Shops can delete pending payment milestones"
  on public.service_payment_milestones for delete to authenticated
  using (
    status = 'pending'
    and public.is_service_request_shop_or_admin(service_request_id)
  );

create or replace function public.guard_service_payment_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.service_request_id is distinct from new.service_request_id
     or old.quote_id is distinct from new.quote_id
     or old.created_by is distinct from new.created_by
     or old.created_at is distinct from new.created_at then
    raise exception 'Payment milestone identity cannot be changed.';
  end if;

  if public.is_service_request_shop_or_admin(old.service_request_id) then
    if new.status = 'verified' and old.status is distinct from 'verified' then
      if old.status <> 'submitted' then
        raise exception 'Only a submitted payment can be verified.';
      end if;
      new.verified_by := auth.uid();
      new.verified_at := now();
    end if;
  elsif public.can_submit_service_payment(old.service_request_id) then
    if old.status <> 'pending' or new.status <> 'submitted' then
      raise exception 'Family members may only submit pending milestones.';
    end if;
    if new.label is distinct from old.label
       or new.amount is distinct from old.amount
       or new.due_date is distinct from old.due_date
       or new.sort_order is distinct from old.sort_order then
      raise exception 'Payment terms cannot be changed by the family.';
    end if;
    if nullif(trim(coalesce(new.reference_number, '')), '') is null then
      raise exception 'A transaction reference is required.';
    end if;
    if nullif(trim(coalesce(new.proof_image_url, '')), '') is null then
      raise exception 'A payment receipt image is required.';
    end if;
    new.submitted_by := auth.uid();
    new.submitted_at := now();
  else
    raise exception 'You cannot update this payment milestone.';
  end if;

  new.reference_number := nullif(upper(regexp_replace(trim(coalesce(new.reference_number, '')), '[^A-Za-z0-9-]', '', 'g')), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_service_payment_milestone on public.service_payment_milestones;
create trigger guard_service_payment_milestone
before update on public.service_payment_milestones
for each row execute function public.guard_service_payment_milestone();

create or replace function public.create_quote_payment_plan(p_quote_id uuid)
returns setof public.service_payment_milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.service_request_quotes%rowtype;
  deposit_amount numeric(12,2);
begin
  select * into quote_row from public.service_request_quotes where id = p_quote_id;
  if quote_row.id is null or quote_row.status <> 'accepted' then
    raise exception 'Accept the quote before creating its payment plan.';
  end if;
  if not public.is_service_request_shop_or_admin(quote_row.service_request_id) then
    raise exception 'Only the assigned shop can create the payment plan.';
  end if;

  deposit_amount := round(quote_row.total * 0.5, 2);
  insert into public.service_payment_milestones (
    service_request_id, quote_id, label, amount, status, sort_order, created_by
  ) values
    (quote_row.service_request_id, quote_row.id, 'Deposit', deposit_amount, 'pending', 10, auth.uid()),
    (quote_row.service_request_id, quote_row.id, 'Final balance', quote_row.total - deposit_amount, 'pending', 20, auth.uid())
  on conflict (service_request_id, lower(label)) do nothing;

  update public.funeral_service_requests
  set "paymentPlanEnabled" = true,
      "paymentAmount" = quote_row.total,
      "updatedAt" = now()
  where id = quote_row.service_request_id;

  return query
    select * from public.service_payment_milestones
    where service_request_id = quote_row.service_request_id
    order by sort_order, created_at;
end;
$$;

create or replace function public.sync_service_payment_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_count integer;
  plan_total numeric(12,2);
  latest_submission timestamptz;
begin
  if new.status <> 'verified' or old.status = 'verified' then return new; end if;

  select
    count(*) filter (where status not in ('verified', 'waived')),
    coalesce(sum(amount) filter (where status <> 'waived'), 0),
    max(submitted_at)
  into pending_count, plan_total, latest_submission
  from public.service_payment_milestones
  where service_request_id = new.service_request_id;

  if pending_count = 0 then
    update public.funeral_service_requests
    set status = 'payment_verified',
        "paymentPlanEnabled" = true,
        "paymentAmount" = plan_total,
        "paymentSubmittedAt" = coalesce("paymentSubmittedAt", latest_submission),
        "paymentVerifiedAt" = now(),
        "updatedAt" = now()
    where id = new.service_request_id
      and status in ('accepted_by_shop', 'awaiting_payment', 'payment_submitted');
  end if;
  return new;
end;
$$;

drop trigger if exists sync_service_payment_plan on public.service_payment_milestones;
create trigger sync_service_payment_plan
after update of status on public.service_payment_milestones
for each row execute function public.sync_service_payment_plan();

grant execute on function public.invite_service_request_member(uuid, text, text) to authenticated;
grant execute on function public.notify_active_admins(text, text, text, jsonb, text) to authenticated;
grant execute on function public.respond_service_request_invite(uuid, boolean) to authenticated;
grant execute on function public.ensure_service_request_default_documents(uuid) to authenticated;
grant execute on function public.create_quote_payment_plan(uuid) to authenticated;

notify pgrst, 'reload schema';
