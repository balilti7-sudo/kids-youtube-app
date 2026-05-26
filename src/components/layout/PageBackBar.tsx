import { ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'

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

  const fallbackLabel = fallback === '/dashboard' ? 'בקרת הורים' : fallback === '/auth' ? 'התחברות' : 'מסך ראשי'

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-3', !flush && 'mb-3 sm:mb-4', className)}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-600/80 bg-zinc-800/90 px-2.5 py-2 text-xs font-semibold text-zinc-100 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-700 active:scale-[0.99] sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm"
      >
        <ArrowRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
        חזרה
      </button>
      <Link
        to={fallback}
        className="hidden truncate text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline min-[420px]:inline sm:text-sm"
      >
        {fallbackLabel}
      </Link>
    </div>
  )
}
