import { Link, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'
import { ChildProofLongPressControl } from '../kid/ChildProofLongPressControl'

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

  const imgClass = cn(
    size === 'compact'
      ? 'h-11 w-auto max-w-[8.25rem] object-contain sm:h-12 sm:max-w-[10rem]'
      : 'h-[50px] w-auto max-w-[9.5rem] object-contain sm:h-[60px] sm:max-w-[13rem]',
    'bg-transparent border-0 shadow-none outline-none ring-0',
    'transition-transform duration-700 ease-in-out motion-reduce:duration-500',
    'group-hover:animate-logo-hover-pulse motion-reduce:group-hover:animate-none motion-reduce:group-hover:scale-105'
  )

  const baseRing =
    'group inline-flex shrink-0 items-center rounded-md bg-transparent outline-none ring-0 focus-visible:ring-2 focus-visible:ring-brand-500/50'

  if (discreetParentNav) {
    return (
      <ChildProofLongPressControl
        onComplete={() => {
          setParentEntryIntent()
          navigate(to)
        }}
        progressStyle="ring"
        className={cn(baseRing, 'opacity-90', className)}
        ariaLabel="SafeTube — לחיצה ארוכה 3 שניות לבקרת הורים"
        title="החזיקו לחוץ 3 שנ׳ לבקרת הורים"
      >
        <img src={SAFETUBE_LOGO_SRC} alt="" className={imgClass} decoding="async" />
      </ChildProofLongPressControl>
    )
  }

  return (
    <Link to={to} className={cn(baseRing, className)} aria-label="SafeTube">
      <img src={SAFETUBE_LOGO_SRC} alt="" className={imgClass} decoding="async" />
    </Link>
  )
}
