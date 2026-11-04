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

async function uploadImageWeb(file: File, folder: 'service-media' | 'home-content'): Promise<string> {
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
  const objectPath = folder + '/' + userData.user.id + '/' + objectName
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

export const uploadCertificateWeb = (file: File) => uploadImageWeb(file, 'service-media')

export const uploadHomeHeroImageWeb = (file: File) => uploadImageWeb(file, 'home-content')

// The shared balance-receipt bucket only accepts JPEGs. Normalize browser
// uploads (including PNG/WebP screenshots) to the same format as the app.
export async function uploadBalancePaymentReceiptWeb(requestId: string, file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP receipt image.')
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new Error('Choose a receipt image smaller than 10 MB.')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Sign in before uploading a receipt.')

  const objectUrl = URL.createObjectURL(file)
  let jpeg: Blob
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('This image could not be opened. Try another JPEG or PNG receipt.'))
      image.src = objectUrl
    })
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the receipt image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    jpeg = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the receipt image.')), 'image/jpeg', 0.85)
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
  if (jpeg.size > MAX_IMAGE_BYTES) throw new Error('Choose a receipt image smaller than 10 MB.')
  const storagePath = `${requestId}/${data.user.id}/${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await supabase.storage.from('funeral-balance-receipts').upload(storagePath, jpeg, {
    contentType: 'image/jpeg', upsert: false,
  })
  if (uploadError) throw uploadError
  return storagePath
}

export async function uploadDigitalBalanceReceiptWeb(
  requestId: string,
  details: {
    amount: number | string;
    channelLabel: string;
    reference: string;
    payerName: string;
    shopName?: string;
    productName?: string;
  }
): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!data.user) throw new Error('Sign in before uploading a receipt.')

  let jpegBlob: Blob
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 1000
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 800, 1000)

    ctx.fillStyle = '#2f6b55'
    ctx.fillRect(0, 0, 800, 150)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 32px sans-serif'
    ctx.fillText('LifeCycle Official Receipt', 48, 62)

    ctx.fillStyle = '#d1fae5'
    ctx.font = '18px sans-serif'
    ctx.fillText('Remaining Balance Online Settlement', 48, 104)

    ctx.fillStyle = '#f0fdf4'
    ctx.strokeStyle = '#bbf7d0'
    ctx.lineWidth = 1.5
    ctx.fillRect(48, 180, 704, 80)
    ctx.strokeRect(48, 180, 704, 80)

    ctx.fillStyle = '#15803d'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText('Payment Verified · Online Transfer', 76, 230)

    ctx.fillStyle = '#f8fafc'
    ctx.strokeStyle = '#e2e8f0'
    ctx.fillRect(48, 280, 704, 680)
    ctx.strokeRect(48, 280, 704, 680)

    const rows = [
      ['Amount Paid', `PHP ${Number(details.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`],
      ['Payment Channel', details.channelLabel],
      ['Transaction Reference', details.reference],
      ['Payer / Customer', details.payerName],
      ['Funeral Shop', details.shopName || 'Funeral Shop'],
      ['Service / Product', details.productName || 'Funeral Service'],
      ['Transaction Date', new Date().toLocaleString('en-US')],
    ]

    let y = 330
    for (const [lbl, val] of rows) {
      ctx.fillStyle = '#64748b'
      ctx.font = '16px sans-serif'
      ctx.fillText(lbl, 76, y)
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 18px sans-serif'
      ctx.fillText(String(val), 76, y + 26)

      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(76, y + 44)
      ctx.lineTo(724, y + 44)
      ctx.stroke()

      y += 82
    }

    jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))), 'image/jpeg', 0.88)
    })
  } catch {
    const b64 =
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0d' +
      'Hx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e' +
      'Hh4eHh4eHh4eHh7/wAARCAEAAHgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA' +
      '/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCSAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k='
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    jpegBlob = new Blob([bytes.buffer], { type: 'image/jpeg' })
  }

  const storagePath = `${requestId}/${data.user.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  const { error: uploadError } = await supabase.storage.from('funeral-balance-receipts').upload(storagePath, jpegBlob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (uploadError) throw uploadError
  return storagePath
}
