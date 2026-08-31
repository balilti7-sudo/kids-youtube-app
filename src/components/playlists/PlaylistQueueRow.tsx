import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, ShieldBan, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { useHorizontalSwipeRow } from '../../hooks/useHorizontalSwipeRow'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import type { ParentPinVerifyResult } from '../../lib/verifyParentManagementPin'
import {
  setVideoHiddenAuthenticated,
  setVideoHiddenLocalParent,
  type HiddenVideoPayload,
} from '../../lib/hiddenVideos'
import { LoadingSpinner } from '../ui/LoadingSpinner'

export type PlaylistBlockConfig = {
  enabled: boolean
  deviceId?: string | null
  localAccessToken?: string | null
  cachedPin?: string | null
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
}

type Props = {
  active?: boolean
  index: number
  isFirst: boolean
  isLast: boolean
  reordering?: boolean
  onSelect?: () => void
  onRemove: () => void | Promise<void>
  onMoveUp: () => void | Promise<void>
  onMoveDown: () => void | Promise<void>
  blockConfig?: PlaylistBlockConfig | null
  blockVideo?: HiddenVideoPayload
  onBlocked?: () => void
  children: React.ReactNode
  className?: string
}

export function PlaylistQueueRow({
  active,
  index,
  isFirst,
  isLast,
  reordering,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
  blockConfig,
  blockVideo,
  onBlocked,
  children,
  className,
}: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<'remove' | 'block' | 'up' | 'down' | null>(null)
  const [pinOpen, setPinOpen] = useState(false)

  const canBlock = Boolean(blockConfig?.enabled && blockVideo && (blockConfig.deviceId || blockConfig.localAccessToken))

  const runBlock = useCallback(
    async (pin: string) => {
      if (!blockVideo || !blockConfig?.enabled) return
      setBusy('block')
      let err: Error | null = null

      if (blockConfig.localAccessToken) {
        const res = await setVideoHiddenLocalParent(blockConfig.localAccessToken, pin, blockVideo, true)
        err = res.error
      } else if (blockConfig.deviceId) {
        const res = await setVideoHiddenAuthenticated(blockConfig.deviceId, pin, blockVideo, true)
        err = res.error
      } else {
        err = new Error(t('playlists.cannotBlock'))
      }

      setBusy(null)
      setPinOpen(false)
      if (err) {
        toast.error(err.message)
        return
      }
      toast.success(t('playlists.blockedForeverToast'))
      onBlocked?.()
    },
    [blockConfig, blockVideo, onBlocked, t]
  )

  const requestBlock = useCallback(() => {
    if (!canBlock) {
      toast.info(t('playlists.blockNeedsParent'))
      return
    }
    const pin = blockConfig?.cachedPin?.replace(/\D/g, '').trim()
    if (pin && pin.length >= 4) {
      void runBlock(pin)
      return
    }
    setPinOpen(true)
  }, [blockConfig?.cachedPin, canBlock, runBlock, t])

  const { rowRef, handlers, dragOffsetX, swiping, reset } = useHorizontalSwipeRow({
    enabled: busy === null,
    onSwipeLeft: () => {
      if (busy) return
      setBusy('remove')
      void Promise.resolve(onRemove()).finally(() => {
        setBusy(null)
        reset()
      })
    },
    onSwipeRight: () => {
      if (busy) return
      requestBlock()
      reset()
    },
  })

  const showDeleteHint = dragOffsetX < -12
  const showBlockHint = dragOffsetX > 12

  return (
    <>
      <div className={cn('relative overflow-hidden rounded-xl', className)}>
        <div className="absolute inset-0 flex text-xs font-bold text-white" aria-hidden>
          <div
            className={cn(
              'flex flex-1 items-center justify-start gap-2 bg-red-700 px-3 transition-opacity',
              showBlockHint ? 'opacity-100' : 'opacity-80'
            )}
          >
            <ShieldBan className="h-4 w-4 shrink-0" />
            <span>{t('playlists.blockForever')}</span>
          </div>
          <div
            className={cn(
              'flex flex-1 items-center justify-end gap-2 bg-zinc-700 px-3 transition-opacity',
              showDeleteHint ? 'opacity-100' : 'opacity-80'
            )}
          >
            <span>{t('playlists.removeFromPlaylist')}</span>
            <Trash2 className="h-4 w-4 shrink-0" />
          </div>
        </div>

        <div
          ref={rowRef as React.RefObject<HTMLDivElement>}
          className={cn(
            'relative flex touch-pan-y items-stretch gap-1 bg-white transition-transform dark:bg-zinc-900',
            active && 'ring-1 ring-brand-400 dark:ring-brand-500/60',
            swiping && 'select-none'
          )}
          style={{
            transform: dragOffsetX !== 0 ? `translateX(${dragOffsetX}px)` : undefined,
            transition: swiping ? 'none' : 'transform 0.2s ease-out',
          }}
          {...handlers}
        >
          <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-slate-100 py-1 pl-1 pr-0.5 dark:border-zinc-800">
            <button
              type="button"
              aria-label={t('playlists.moveUp')}
              disabled={isFirst || reordering || busy !== null}
              onClick={(e) => {
                e.stopPropagation()
                setBusy('up')
                void Promise.resolve(onMoveUp()).finally(() => setBusy(null))
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              {busy === 'up' ? (
                <LoadingSpinner className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-4 w-4" aria-hidden />
              )}
            </button>
            <span className="text-center text-[10px] font-semibold tabular-nums text-slate-400">{index + 1}</span>
            <button
              type="button"
              aria-label={t('playlists.moveDown')}
              disabled={isLast || reordering || busy !== null}
              onClick={(e) => {
                e.stopPropagation()
                setBusy('down')
                void Promise.resolve(onMoveDown()).finally(() => setBusy(null))
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-zinc-800"
            >
              {busy === 'down' ? (
                <LoadingSpinner className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          <div
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onMouseDown={
              onSelect
                ? (e) => {
                    // Prevent focus scroll that jumps the page away from the player.
                    e.preventDefault()
                  }
                : undefined
            }
            onClick={onSelect}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect()
                    }
                  }
                : undefined
            }
            className={cn('min-w-0 flex-1 text-right', onSelect && 'cursor-pointer')}
          >
            {children}
          </div>

          <div className="flex shrink-0 flex-col items-center justify-center gap-1 border-r border-slate-100 px-1.5 py-1 dark:border-zinc-800">
            {canBlock ? (
              <button
                type="button"
                aria-label={t('playlists.blockForever')}
                title={t('playlists.blockForever')}
                disabled={busy !== null}
                onClick={(e) => {
                  e.stopPropagation()
                  requestBlock()
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                <ShieldBan className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t('playlists.removeFromPlaylist')}
              title={t('playlists.removeFromPlaylist')}
              disabled={busy !== null}
              onClick={(e) => {
                e.stopPropagation()
                if (busy) return
                setBusy('remove')
                void Promise.resolve(onRemove()).finally(() => setBusy(null))
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              {busy === 'remove' ? (
                <LoadingSpinner className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          {busy === 'remove' ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <LoadingSpinner className="h-5 w-5 border-2 border-brand-500 border-t-transparent" />
            </div>
          ) : null}
        </div>
      </div>

      {canBlock && blockConfig ? (
        <ParentalPinModal
          open={pinOpen}
          onClose={() => setPinOpen(false)}
          verifyPin={blockConfig.verifyPin}
          onVerified={(pin) => void runBlock(pin)}
          title="אימות הורה — חסימה לצמיתות"
          description="הזינו קוד הורה כדי לחסום את הסרטון מהילד לצמיתות."
        />
      ) : null}
    </>
  )
}

export function PlaylistQueueHint() {
  const { t } = useTranslation()
  return (
    <p className="mb-2 text-[11px] leading-relaxed text-slate-500 dark:text-zinc-500">
      {t('playlists.queueHint')}
    </p>
  )
}
