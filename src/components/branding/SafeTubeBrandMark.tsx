import { useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'

const DISCREET_LOGO_MS = 650

type Props = {
  /** ברירת מחדל: דשבורד הורה */
  to?: string
  className?: string
  /** במסך ילדים — עוד יותר צר */
  size?: 'default' | 'compact'
  /** במכשיר עם טוקן ילד — מעבר לדשבורד רק בלחיצה ארוכה (מניעת לחיצות מקריות) */
  discreetParentNav?: boolean
}

/**
 * לוגו מצומצם לשימוש בתוך האפליקציה (לא מסך כניסה) — גובה ~36–40px, לא נועל שטח כמו 350px.
 */
export function SafeTubeBrandMark({
  to = '/dashboard',
  className,
  size = 'default',
  discreetParentNav = false,
}: Props) {
  const navigate = useNavigate()
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const imgClass =
    size === 'compact'
      ? 'h-8 w-auto max-w-[5.5rem] object-contain sm:h-9 sm:max-w-[6.5rem]'
      : 'h-9 w-auto max-w-[100px] object-contain sm:h-10 sm:max-w-[120px]'

  const baseRing =
    'inline-flex shrink-0 items-center rounded-md outline-none ring-0 focus-visible:ring-2 focus-visible:ring-brand-500/50'

  if (discreetParentNav) {
    return (
      <button
        type="button"
        className={cn(baseRing, 'touch-manipulation select-none opacity-90', className)}
        aria-label={`SafeTube — לחיצה ארוכה לדף הבית (${DISCREET_LOGO_MS / 1000} שנ׳)`}
        title={`החזיקו לחוץ לדף הבית (${DISCREET_LOGO_MS / 1000} שנ׳)`}
        onPointerDown={() => {
          clearTimer()
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            setParentEntryIntent()
            navigate(to)
          }, DISCREET_LOGO_MS)
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => e.preventDefault()}
      >
        <img src={SAFETUBE_LOGO_SRC} alt="" className={imgClass} decoding="async" />
      </button>
    )
  }

  return (
    <Link to={to} className={cn(baseRing, className)} aria-label="SafeTube">
      <img src={SAFETUBE_LOGO_SRC} alt="" className={imgClass} decoding="async" />
    </Link>
  )
}
