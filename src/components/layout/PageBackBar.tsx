import { ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'

type Props = {
  /** קישור משני כשאין היסטוריית דפדפן (למשל נכנסו ישירות לכתובת) */
  fallback?: string
  className?: string
}

/**
 * RTL: “חזרה” עם חץ ימינה.
 */
export function PageBackBar({ fallback = '/dashboard', className }: Props) {
  const navigate = useNavigate()

  const fallbackLabel = fallback === '/dashboard' ? 'דף הבית' : fallback === '/auth' ? 'התחברות' : 'מסך ראשי'

  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-3 sm:mb-4', className)}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 rounded-xl border border-zinc-600/80 bg-zinc-800/90 px-3 py-2.5 text-sm font-semibold text-zinc-100 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-700 active:scale-[0.99]"
      >
        <ArrowRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
        חזרה
      </button>
      <Link
        to={fallback}
        className="text-sm font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
      >
        {fallbackLabel}
      </Link>
    </div>
  )
}
