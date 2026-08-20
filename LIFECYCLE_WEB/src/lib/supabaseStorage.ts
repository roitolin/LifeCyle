import { supabase } from '@/lib/supabase'

const STORAGE_BUCKET = 'avatars'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function imageExtension(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (extension && extension.length <= 5) return extension
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/heic') return 'heic'
  if (file.type === 'image/heif') return 'heif'
  return 'jpg'
}

export async function uploadCertificateWeb(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Please choose a JPEG, PNG, WebP, HEIC, or HEIF image.')
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('The image is too large. Please choose an image smaller than 10 MB.')
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!userData.user) throw new Error('You must be signed in to upload an image.')

  const objectName =
    Date.now() + '-' + globalThis.crypto.randomUUID() + '.' + imageExtension(file)
  const objectPath = 'service-media/' + userData.user.id + '/' + objectName
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      cacheControl: '3600',
      upsert: false,
    })

  if (uploadError) {
    throw new Error('Supabase Storage upload failed: ' + uploadError.message)
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath)
  if (!data.publicUrl) throw new Error('Supabase Storage did not return an image URL.')
  return data.publicUrl
}
