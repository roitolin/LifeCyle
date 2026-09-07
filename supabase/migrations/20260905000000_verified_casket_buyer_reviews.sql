-- Restrict funeral product ratings and feedback to verified buyers of the
-- exact catalog casket. Client-side checks are only for UX; these policies
-- are the authorization boundary for direct PostgREST/API writes.

begin;

create or replace function public.has_verified_casket_order(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.funeral_service_requests request
      where request."requesterId" = auth.uid()
        and request."productId" = p_product_id::text
        and request."requestType" = 'catalog_product'
        and lower(request.status) in (
          'payment_verified',
          'awaiting_customer_confirmation',
          'completed'
        )
    );
$$;

create or replace function public.is_valid_funeral_review_target(
  p_product_id uuid,
  p_shop_id uuid,
  p_product_key text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.funeral_products product
    where product.id = p_product_id
      and product."shopId" is not distinct from p_shop_id
      and p_product_key = coalesce(product."shopId"::text, 'shop') || ':' || product.id::text
  );
$$;

revoke all on function public.has_verified_casket_order(uuid) from public;
revoke all on function public.is_valid_funeral_review_target(uuid, uuid, text) from public;
grant execute on function public.has_verified_casket_order(uuid) to authenticated;
grant execute on function public.is_valid_funeral_review_target(uuid, uuid, text) to authenticated;

drop policy if exists "Users can submit their own product ratings" on public.funeral_product_ratings;
drop policy if exists "Users can update their own product ratings" on public.funeral_product_ratings;
drop policy if exists "Users can delete their own product ratings" on public.funeral_product_ratings;
drop policy if exists "Admins can manage all product ratings" on public.funeral_product_ratings;
drop policy if exists "Verified buyers can submit product ratings" on public.funeral_product_ratings;
drop policy if exists "Verified buyers can update product ratings" on public.funeral_product_ratings;
drop policy if exists "Admins can moderate product ratings" on public.funeral_product_ratings;

create policy "Verified buyers can submit product ratings"
  on public.funeral_product_ratings for insert to authenticated
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

create policy "Verified buyers can update product ratings"
  on public.funeral_product_ratings for update to authenticated
  using ("userId" = auth.uid())
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

create policy "Users can delete their own product ratings"
  on public.funeral_product_ratings for delete to authenticated
  using ("userId" = auth.uid());

create policy "Admins can moderate product ratings"
  on public.funeral_product_ratings for delete to authenticated
  using (
    exists (
      select 1
      from public.users app_user
      where app_user.id = auth.uid()
        and app_user.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

drop policy if exists "Users can post their own product feedback" on public.funeral_product_feedback;
drop policy if exists "Users can manage their own product feedback" on public.funeral_product_feedback;
drop policy if exists "Admins can manage all product feedback" on public.funeral_product_feedback;
drop policy if exists "Verified buyers can post product feedback" on public.funeral_product_feedback;
drop policy if exists "Verified buyers can update product feedback" on public.funeral_product_feedback;
drop policy if exists "Users can delete their own product feedback" on public.funeral_product_feedback;
drop policy if exists "Admins can moderate product feedback" on public.funeral_product_feedback;

create policy "Verified buyers can post product feedback"
  on public.funeral_product_feedback for insert to authenticated
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

create policy "Verified buyers can update product feedback"
  on public.funeral_product_feedback for update to authenticated
  using ("userId" = auth.uid())
  with check (
    "userId" = auth.uid()
    and public.has_verified_casket_order("productId")
    and public.is_valid_funeral_review_target("productId", "shopId", "productKey")
  );

create policy "Users can delete their own product feedback"
  on public.funeral_product_feedback for delete to authenticated
  using ("userId" = auth.uid());

create policy "Admins can moderate product feedback"
  on public.funeral_product_feedback for delete to authenticated
  using (
    exists (
      select 1
      from public.users app_user
      where app_user.id = auth.uid()
        and app_user.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );

notify pgrst, 'reload schema';

commit;
