import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { getDeliveredImageSrcSet, getDeliveredImageUrl } from '@/utils/imageDelivery'
import './ImageWithSkeleton.css'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className' | 'onLoad' | 'onError'> & {
  src: string
  alt: string
  className?: string
  deliveryWidth?: number
  deliveryHeight?: number
  deliveryFit?: 'cover' | 'contain'
}

export default function ImageWithSkeleton(props: Props) {
  return <ImageFrame key={`${props.src}:${props.deliveryWidth ?? ''}:${props.deliveryHeight ?? ''}`} {...props} />
}

function ImageFrame({
  className,
  src,
  alt,
  decoding = 'async',
  deliveryWidth,
  deliveryHeight,
  deliveryFit = 'cover',
  sizes,
  srcSet,
  ...imageProps
}: Props) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const crop = deliveryFit === 'contain' ? 'limit' : 'fill'
  const deliveredSource = deliveryWidth
    ? getDeliveredImageUrl(src, {
        width: deliveryWidth,
        height: deliveryHeight,
        crop,
        quality: deliveryWidth >= 900 ? 'auto:good' : 'auto:eco',
      })
    : src
  const [activeSource, setActiveSource] = useState(deliveredSource)
  const responsiveSourceSet = srcSet ?? (deliveryWidth
    ? getDeliveredImageSrcSet(
        src,
        [Math.round(deliveryWidth * 0.67), deliveryWidth, Math.round(deliveryWidth * 1.5)],
        {
          crop,
          quality: deliveryWidth >= 900 ? 'auto:good' : 'auto:eco',
          aspectRatio: deliveryHeight ? deliveryWidth / deliveryHeight : undefined,
        },
      )
    : undefined)

  const revealImage = useCallback((image: HTMLImageElement) => {
    const loadedSource = image.currentSrc
    const reveal = () => {
      if (imageRef.current === image && image.currentSrc === loadedSource && image.naturalWidth > 0) {
        setState('ready')
      }
    }
    if (image.decode) void image.decode().then(reveal, reveal)
    else reveal()
  }, [])

  useEffect(() => {
    const image = imageRef.current
    if (!image?.complete) return
    const frame = window.requestAnimationFrame(() => {
      if (image.complete && image.naturalWidth > 0) revealImage(image)
      else if (image.complete && image.currentSrc) setState('failed')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [revealImage])

  return (
    <span className={className ? `lc-image-frame ${className}` : 'lc-image-frame'} data-image-state={state}>
      <img
        {...imageProps}
        ref={imageRef}
        src={activeSource}
        srcSet={activeSource === deliveredSource ? responsiveSourceSet : undefined}
        sizes={sizes}
        alt={alt}
        decoding={decoding}
        onLoad={event => revealImage(event.currentTarget)}
        onError={() => {
          if (activeSource !== src) {
            setState('loading')
            setActiveSource(src)
            return
          }
          setState('failed')
        }}
      />
      {state === 'failed' && <span className="lc-image-unavailable">Image unavailable</span>}
    </span>
  )
}
