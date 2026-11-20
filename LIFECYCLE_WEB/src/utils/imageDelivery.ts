type CloudinaryCrop = 'fill' | 'limit'

type ImageDeliveryOptions = {
  width: number
  height?: number
  crop?: CloudinaryCrop
  quality?: 'auto:eco' | 'auto:good'
}

const CLOUDINARY_UPLOAD_MARKER = '/image/upload/'

function clampDimension(value: number) {
  return Math.max(32, Math.min(2400, Math.round(value)))
}

export function getDeliveredImageUrl(source: string, options: ImageDeliveryOptions) {
  if (!source) return source

  try {
    const url = new URL(source)
    if (url.hostname !== 'res.cloudinary.com') return source

    const markerIndex = url.pathname.indexOf(CLOUDINARY_UPLOAD_MARKER)
    if (markerIndex < 0) return source

    const width = clampDimension(options.width)
    const height = options.height ? clampDimension(options.height) : null
    const crop = options.crop ?? (height ? 'fill' : 'limit')
    const quality = options.quality ?? 'auto:eco'
    const transformation = [
      'f_auto',
      `q_${quality}`,
      `c_${crop}`,
      crop === 'fill' ? 'g_auto' : null,
      `w_${width}`,
      height ? `h_${height}` : null,
    ].filter(Boolean).join(',')

    const prefix = url.pathname.slice(0, markerIndex + CLOUDINARY_UPLOAD_MARKER.length)
    const assetPath = url.pathname.slice(markerIndex + CLOUDINARY_UPLOAD_MARKER.length)
    url.pathname = `${prefix}${transformation}/${assetPath}`
    return url.toString()
  } catch {
    return source
  }
}

export function getDeliveredImageSrcSet(
  source: string,
  widths: number[],
  options: Omit<ImageDeliveryOptions, 'width' | 'height'> & { aspectRatio?: number } = {},
) {
  if (!source.includes('res.cloudinary.com')) return undefined

  const uniqueWidths = Array.from(new Set(widths.map(clampDimension))).sort((a, b) => a - b)
  return uniqueWidths
    .map(width => {
      const height = options.aspectRatio
        ? Math.max(32, Math.round(width / options.aspectRatio))
        : undefined
      return `${getDeliveredImageUrl(source, { ...options, width, height })} ${width}w`
    })
    .join(', ')
}
