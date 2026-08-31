import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { resolveTagIcon, weightDotCount } from '../../lib/contentTags/tagUi'
import { useContentTagLabel } from '../../hooks/useContentTagLabel'
import type { ContentTag } from '../../lib/contentTags/types'

type Props = {
  tag: ContentTag
  weight?: number
  selected?: boolean
  disabled?: boolean
  onPress?: () => void
  className?: string
  compact?: boolean
}

export function TagChip({
  tag,
  weight = 0,
  selected = false,
  disabled,
  onPress,
  className,
  compact,
}: Props) {
  const label = useContentTagLabel()
  const Icon = resolveTagIcon(tag.iconKey)
  const dots = weightDotCount(weight)
  const isLess = weight < 0
  const isMore = weight > 0

  const body = (
    <>
      <Icon className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden />
      <span className="truncate">{label(tag)}</span>
      {weight !== 0 ? (
        <span
          className={cn('inline-flex shrink-0 gap-0.5', isLess && 'opacity-70', isMore && 'opacity-100')}
          aria-hidden
        >
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'rounded-full',
                compact ? 'h-1 w-1' : 'h-1.5 w-1.5',
                isLess ? 'bg-zinc-400' : 'bg-emerald-300'
              )}
            />
          ))}
        </span>
      ) : null}
    </>
  )

  const chipClass = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold transition touch-manipulation',
    compact ? 'min-h-9 px-2.5 text-xs' : 'min-h-10 px-3.5 text-sm',
    `safetube-tag-${tag.colorToken}`,
    selected && 'ring-2 ring-emerald-400/80',
    weight > 0 && 'safetube-tag-weight-more',
    weight < 0 && 'safetube-tag-weight-less',
    disabled && 'pointer-events-none opacity-50',
    className
  )

  if (onPress) {
    return (
      <button
        type="button"
        className={chipClass}
        disabled={disabled}
        onClick={onPress}
        aria-pressed={selected || weight !== 0}
      >
        {body}
      </button>
    )
  }

  return <span className={chipClass}>{body as ReactNode}</span>
}
