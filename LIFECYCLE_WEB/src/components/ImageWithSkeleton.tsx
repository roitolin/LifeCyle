import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import './ImageWithSkeleton.css'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className' | 'onLoad' | 'onError'> & {
  src: string
  alt: string
  className?: string
}

export default function ImageWithSkeleton(props: Props) {
  return <ImageFrame key={props.src} {...props} />
}

function ImageFrame({ className, src, alt, decoding = 'async', ...imageProps }: Props) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

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
        src={src}
        alt={alt}
        decoding={decoding}
        onLoad={event => revealImage(event.currentTarget)}
        onError={() => setState('failed')}
      />
      {state === 'failed' && <span className="lc-image-unavailable">Image unavailable</span>}
    </span>
  )
}
