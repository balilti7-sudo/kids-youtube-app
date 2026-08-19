import { cn } from '../../lib/utils'

type SafeTubeFilteredImageProps = {
  src?: string | null
  alt?: string
  className?: string
  /** When true, show a neutral tile instead of loading the image URL. */
  hide?: boolean
  placeholderClassName?: string
}

/**
 * Kid-safe image — skips network fetch when thumbnails are hidden for the profile.
 */
export function SafeTubeFilteredImage({
  src,
  alt = '',
  className,
  hide = false,
  placeholderClassName,
}: SafeTubeFilteredImageProps) {
  if (hide || !src?.trim()) {
    return (
      <div
        className={cn('bg-zinc-900', placeholderClassName, className)}
        aria-hidden={!alt}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
      />
    )
  }

  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />
}
