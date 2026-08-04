import { CheckSquare, ListMusic, Square, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'

type Props = {
  selectionMode: boolean
  selectedCount: number
  totalVisible?: number
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  onSelectAllVisible?: () => void
  onClearSelection?: () => void
  onAddToPlaylist: () => void
  className?: string
  /** Compact toolbar for tight sidebars */
  compact?: boolean
  /** Hebrew noun for items being selected (default: סרטונים) */
  itemNoun?: string
  enterLabel?: string
  addButtonLabel?: string
}

/** Enter multi-select / floating actions for bulk add-to-playlist. */
export function PlaylistMultiSelectToolbar({
  selectionMode,
  selectedCount,
  totalVisible = 0,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectAllVisible,
  onClearSelection,
  onAddToPlaylist,
  className,
  compact,
  itemNoun = 'סרטונים',
  enterLabel = 'בחירה מרובה',
  addButtonLabel = 'הוסף לפלייליסט',
}: Props) {
  if (!selectionMode) {
    return (
      <div className={cn('flex items-center justify-end', className)}>
        <button
          type="button"
          onClick={onEnterSelectionMode}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-yt-border bg-yt-surface font-semibold text-yt-text transition hover:bg-yt-surfaceHover',
            compact ? 'min-h-[36px] px-2.5 text-xs' : 'min-h-[40px] px-3 text-sm'
          )}
        >
          <CheckSquare className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} aria-hidden />
          {enterLabel}
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-3 py-2.5 ring-1 ring-brand-500/15',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn('font-semibold text-yt-text', compact ? 'text-xs' : 'text-sm')}>
          {selectedCount === 0 ? `בחרו ${itemNoun}` : `נבחרו ${selectedCount}`}
        </p>
        <button
          type="button"
          onClick={onExitSelectionMode}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-yt-textMuted hover:bg-yt-surfaceHover hover:text-yt-text"
          aria-label="בטל בחירה מרובה"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          ביטול
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onSelectAllVisible && totalVisible > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className={cn(compact ? '!h-8 !px-2.5 !text-xs' : '!h-9 !px-3 !text-xs')}
            onClick={onSelectAllVisible}
          >
            בחר הכל ({totalVisible})
          </Button>
        ) : null}
        {onClearSelection && selectedCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className={cn(compact ? '!h-8 !px-2.5 !text-xs' : '!h-9 !px-3 !text-xs')}
            onClick={onClearSelection}
          >
            נקה
          </Button>
        ) : null}
        <Button
          type="button"
          className={cn(
            'gap-1.5',
            compact ? '!h-8 !px-2.5 !text-xs' : '!h-9 !px-3 !text-xs'
          )}
          disabled={selectedCount === 0}
          onClick={onAddToPlaylist}
        >
          <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {addButtonLabel}
        </Button>
      </div>
    </div>
  )
}

type CheckboxProps = {
  checked: boolean
  onChange: () => void
  label?: string
  className?: string
}

export function PlaylistSelectCheckbox({ checked, onChange, label, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? (checked ? 'הסר מהבחירה' : 'הוסף לבחירה')}
      title={label ?? (checked ? 'הסר מהבחירה' : 'הוסף לבחירה')}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={cn(
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition',
        checked
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-yt-border bg-yt-surface text-yt-textMuted hover:bg-yt-surfaceHover',
        className
      )}
    >
      {checked ? (
        <CheckSquare className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      ) : (
        <Square className="h-5 w-5" strokeWidth={2.25} aria-hidden />
      )}
    </button>
  )
}
