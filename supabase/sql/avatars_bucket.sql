-- ═══════════════════════════════════════════════════════
-- LifeCycle — CREATE STORAGE BUCKET: avatars
-- Run this in the Supabase SQL editor.
-- Fixes: "Upload failed: Bucket not found"
-- ═══════════════════════════════════════════════════════

-- 1. Create the public media bucket used by mobile and web uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage policies for the avatars bucket

-- Public read access for profile and service images referenced by public URLs.
drop policy if exists "Public can read avatars" on storage.objects;
create policy "Public can read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Signed-in users can upload application images.
drop policy if exists "Authenticated users can upload avatars" on storage.objects;
create policy "Authenticated users can upload avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars');

-- Any signed-in user can update/overwrite profile pictures
drop policy if exists "Authenticated users can update avatars" on storage.objects;
create policy "Authenticated users can update avatars"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars');

-- Any signed-in user can delete profile pictures
drop policy if exists "Authenticated users can delete avatars" on storage.objects;
create policy "Authenticated users can delete avatars"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars');
