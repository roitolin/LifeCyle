alter table public.funeral_shops
  add column if not exists bio text;

alter table public.funeral_shops
  drop constraint if exists funeral_shops_bio_length_check;

alter table public.funeral_shops
  add constraint funeral_shops_bio_length_check
  check (bio is null or char_length(bio) <= 101);

notify pgrst, 'reload schema';
