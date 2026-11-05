-- Keep only super_admin and admin as administrator roles. Shop ownership is
-- represented by funeral_shops, not by an administrator role.
begin;

-- Preserve access for any legacy accounts in other environments.
update public.users
set role = 'admin'
where role = 'funeral_admin';

alter table public.users drop constraint if exists users_role_allowed;
alter table public.users add constraint users_role_allowed
  check (role in ('user', 'funeral', 'admin', 'super_admin'));

-- Reuse the current policy/function definitions so this migration also works
-- when earlier migrations have changed their bodies in another environment.
do $migration$
declare
  policy_row record;
  function_row record;
  statement text;
  definition text;
begin
  for policy_row in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual ilike '%funeral_admin%' or with_check ilike '%funeral_admin%')
  loop
    statement := format(
      'alter policy %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
    if policy_row.qual is not null then
      statement := statement || ' using (' ||
        replace(policy_row.qual, ', ''funeral_admin''::text', '') || ')';
    end if;
    if policy_row.with_check is not null then
      statement := statement || ' with check (' ||
        replace(policy_row.with_check, ', ''funeral_admin''::text', '') || ')';
    end if;
    if statement ilike '%funeral_admin%' then
      raise exception 'Could not remove funeral_admin from policy %.%',
        policy_row.tablename, policy_row.policyname;
    end if;
    execute statement;
  end loop;

  for function_row in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private')
      and pg_get_functiondef(p.oid) ilike '%funeral_admin%'
  loop
    definition := pg_get_functiondef(function_row.oid);
    if function_row.proname = 'publish_announcement' then
      -- Shop owners are users with a funeral_shops row. Send each audience to
      -- the matching accounts instead of treating funeral_admin as a shop role.
      definition := replace(
        definition,
        $old$when 'users' then recipient.role = 'user'$old$,
        $new$when 'users' then recipient.role = 'user'
        and not exists (
          select 1 from public.funeral_shops shop where shop.id = recipient.id
        )$new$
      );
      definition := replace(
        definition,
        $old$when 'funeral_shops' then recipient.role = 'funeral_admin'$old$,
        $new$when 'funeral_shops' then exists (
          select 1 from public.funeral_shops shop where shop.id = recipient.id
        )$new$
      );
    else
      definition := replace(definition, ', ''funeral_admin''', '');
    end if;
    if definition ilike '%funeral_admin%' then
      raise exception 'Could not remove funeral_admin from function %',
        function_row.oid::regprocedure;
    end if;
    execute definition;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
