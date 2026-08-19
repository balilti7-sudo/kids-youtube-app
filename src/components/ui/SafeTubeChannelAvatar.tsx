import { Tv } from 'lucide-react'
import { cn } from '../../lib/utils'

type SafeTubeChannelAvatarProps = {
  name?: string | null
  thumbnail?: string | null
  hide?: boolean
  className?: string
  iconClassName?: string
}

/**
 * Channel avatar — letter/icon fallback when YouTube channel art is filtered out.
 */
export function SafeTubeChannelAvatar({
  name,
  thumbnail,
  hide = false,
  className,
  iconClassName,
}: SafeTubeChannelAvatarProps) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  const showImage = !hide && Boolean(thumbnail?.trim())

  if (showImage) {
    return (
      <img
        src={thumbnail!}
        alt=""
        className={cn('h-full w-full object-cover', className)}
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <span
      className={cn(
        'flex h-full w-full items-center justify-center bg-zinc-800 text-sm font-bold text-zinc-300',
        className
      )}
      aria-hidden
    >
      {initial !== '?' ? (
        initial
      ) : (
        <Tv className={cn('h-5 w-5 text-zinc-500', iconClassName)} aria-hidden />
      )}
    </span>
  )
}
