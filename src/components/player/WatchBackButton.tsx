import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'

type Props = {
  onClick: () => void
  className?: string
  /** Short label next to the chevron (watch page). Icon-only on dense Shorts chrome. */
  showLabel?: boolean
}

/** YouTube-style RTL back chevron — returns to the channel browse spot. */
export function WatchBackButton({ onClick, className, showLabel = true }: Props) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'safetube-player-back-btn inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-black/70 px-3.5 text-sm font-semibold text-white shadow-md ring-1 ring-white/25 backdrop-blur-md touch-manipulation active:scale-[0.97]',
        className
      )}
      aria-label={t('player.backToChannel')}
    >
      <ArrowRight className="h-5 w-5 shrink-0" aria-hidden />
      {showLabel ? <span className="pe-0.5">{t('common.back')}</span> : null}
    </button>
  )
}
