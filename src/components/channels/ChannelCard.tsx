import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import type { WhitelistedChannel, YouTubeChannelResult } from '../../types'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { PlaylistSelectCheckbox } from '../playlists/PlaylistMultiSelectToolbar'
import { cn } from '../../lib/utils'

type Props =
  | {
      variant: 'search'
      channel: YouTubeChannelResult
      onAdd: () => void
      /** When the channel is already whitelisted, show הסר instead of a disabled נוסף. */
      onRemove?: () => void
      adding?: boolean
      added?: boolean
    }
  | {
      variant: 'whitelist'
      channel: WhitelistedChannel
      onRemove: () => void
      onOpenChannel: () => void
      selectionMode?: boolean
      selected?: boolean
      onToggleSelect?: () => void
    }

export function ChannelCard(props: Props) {
  const { t } = useTranslation()
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

  const selectionMode = props.variant === 'whitelist' && Boolean(props.selectionMode)
  const selected = props.variant === 'whitelist' && Boolean(props.selected)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border bg-white p-2.5 dark:bg-zinc-900 sm:gap-3 sm:p-3',
        selected
          ? 'border-brand-500/50 ring-1 ring-brand-500/30'
          : 'border-slate-200 dark:border-zinc-800'
      )}
    >
      {selectionMode ? (
        <PlaylistSelectCheckbox
          checked={selected}
          onChange={() => props.variant === 'whitelist' && props.onToggleSelect?.()}
          label={selected ? 'הסר מהבחירה' : 'בחר ערוץ'}
          className="self-center !h-11 !w-11"
        />
      ) : null}
      {failed ? (
        <div
          className={cn(
            'h-11 w-11 shrink-0 rounded-lg bg-slate-100 text-center text-[10px] font-semibold leading-[44px] text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 sm:h-14 sm:w-14 sm:text-xs sm:leading-[56px]'
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
          className={cn(
            'h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800 sm:h-14 sm:w-14'
          )}
        />
      )}
      <button
        type="button"
        className="min-w-0 flex-1 overflow-hidden text-right"
        onClick={() => {
          if (props.variant === 'whitelist' && selectionMode) {
            props.onToggleSelect?.()
            return
          }
          if (props.variant === 'whitelist') props.onOpenChannel()
        }}
      >
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100 sm:text-base">
          {title}
        </p>
        {props.variant === 'whitelist' && props.channel.category ? (
          <p className="truncate text-xs text-brand-600 dark:text-brand-400">{props.channel.category}</p>
        ) : null}
        {subs ? (
          <p className="truncate text-xs text-slate-500 dark:text-zinc-500">{subs} מנויים</p>
        ) : null}
      </button>
      {props.variant === 'search' ? (
        props.added && props.onRemove ? (
          <Button
            type="button"
            variant="danger"
            className="!h-9 !min-h-9 !min-w-0 shrink-0 self-center !gap-1 !rounded-full !px-2.5 !py-0 text-xs font-bold sm:!px-3"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              props.onRemove?.()
            }}
            aria-label={t('channels.removeChannel')}
          >
            {t('common.remove')}
          </Button>
        ) : (
          <Button
            className={cn(
              '!h-9 !min-h-9 !min-w-0 shrink-0 self-center !gap-1 !rounded-full !px-2.5 !py-0 text-xs font-bold sm:!px-3',
              props.added ? '!bg-emerald-600 hover:!bg-emerald-600' : ''
            )}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              props.onAdd()
            }}
            disabled={props.adding || props.added}
            aria-busy={Boolean(props.adding) && !props.added}
            aria-label={
              props.added
                ? t('channels.channelAdded')
                : props.adding
                  ? t('channels.addingChannel')
                  : t('channels.addChannel')
            }
          >
            {props.added ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t('channels.added')}
              </span>
            ) : props.adding ? (
              <span className="inline-flex items-center gap-1">
                <LoadingSpinner className="h-3.5 w-3.5 border-2 border-white border-t-transparent" aria-hidden />
                {t('channels.adding')}
              </span>
            ) : (
              t('common.add')
            )}
          </Button>
        )
      ) : selectionMode ? null : (
        <div className="flex shrink-0 flex-col gap-1 self-center sm:flex-row sm:items-center">
          <Button type="button" variant="secondary" className="!px-3 !py-2 text-xs whitespace-nowrap" onClick={props.onOpenChannel}>
            {t('channels.enterChannel')}
          </Button>
          <Button variant="danger" className="!px-3 !py-2 text-xs whitespace-nowrap" onClick={props.onRemove}>
            {t('common.remove')}
          </Button>
        </div>
      )}
    </div>
  )
}
