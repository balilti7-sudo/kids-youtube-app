import { useCallback, useState } from 'react'
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

type Props = {
  title: string
  channelName?: string | null
  compact?: boolean
  /** Vertical Shorts rail (icon + label). */
  rail?: boolean
  className?: string
}

function shareText(title: string, channelName?: string | null): string {
  const name = (channelName || '').trim()
  const clip = title.trim() || 'SafeTube'
  return name ? `${clip} — ${name} · SafeTube` : `${clip} · SafeTube`
}

/**
 * In-app share only — title + channel, never a youtube.com / YouTube-app link.
 */
export function YoutubeShareButton({ title, channelName, compact, rail, className }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const share = useCallback(async () => {
    if (busy) return
    const text = shareText(title, channelName)
    setBusy(true)
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: 'SafeTube', text })
        return
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        toast.success(t('player.shareCopied'))
        return
      }
      toast.error(t('player.shareFailed'))
    } catch (err) {
      const name = err instanceof Error ? err.name : ''
      if (name === 'AbortError') return
      toast.error(t('player.shareFailed'))
    } finally {
      setBusy(false)
    }
  }, [busy, title, channelName, t])

  if (rail) {
    return (
      <button
        type="button"
        onClick={() => void share()}
        disabled={busy}
        className={cn(
          'flex flex-col items-center gap-1 text-white touch-manipulation active:scale-95',
          className
        )}
        aria-label={t('player.share')}
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/20">
          <Share2 className="h-6 w-6" aria-hidden />
        </span>
        <span className="text-[11px] font-semibold drop-shadow">{t('player.share')}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      disabled={busy}
      className={cn(
        compact
          ? 'inline-flex h-8 items-center gap-1 rounded-full bg-yt-surfaceHover px-2.5 text-xs font-semibold text-yt-text'
          : 'inline-flex h-9 items-center gap-2 rounded-full bg-yt-surfaceHover px-3.5 text-sm font-semibold text-yt-text hover:bg-[#3f3f3f]/80',
        className
      )}
      aria-label={t('player.share')}
    >
      <Share2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
      {t('player.share')}
    </button>
  )
}
