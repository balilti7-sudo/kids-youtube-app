import { Trash2 } from 'lucide-react'
import { useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLongPress } from '../../hooks/useLongPress'
import { cn } from '../../lib/utils'
import { SafeTubeChannelAvatar } from '../ui/SafeTubeChannelAvatar'

type Props = {
  name: string
  thumbnail?: string | null
  hideThumbnail?: boolean
  selected?: boolean
  selectionMode?: boolean
  selectionCheckbox?: ReactNode
  category?: string | null
  onSelect: () => void
  onRemove: () => void
  className?: string
  /** Compact chip style for horizontal mobile rows */
  variant?: 'row' | 'chip'
}

/**
 * Channel row/chip with always-visible delete + long-press to remove.
 */
export function RemovableChannelItem({
  name,
  thumbnail,
  hideThumbnail,
  selected,
  selectionMode,
  selectionCheckbox,
  category,
  onSelect,
  onRemove,
  className,
  variant = 'row',
}: Props) {
  const { t } = useTranslation()
  const longPress = useLongPress(onRemove)
  const { consumeLongPress, ...pressHandlers } = longPress

  const handleSelect = useCallback(() => {
    if (consumeLongPress()) return
    onSelect()
  }, [consumeLongPress, onSelect])

  const removeLabel = t('channels.removeAria', { name })

  if (variant === 'chip') {
    return (
      <div
        className={cn(
          'relative flex shrink-0 flex-col items-center gap-1 rounded-2xl px-2 py-1.5',
          selected ? 'bg-slate-200 dark:bg-zinc-800' : 'bg-slate-100/80 dark:bg-zinc-900/80',
          className
        )}
      >
        <button
          type="button"
          className="flex flex-col items-center gap-1"
          onClick={handleSelect}
          {...pressHandlers}
          aria-label={name}
        >
          {selectionCheckbox}
          <SafeTubeChannelAvatar
            name={name}
            thumbnail={thumbnail}
            hide={Boolean(hideThumbnail)}
            className="h-12 w-12 rounded-full"
          />
          <span className="line-clamp-1 max-w-[4.5rem] text-center text-[10px] font-medium text-slate-800 dark:text-zinc-200">
            {name}
          </span>
        </button>
        {!selectionMode ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="absolute -start-0.5 -top-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-red-600 shadow ring-1 ring-red-200 dark:bg-zinc-900 dark:text-red-400 dark:ring-red-900/50"
            aria-label={removeLabel}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full items-center gap-1 rounded-xl',
        selected ? 'bg-slate-200/80 dark:bg-zinc-800' : '',
        className
      )}
    >
      <button
        type="button"
        onClick={handleSelect}
        {...pressHandlers}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2 text-right transition',
          !selected ? 'hover:bg-slate-100 dark:hover:bg-zinc-800/80' : ''
        )}
      >
        {selectionCheckbox}
        <SafeTubeChannelAvatar
          name={name}
          thumbnail={thumbnail}
          hide={Boolean(hideThumbnail)}
          className="h-10 w-10 shrink-0 rounded-full"
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug text-slate-800 dark:text-zinc-200">
          {name}
        </span>
        {category ? (
          <span className="shrink-0 text-[10px] text-brand-600 dark:text-brand-400">{category}</span>
        ) : null}
      </button>
      {!selectionMode ? (
        <button
          type="button"
          onClick={() => onRemove()}
          className="me-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          aria-label={removeLabel}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
