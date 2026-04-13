import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

export function PlanCard({
  title,
  price,
  features,
  highlighted,
  onSelect,
  loading,
}: {
  title: string
  price: string
  features: string[]
  highlighted?: boolean
  onSelect: () => void
  loading?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900',
        highlighted
          ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-800'
          : 'border-slate-200 dark:border-zinc-800'
      )}
    >
      <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">{title}</h3>
      <p className="mt-1 text-2xl font-extrabold text-brand-700 dark:text-brand-500">{price}</p>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-slate-600 dark:text-zinc-400">
        {features.map((f) => (
          <li key={f}>• {f}</li>
        ))}
      </ul>
      <Button className="mt-4 w-full" onClick={onSelect} disabled={loading}>
        {loading ? 'פותח...' : 'בחר תוכנית'}
      </Button>
    </div>
  )
}
