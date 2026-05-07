import { Link } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { SAFETUBE_LOGO_SRC } from './SafeTubeLogo'

type Props = {
  /** ברירת מחדל: דשבורד הורה */
  to?: string
  className?: string
  /** במסך ילדים — עוד יותר צר */
  size?: 'default' | 'compact'
}

/**
 * לוגו מצומצם לשימוש בתוך האפליקציה (לא מסך כניסה) — גובה ~36–40px, לא נועל שטח כמו 350px.
 */
export function SafeTubeBrandMark({ to = '/dashboard', className, size = 'default' }: Props) {
  const imgClass =
    size === 'compact'
      ? 'h-8 w-auto max-w-[5.5rem] object-contain sm:h-9 sm:max-w-[6.5rem]'
      : 'h-9 w-auto max-w-[100px] object-contain sm:h-10 sm:max-w-[120px]'

  return (
    <Link
      to={to}
      className={cn('inline-flex shrink-0 items-center rounded-md outline-none ring-0 focus-visible:ring-2 focus-visible:ring-brand-500/50', className)}
      aria-label="SafeTube"
    >
      <img src={SAFETUBE_LOGO_SRC} alt="" className={imgClass} decoding="async" />
    </Link>
  )
}
