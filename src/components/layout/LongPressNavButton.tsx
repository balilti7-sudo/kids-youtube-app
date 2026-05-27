import { type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/utils'
import { setParentEntryIntent } from '../../lib/parentEntryIntent'
import { ChildProofLongPressControl } from '../kid/ChildProofLongPressControl'

type Props = {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  isActive: boolean
}

/** Parent/settings nav on kid devices — 3s hold with progress + short-press hint. */
export function LongPressNavButton({ to, label, icon: Icon, isActive }: Props) {
  const navigate = useNavigate()

  const go = () => {
    setParentEntryIntent()
    navigate(to)
  }

  return (
    <ChildProofLongPressControl
      onComplete={go}
      progressStyle="bar"
      className="flex min-w-0 flex-1 flex-col"
      ariaLabel={`${label} — לחיצה ארוכה 3 שניות`}
      title={`החזיקו לחוץ 3 שנ׳ ל${label}`}
    >
      <span
        className={cn(
          'flex w-full flex-col items-center gap-1 py-2.5 text-xs font-medium',
          isActive ? 'text-brand-700 dark:text-brand-500' : 'text-slate-400 opacity-75 dark:text-zinc-500'
        )}
      >
        <Icon className="h-6 w-6" aria-hidden />
        <span className="max-w-[4.5rem] text-center leading-tight">{label}</span>
      </span>
    </ChildProofLongPressControl>
  )
}
