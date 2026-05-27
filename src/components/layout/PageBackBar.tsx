import { ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { useKidDeviceTokenPresent } from '../../hooks/useKidDeviceTokenPresent'
import { ChildProofLongPressControl } from '../kid/ChildProofLongPressControl'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'

type Props = {
  /** קישור משני כשאין היסטוריית דפדפן (למשל נכנסו ישירות לכתובת) */
  fallback?: string
  className?: string
  /** ללא margin תחתון — לשילוב בשורת כותרת עם כפתורים */
  flush?: boolean
}

/**
 * RTL: “חזרה” עם חץ ימינה.
 */
export function PageBackBar({ fallback = '/dashboard', className, flush }: Props) {
  const navigate = useNavigate()
  const childProofExits = useKidDeviceTokenPresent()

  const fallbackLabel = fallback === '/dashboard' ? 'בקרת הורים' : fallback === '/auth' ? 'התחברות' : 'מסך ראשי'

  const goBack = () => navigate(-1)

  const goFallback = () => {
    if (fallback === '/dashboard') setParentEntryIntent()
    navigate(fallback)
  }

  const backButtonClass =
    'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-600/80 bg-zinc-800/90 px-2.5 py-2 text-xs font-semibold text-zinc-100 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-700 active:scale-[0.99] sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm'

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-3', !flush && 'mb-3 sm:mb-4', className)}>
      {childProofExits ? (
        <ChildProofLongPressControl
          onComplete={goBack}
          progressStyle="bar"
          ariaLabel="חזרה — לחיצה ארוכה 3 שניות"
          title="החזיקו לחוץ 3 שנ׳ לחזרה"
        >
          <span className={backButtonClass}>
            <ArrowRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            חזרה
          </span>
        </ChildProofLongPressControl>
      ) : (
        <button type="button" onClick={goBack} className={backButtonClass}>
          <ArrowRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          חזרה
        </button>
      )}
      {childProofExits ? (
        <ChildProofLongPressControl
          onComplete={goFallback}
          progressStyle="bar"
          className="hidden min-[420px]:inline-flex sm:inline-flex"
          ariaLabel={`${fallbackLabel} — לחיצה ארוכה 3 שניות`}
          title={`החזיקו לחוץ 3 שנ׳ ל${fallbackLabel}`}
        >
          <span className="truncate text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 sm:text-sm">
            {fallbackLabel}
          </span>
        </ChildProofLongPressControl>
      ) : (
        <button
          type="button"
          onClick={goFallback}
          className="hidden truncate text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 min-[420px]:inline sm:text-sm"
        >
          {fallbackLabel}
        </button>
      )}
    </div>
  )
}
