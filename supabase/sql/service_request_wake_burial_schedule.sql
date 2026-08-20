-- LifeCycle - WAKE AND BURIAL SCHEDULE
-- Run this once in the Supabase SQL editor before releasing the updated app.

alter table public.funeral_service_requests
  add column if not exists "wakeStartDate" date,
  add column if not exists "wakeEndDate" date,
  add column if not exists "burialTime" time without time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'funeral_service_requests_wake_date_range_check'
      and conrelid = 'public.funeral_service_requests'::regclass
  ) then
    alter table public.funeral_service_requests
      add constraint funeral_service_requests_wake_date_range_check
      check (
        "wakeStartDate" is null
        or "wakeEndDate" is null
        or "wakeEndDate" >= "wakeStartDate"
      ) not valid;
  end if;
end
$$;

alter table public.funeral_service_requests
  validate constraint funeral_service_requests_wake_date_range_check;

comment on column public.funeral_service_requests."wakeStartDate" is
  'First calendar date of the wake in the funeral venue local time.';

comment on column public.funeral_service_requests."wakeEndDate" is
  'Last calendar date of the wake and intended burial date.';

comment on column public.funeral_service_requests."burialTime" is
  'Burial time on wakeEndDate in the funeral venue local time.';

notify pgrst, 'reload schema';
