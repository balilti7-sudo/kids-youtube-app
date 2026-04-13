import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
      {icon ? <div className="text-slate-400 dark:text-zinc-500">{icon}</div> : null}
      <h3 className="text-base font-semibold text-slate-900 dark:text-zinc-100">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-slate-600 dark:text-zinc-400">{description}</p> : null}
      {action}
    </div>
  )
}
