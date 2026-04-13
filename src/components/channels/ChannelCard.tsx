import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type Props =
  | {
      variant: 'search'
      channel: YouTubeChannelResult
      onAdd: () => void
      adding?: boolean
    }
  | {
      variant: 'whitelist'
      channel: WhitelistedChannel
      onRemove: () => void
    }

export function ChannelCard(props: Props) {
  const thumb = props.variant === 'search' ? props.channel.thumbnail : props.channel.channel_thumbnail
  const title = props.variant === 'search' ? props.channel.title : props.channel.channel_name
  const subs =
    props.variant === 'search' ? props.channel.subscriberCount : props.channel.subscriber_count

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <img
        src={thumb || undefined}
        alt=""
        className={cn('h-14 w-14 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800')}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
        {subs ? <p className="text-xs text-slate-500 dark:text-zinc-500">{subs} מנויים</p> : null}
      </div>
      {props.variant === 'search' ? (
        <Button className="shrink-0 self-center" onClick={props.onAdd} disabled={props.adding}>
          {props.adding ? '...' : 'הוסף'}
        </Button>
      ) : (
        <Button variant="danger" className="shrink-0 self-center !py-2 !px-3 text-xs" onClick={props.onRemove}>
          הסר
        </Button>
      )}
    </div>
  )
}
