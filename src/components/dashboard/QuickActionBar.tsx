import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'

const primaryLink =
  'inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold transition active:scale-[0.98] bg-brand-600 !text-white shadow-md shadow-brand-900/20 hover:bg-brand-700'

const subtleLink =
  'text-center text-xs font-medium text-zinc-500 underline-offset-4 hover:text-brand-400 hover:underline dark:text-zinc-400'

export function QuickActionBar() {
  return (
    <div className="flex flex-col gap-2">
      <Link to="/channels" className={cn(primaryLink)}>
        <Plus className="h-5 w-5 shrink-0" aria-hidden />
        הוספת ערוץ למכשיר הילד
      </Link>
      <Link to="/devices" className={subtleLink}>
        מסך מלא: חיבור מכשירים וקודים
      </Link>
    </div>
  )
}
