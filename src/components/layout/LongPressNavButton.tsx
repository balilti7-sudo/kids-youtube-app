import { type ComponentType, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'

const DEFAULT_MS = 650

type Props = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  isActive: boolean
  longPressMs?: number
}

/** ניווט דיסקרטי: מעבר רק אחרי לחיצה ארוכה (מכשיר עם טוקן ילד). */
export function LongPressNavButton({ to, label, icon: Icon, isActive, longPressMs = DEFAULT_MS }: Props) {
  const navigate = useNavigate()
  const timerRef = useRef<number | null>(null)
  const firedRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const go = useCallback(() => {
    setParentEntryIntent()
    navigate(to)
  }, [navigate, to])

  const onPointerDown = () => {
    firedRef.current = false
    clearTimer()
    timerRef.current = window.setTimeout(() => {
      firedRef.current = true
      timerRef.current = null
      go()
    }, longPressMs)
  }

  const onPointerUp = () => {
    clearTimer()
  }

  const onPointerCancel = () => {
    clearTimer()
  }

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={`${label} — לחיצה ארוכה ${Math.round(longPressMs / 100) / 10} שניות`}
      title={`החזיקו לחוץ לכניסת הורים (${Math.round(longPressMs / 100) / 10} שנ׳)`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerCancel}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition select-none touch-manipulation',
        isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-400 dark:text-zinc-500 opacity-75'
      )}
    >
      <Icon className="h-6 w-6" aria-hidden />
      <span className="max-w-[4.5rem] text-center leading-tight">{label}</span>
    </button>
  )
}
