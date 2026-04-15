import { useEffect, useMemo, useState } from 'react'
import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type Props =
  | {
      variant: 'search'
      channel: YouTubeChannelResult
      onAdd: () => void
      adding?: boolean
      manageLocked?: boolean
    }
  | {
      variant: 'whitelist'
      channel: WhitelistedChannel
      onRemove: () => void
      manageLocked?: boolean
    }

export function ChannelCard(props: Props) {
  const thumb = props.variant === 'search' ? props.channel.thumbnail : props.channel.channel_thumbnail
  const title = props.variant === 'search' ? props.channel.title : props.channel.channel_name
  const subs =
    props.variant === 'search' ? props.channel.subscriberCount : props.channel.subscriber_count
  const proxiedThumb = useMemo(() => {
    if (!thumb) return ''
    const noProtocol = thumb.replace(/^https?:\/\//, '')
    return `https://images.weserv.nl/?url=${encodeURIComponent(noProtocol)}`
  }, [thumb])
  const [imgSrc, setImgSrc] = useState(thumb || '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setImgSrc(thumb || '')
    setFailed(false)
  }, [thumb])

  const onImageError = () => {
    if (!imgSrc && !proxiedThumb) {
      setFailed(true)
      return
    }
    if (imgSrc === thumb && proxiedThumb && proxiedThumb !== thumb) {
      setImgSrc(proxiedThumb)
      return
    }
    setFailed(true)
  }

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {failed ? (
        <div
          className={cn(
            'h-14 w-14 shrink-0 rounded-lg bg-slate-100 text-center text-xs font-semibold leading-[56px] text-slate-500 dark:bg-zinc-800 dark:text-zinc-400'
          )}
          aria-hidden
        >
          אין תמונה
        </div>
      ) : (
        <img
          src={imgSrc || undefined}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={onImageError}
          className={cn('h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800')}
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
        {props.variant === 'whitelist' && props.channel.category ? (
          <p className="text-xs text-brand-600 dark:text-brand-400">{props.channel.category}</p>
        ) : null}
        {subs ? <p className="text-xs text-slate-500 dark:text-zinc-500">{subs} מנויים</p> : null}
      </div>
      {props.variant === 'search' ? (
        <Button className="shrink-0 self-center" onClick={props.onAdd} disabled={props.adding || props.manageLocked}>
          {props.adding ? '...' : 'הוסף'}
        </Button>
      ) : props.manageLocked ? null : (
        <Button variant="danger" className="shrink-0 self-center !py-2 !px-3 text-xs" onClick={props.onRemove}>
          הסר
        </Button>
      )}
    </div>
  )
}
