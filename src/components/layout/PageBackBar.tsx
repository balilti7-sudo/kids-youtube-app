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
 * RTL: “חזרה” עם חץ ימינה — Material 48dp touch target.
 */
export function PageBackBar({ fallback = '/dashboard', className, flush }: Props) {
  const navigate = useNavigate()
  const childProofExits = useKidDeviceTokenPresent()

  const fallbackPath = fallback.split('?')[0]
  const fallbackLabel =
    fallbackPath === '/dashboard' ? 'בקרת הורים' : fallbackPath === '/auth' ? 'התחברות' : 'מסך ראשי'

  const goBack = () => navigate(-1)

  const goFallback = () => {
    if (fallbackPath === '/dashboard') setParentEntryIntent()
    navigate(fallback)
  }

  const backButtonClass =
    'inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-2 rounded-2xl border border-zinc-600/80 bg-zinc-800/95 px-4 py-3 text-sm font-semibold text-zinc-50 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-700 active:scale-[0.99]'

  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-1 flex min-w-0 flex-wrap items-center gap-2 bg-gradient-to-b from-zinc-950 via-zinc-950/95 to-transparent px-1 pb-3 pt-1 sm:gap-3',
        !flush && 'mb-2 sm:mb-3',
        className
      )}
    >
      {childProofExits ? (
        <ChildProofLongPressControl
          onComplete={goBack}
          progressStyle="bar"
          ariaLabel="חזרה — לחיצה ארוכה 3 שניות"
          title="החזיקו לחוץ 3 שנ׳ לחזרה"
        >
          <span className={backButtonClass}>
            <ArrowRight className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
            חזרה
          </span>
        </ChildProofLongPressControl>
      ) : (
        <button type="button" onClick={goBack} className={backButtonClass}>
          <ArrowRight className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
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
          <span className="inline-flex min-h-12 items-center truncate px-2 text-sm font-medium text-zinc-400 underline-offset-2 hover:text-zinc-200">
            {fallbackLabel}
          </span>
        </ChildProofLongPressControl>
      ) : (
        <button
          type="button"
          onClick={goFallback}
          className="hidden min-h-12 truncate px-2 text-sm font-medium text-zinc-400 underline-offset-2 hover:text-zinc-200 min-[420px]:inline-flex min-[420px]:items-center"
        >
          {fallbackLabel}
        </button>
      )}
    </div>
  )
}
