import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal>
      <button type="button" className="absolute inset-0 bg-black/40 dark:bg-black/60" aria-label="סגור" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-xl dark:bg-zinc-900 dark:ring-1 dark:ring-zinc-800 sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">{title}</h2>
          <Button variant="ghost" className="!p-2" onClick={onClose} aria-label="סגור">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">{children}</div>
        {footer ? (
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-zinc-800">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
