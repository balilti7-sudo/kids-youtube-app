import { useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'

type ModalSize = 'md' | 'lg' | 'xl' | 'full'

const SIZE_CLASS: Record<ModalSize, string> = {
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-[96rem]',
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: ModalSize
  bodyClassName?: string
}) {
  const titleId = useId()
  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] pointer-events-auto flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
        aria-label="סגור"
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full ${SIZE_CLASS[size]} rounded-t-2xl bg-white p-4 shadow-xl dark:bg-zinc-900 dark:ring-1 dark:ring-zinc-800 sm:rounded-2xl sm:p-6`}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-zinc-100">
            {title}
          </h2>
          <Button variant="ghost" className="!p-2" onClick={onClose} aria-label="סגור">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className={bodyClassName ?? 'max-h-[70vh] overflow-y-auto'}>{children}</div>
        {footer ? (
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4 dark:border-zinc-800">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
