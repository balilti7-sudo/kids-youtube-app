import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

type Props = {
  title: string
  /** Live one-line status, e.g. "Shorts allowed · thumbnails shown". */
  summary?: string | null
  icon?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Collapsible parental-settings group — keeps Manage Profile scannable instead of a
 * flat pile of toggles. Header is a real button: D-Pad / keyboard friendly.
 */
export function SettingsGroupSection({
  title,
  summary,
  icon,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-600/70 bg-zinc-900/80 ring-1 ring-zinc-800/70">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-start transition hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--focus-ring))]"
      >
        {icon ? (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/25 text-sky-300"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-snug text-zinc-50">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-xs leading-relaxed text-zinc-400">
              {summary}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn('h-5 w-5 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={contentId} className="flex flex-col gap-3 border-t border-zinc-800/80 p-3 sm:p-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}
