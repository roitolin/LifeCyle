-- Securely enqueue a push request whenever a notification is inserted.
-- The shared webhook secret is generated inside Postgres and encrypted in Vault;
-- no API or service-role key is stored in source control.

create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'lifecycle_push_notification_webhook_secret'
  ) then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') ||
        replace(gen_random_uuid()::text, '-', ''),
      'lifecycle_push_notification_webhook_secret',
      'Authenticates notifications-table webhooks sent to the push Edge Function.'
    );
  end if;
end;
$$;

create or replace function public.verify_push_notification_webhook_secret(
  p_secret text
)
returns boolean
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select p_secret is not null and exists (
    select 1
    from vault.decrypted_secrets
    where name = 'lifecycle_push_notification_webhook_secret'
      and decrypted_secret = p_secret
  );
$$;

revoke all on function public.verify_push_notification_webhook_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_push_notification_webhook_secret(text)
  to service_role;

create or replace function public.enqueue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret
  into strict webhook_secret
  from vault.decrypted_secrets
  where name = 'lifecycle_push_notification_webhook_secret';

  perform net.http_post(
    url := 'https://axwwihzwvhkfvbglgopj.supabase.co/functions/v1/push-notification',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Lifecycle-Webhook-Secret', webhook_secret
    ),
    timeout_milliseconds := 10000
  );

  return new;
exception
  when others then
    raise warning 'Unable to enqueue notification push webhook: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.enqueue_notification_push()
  from public, anon, authenticated;

drop trigger if exists lifecycle_push_notification_webhook
  on public.notifications;
create trigger lifecycle_push_notification_webhook
  after insert on public.notifications
  for each row
  execute function public.enqueue_notification_push();

notify pgrst, 'reload schema';
