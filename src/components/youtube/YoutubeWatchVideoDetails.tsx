import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

type YoutubeWatchVideoDetailsProps = {
  title: string
  channelName?: string | null
  channelThumbnail?: string | null
  subtitle?: string | null
  description?: string | null
  actions?: ReactNode
  className?: string
}

/**
 * YouTube watch page chrome under the player: title, channel row, action pills,
 * expandable description. Comments are intentionally omitted.
 */
export function YoutubeWatchVideoDetails({
  title,
  channelName,
  channelThumbnail,
  subtitle,
  description,
  actions,
  className,
}: YoutubeWatchVideoDetailsProps) {
  const [descOpen, setDescOpen] = useState(false)

  useEffect(() => {
    setDescOpen(false)
  }, [title, subtitle, description])
  const initial = (channelName || '?').trim().charAt(0).toUpperCase() || '?'
  const desc = (description || '').trim()
  const hasDescBox = Boolean(subtitle || desc)

  return (
    <div className={cn('mt-3 px-3 sm:mt-3 sm:px-0', className)}>
      <h1 className="text-[18px] font-bold leading-[1.35] tracking-tight text-yt-text sm:text-xl">
        {title}
      </h1>

      <div className="mt-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-yt-surfaceHover text-sm font-bold text-yt-text"
            aria-hidden
          >
            {channelThumbnail ? (
              <img src={channelThumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
            ) : (
              initial
            )}
          </span>
          <div className="min-w-0">
            {channelName ? (
              <p className="truncate text-base font-semibold leading-tight text-yt-text">{channelName}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {hasDescBox ? (
        <button
          type="button"
          onClick={() => setDescOpen((v) => !v)}
          aria-expanded={descOpen}
          className="mt-3 w-full rounded-xl bg-yt-surfaceHover px-3 py-2.5 text-start transition hover:bg-[#3f3f3f]/80 dark:hover:bg-[#3f3f3f]"
        >
          <div className="flex items-start justify-between gap-2">
            {subtitle ? (
              <p className="text-sm font-semibold text-yt-text">{subtitle}</p>
            ) : (
              <span className="text-sm font-semibold text-yt-text">פרטים</span>
            )}
            <ChevronDown
              className={cn('mt-0.5 h-4 w-4 shrink-0 text-yt-textMuted transition', descOpen && 'rotate-180')}
              aria-hidden
            />
          </div>
          {desc ? (
            <p
              className={cn(
                'mt-1 whitespace-pre-wrap text-sm leading-relaxed text-yt-text',
                descOpen ? '' : 'line-clamp-2'
              )}
            >
              {desc}
            </p>
          ) : null}
        </button>
      ) : null}
    </div>
  )
}
