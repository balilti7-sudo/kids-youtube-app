import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../lib/utils'

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
  toolbar,
  size = 'md',
  bodyClassName,
  panelClassName,
  headerClassName,
  footerClassName,
  toolbarClassName,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  /** Fixed chrome above the scroll body (e.g. search) — avoids sticky-in-scroll jumps with the keyboard. */
  toolbar?: ReactNode
  size?: ModalSize
  bodyClassName?: string
  panelClassName?: string
  headerClassName?: string
  footerClassName?: string
  toolbarClassName?: string
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    const prevPaddingRight = document.body.style.paddingRight
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`
    }
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.paddingRight = prevPaddingRight
    }
  }, [open])

  if (!open) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="pointer-events-auto fixed inset-0 z-[99999]"
      role="dialog"
      aria-modal
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="סגור"
        onClick={onClose}
      />
      {/*
        Use svh (not dvh) for max-height so the soft keyboard does not constantly
        resize/recenter the panel while typing. Mobile stays bottom-anchored.
      */}
      <div className="safe-area-pad pointer-events-none relative z-10 flex h-full w-full items-end justify-center sm:items-center">
        <div
          className={cn(
            'pointer-events-auto relative flex w-full max-h-[min(92svh,calc(100svh-var(--sat)-var(--sab)-1.5rem))] flex-col rounded-t-3xl bg-yt-surface p-4 shadow-2xl ring-1 ring-yt-border sm:rounded-3xl sm:p-6',
            SIZE_CLASS[size],
            panelClassName
          )}
        >
          <div className={cn('mb-4 flex shrink-0 items-start justify-between gap-3', headerClassName)}>
            <h2 id={titleId} className="pt-1 text-lg font-bold leading-snug text-yt-text sm:text-xl">
              {title}
            </h2>
            <Button
              variant="ghost"
              className="!min-h-12 !min-w-12 !rounded-2xl !p-0"
              onClick={onClose}
              aria-label="סגור"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          {toolbar ? (
            <div className={cn('mb-3 shrink-0', toolbarClassName)}>{toolbar}</div>
          ) : null}
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'max-h-[70svh]')}>
            {children}
          </div>
          {footer ? (
            <div
              className={cn(
                'mt-4 flex shrink-0 flex-wrap justify-end gap-2 border-t border-yt-border pt-4',
                footerClassName
              )}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}
