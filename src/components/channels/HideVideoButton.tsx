import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import {
  setVideoHiddenForDevice,
  setVideoHiddenLocalParent,
} from '../../lib/hiddenVideos'

type Props = {
  deviceId: string | null
  youtubeVideoId: string
  youtubeChannelId?: string | null
  hidden: boolean
  compact?: boolean
  className?: string
  localAccessToken?: string | null
  getLocalParentPin?: () => string | null
  onChanged?: (hidden: boolean) => void
}

export function HideVideoButton({
  deviceId,
  youtubeVideoId,
  youtubeChannelId,
  hidden,
  compact,
  className,
  localAccessToken,
  getLocalParentPin,
  onChanged,
}: Props) {
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    if (!deviceId && !localAccessToken) return
    setBusy(true)
    const nextHidden = !hidden
    let err: Error | null = null

    if (localAccessToken) {
      const pin = getLocalParentPin?.() ?? ''
      const res = await setVideoHiddenLocalParent(
        localAccessToken,
        pin,
        youtubeVideoId,
        nextHidden,
        youtubeChannelId
      )
      err = res.error
    } else if (deviceId) {
      const res = await setVideoHiddenForDevice(
        deviceId,
        youtubeVideoId,
        nextHidden,
        youtubeChannelId
      )
      err = res.error
    }

    setBusy(false)
    if (!err) onChanged?.(nextHidden)
  }

  return (
    <button
      type="button"
      disabled={busy || (!deviceId && !localAccessToken)}
      aria-label={hidden ? 'הצג לילד' : 'הסתר מהילד'}
      title={hidden ? 'הצג לילד' : 'הסתר מהילד'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 font-bold transition',
        hidden
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200',
        compact ? 'min-h-[40px] min-w-[40px] px-2 text-xs' : 'min-h-[48px] px-3 text-sm',
        className
      )}
      onClick={(e) => {
        e.stopPropagation()
        void toggle()
      }}
    >
      {busy ? (
        <LoadingSpinner className="h-4 w-4 border-2 border-current border-t-transparent" />
      ) : hidden ? (
        <Eye className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      ) : (
        <EyeOff className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
      )}
      {!compact ? <span>{hidden ? 'מוסתר' : 'הסתר מהילד'}</span> : null}
    </button>
  )
}
