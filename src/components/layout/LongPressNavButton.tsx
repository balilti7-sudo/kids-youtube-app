import { type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'
import { ChildProofLongPressControl } from '../kid/ChildProofLongPressControl'

type Props = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  isActive: boolean
  /** Side-rail layout (tablet+) vs bottom-nav column. */
  layout?: 'bottom' | 'rail' | 'rail-collapsed'
}

/** Parent/settings nav on kid devices — 3s hold with progress + short-press hint. */
export function LongPressNavButton({ to, label, icon: Icon, isActive, layout = 'bottom' }: Props) {
  const navigate = useNavigate()

  const go = () => {
    setParentEntryIntent()
    navigate(to)
  }

  const rail = layout === 'rail' || layout === 'rail-collapsed'

  return (
    <ChildProofLongPressControl
      onComplete={go}
      progressStyle="bar"
      className={cn('flex min-w-0', rail ? 'w-full' : 'flex-1 flex-col')}
      ariaLabel={`${label} — לחיצה ארוכה 3 שניות`}
      title={`החזיקו לחוץ 3 שנ׳ ל${label}`}
    >
      <span
        className={cn(
          'flex w-full text-xs font-medium',
          layout === 'bottom' && 'min-h-12 flex-col items-center justify-center gap-0.5 py-2 xs:gap-1 xs:py-2.5',
          layout === 'rail' && 'flex-row items-center gap-3 rounded-xl px-3 py-2.5',
          layout === 'rail-collapsed' && 'flex-col items-center gap-1 rounded-xl px-1 py-2.5',
          isActive
            ? rail
              ? 'bg-yt-surfaceHover text-yt-text'
              : 'text-brand-700 dark:text-brand-500'
            : rail
              ? 'text-yt-textMuted opacity-90 hover:bg-yt-surface/80'
              : 'text-slate-400 opacity-75 dark:text-zinc-500'
        )}
      >
        <Icon className="h-6 w-6 shrink-0" aria-hidden />
        {layout === 'rail-collapsed' ? null : (
          <span className={cn(layout === 'bottom' && 'max-w-[4.5rem] text-center leading-tight', layout === 'rail' && 'truncate text-sm')}>
            {label}
          </span>
        )}
      </span>
    </ChildProofLongPressControl>
  )
}
