alter table public.funeral_shop_packages
  add column if not exists items jsonb not null default '[]'::jsonb;

update public.funeral_shop_packages as package
set items = (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', legacy_item.item_id,
        'name', legacy_item.item_name,
        'imageUrl', legacy_item.image_url
      )
      order by legacy_item.display_order
    ),
    '[]'::jsonb
  )
  from (
    values
      (1, 'legacy-flowers', 'Flowers', package."flowersImageUrl"),
      (2, 'legacy-candles', 'Candles', package."candlesImageUrl"),
      (3, 'legacy-curtains', 'Curtains', package."curtainsImageUrl"),
      (4, 'legacy-vehicle', 'Vehicle', package."vehicleImageUrl")
  ) as legacy_item(display_order, item_id, item_name, image_url)
  where legacy_item.image_url is not null
    and btrim(legacy_item.image_url) <> ''
)
where package.items = '[]'::jsonb;

alter table public.funeral_shop_packages
  drop constraint if exists funeral_shop_packages_items_is_array;

alter table public.funeral_shop_packages
  add constraint funeral_shop_packages_items_is_array
  check (jsonb_typeof(items) = 'array');

comment on column public.funeral_shop_packages.items is
  'Owner-defined package inclusions. Each array entry contains id, name, and imageUrl.';
