type CompressImageOptions = {
  maxDimension?: number
  quality?: number
  skipBelowBytes?: number
}

function outputName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'image'
  return `${stem}.webp`
}

export async function compressImageForUpload(file: File, options: CompressImageOptions = {}) {
  const maxDimension = Math.max(480, Math.min(2400, options.maxDimension ?? 1600))
  const quality = Math.max(0.55, Math.min(0.92, options.quality ?? 0.82))
  const skipBelowBytes = options.skipBelowBytes ?? 350 * 1024

  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  if (file.type === 'image/webp' && file.size <= skipBelowBytes) return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return file

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob || blob.size >= file.size) return file

    return new File([blob], outputName(file.name), {
      type: 'image/webp',
      lastModified: Date.now(),
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}
