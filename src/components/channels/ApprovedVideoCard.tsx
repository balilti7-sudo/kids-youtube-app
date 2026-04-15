import type { WhitelistedVideo, YouTubeVideoResult } from '../../types'
import { Button } from '../ui/Button'

type Props =
  | {
      variant: 'search'
      video: YouTubeVideoResult
      onAdd: () => void
      adding?: boolean
    }
  | {
      variant: 'approved'
      video: WhitelistedVideo
      onRemove: () => void
    }

export function ApprovedVideoCard(props: Props) {
  const title = props.variant === 'search' ? props.video.title : props.video.title
  const thumb = props.variant === 'search' ? props.video.thumbnail : props.video.thumbnail_url
  const subtitle = props.variant === 'search' ? props.video.channelTitle : props.video.youtube_video_id

  return (
    <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      {thumb ? (
        <img
          src={thumb}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-14 w-24 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800"
        />
      ) : (
        <div className="h-14 w-24 shrink-0 rounded-lg bg-slate-100 dark:bg-zinc-800" />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-zinc-100">{title}</p>
        {subtitle ? <p className="truncate text-xs text-slate-500 dark:text-zinc-500">{subtitle}</p> : null}
      </div>
      {props.variant === 'search' ? (
        <Button className="shrink-0 self-center" onClick={props.onAdd} disabled={props.adding}>
          {props.adding ? '...' : 'הוסף'}
        </Button>
      ) : (
        <Button variant="danger" className="shrink-0 self-center !px-3 !py-2 text-xs" onClick={props.onRemove}>
          הסר
        </Button>
      )}
    </div>
  )
}
