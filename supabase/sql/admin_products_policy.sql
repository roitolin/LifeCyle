-- ═══════════════════════════════════════════════════════
-- LifeCycle — ADMIN RLS POLICY: VIEW ALL SHOP PRODUCTS
-- Run this in the Supabase SQL editor so admin roles can
-- see every product across all shops (including inactive
-- / sold-out items owned by other shops).
-- ═══════════════════════════════════════════════════════

drop policy if exists "Admins can view all products" on public.funeral_products;
create policy "Admins can view all products"
  on public.funeral_products for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin', 'funeral_admin')
    )
  );
