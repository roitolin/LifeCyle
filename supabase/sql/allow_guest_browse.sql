-- This script adds Row Level Security (RLS) policies to allow anonymous (guest) users
-- to read verified funeral shops and active funeral products.

-- 1. Allow public read access to verified funeral shops
DROP POLICY IF EXISTS "Allow anonymous users to read verified funeral shops" ON public.funeral_shops;
CREATE POLICY "Allow anonymous users to read verified funeral shops"
ON public.funeral_shops FOR SELECT
TO anon, authenticated
USING (status = 'verified');

-- 2. Allow public read access to active funeral products
DROP POLICY IF EXISTS "Allow anonymous users to read active funeral products" ON public.funeral_products;
CREATE POLICY "Allow anonymous users to read active funeral products"
ON public.funeral_products FOR SELECT
TO anon, authenticated
USING (active = true);

-- 3. Allow public read access to funeral product images
DROP POLICY IF EXISTS "Allow anonymous users to read funeral product images" ON public.funeral_product_images;
CREATE POLICY "Allow anonymous users to read funeral product images"
ON public.funeral_product_images FOR SELECT
TO anon, authenticated
USING (true);

-- 4. Allow public read access to funeral product variations
DROP POLICY IF EXISTS "Allow anonymous users to read funeral product variations" ON public.funeral_product_variations;
CREATE POLICY "Allow anonymous users to read funeral product variations"
ON public.funeral_product_variations FOR SELECT
TO anon, authenticated
USING (true);
