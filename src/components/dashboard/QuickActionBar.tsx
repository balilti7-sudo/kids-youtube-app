import { Link } from 'react-router-dom'
import { Plus, Link2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const secondaryLink =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] bg-slate-200 text-slate-900 hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

const primaryLink =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] bg-brand-600 !text-white hover:bg-brand-700 disabled:opacity-50'

export function QuickActionBar() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/devices" className={cn('flex-1 min-w-[140px]', secondaryLink)}>
        <Link2 className="h-4 w-4 shrink-0" aria-hidden />
        הוספת מכשיר
      </Link>
      <Link to="/channels" className={cn('flex-1 min-w-[140px]', primaryLink)}>
        <Plus className="h-4 w-4 shrink-0" aria-hidden />
        הוספת ערוץ
      </Link>
    </div>
  )
}
