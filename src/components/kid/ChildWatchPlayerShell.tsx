import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, X } from 'lucide-react'
import type { ContentShape } from '../../lib/videoFormatClassification'
import { useStickyMiniPlayer } from '../../hooks/useStickyMiniPlayer'
import { CleanPlayer } from '../player/CleanPlayer'
import { PlayerAmbientFrame } from '../player/PlayerAmbientFrame'
import { WatchBackButton } from '../player/WatchBackButton'
import { PlayerModeProvider } from '../../contexts/PlayerModeContext'
import { PLAYER_THEATER_STATE_CHANGED } from '../../lib/playerTheater'
import { cn } from '../../lib/utils'

export type ChildWatchPlayerShellProps = {
  videoId: string
  title: string
  channelTitle?: string
  posterUrl?: string | null
  format: ContentShape
  blankVideoFrame?: boolean
  durationSeconds?: number | null
  onPreviousTrack?: () => void
  onNextTrack?: () => void
  hasNextTrack?: boolean
  /** Close/dismiss MiniPlayer → leave Watch (same CleanPlayer unmounts with page state). */
  onMiniDismiss?: () => void
  /** YouTube-style back — leave watch and restore the channel browse position. */
  onBack?: () => void
}

const MINI_DOUBLE_TAP_MS = 280

/**
 * Watch Surface — layout/geometry only around CleanPlayer.
 * MiniPlayer: same mounted CleanPlayer — drag, double-tap size, tap restore, X dismiss.
 */
function ChildWatchPlayerShellBody(props: ChildWatchPlayerShellProps) {
  const {
    videoId,
    title,
    channelTitle,
    posterUrl,
    format,
    blankVideoFrame = false,
    durationSeconds,
    onPreviousTrack,
    onNextTrack,
    hasNextTrack,
    onMiniDismiss,
    onBack,
  } = props
  const isShort = format === 'short'
  const onNextRef = useRef(onNextTrack)
  const onPrevRef = useRef(onPreviousTrack)
  onNextRef.current = onNextTrack
  onPrevRef.current = onPreviousTrack

  const stableNext = useCallback(() => onNextRef.current?.(), [])
  const stablePrev = useCallback(() => onPrevRef.current?.(), [])

  const sticky = useStickyMiniPlayer({
    enabled: !isShort && !blankVideoFrame,
    resetKey: videoId,
  })

  const [miniLarge, setMiniLarge] = useState(false)
  const [miniOffset, setMiniOffset] = useState({ x: 0, y: 0 })
  const [theaterActive, setTheaterActive] = useState(false)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    dragged: boolean
  } | null>(null)
  const lastTapRef = useRef(0)

  useEffect(() => {
    if (!sticky.isMini) {
      setMiniOffset({ x: 0, y: 0 })
      setMiniLarge(false)
    }
  }, [sticky.isMini, videoId])

  useEffect(() => {
    const sync = () => {
      setTheaterActive(
        typeof document !== 'undefined' &&
          document.documentElement.classList.contains('safetube-theater')
      )
    }
    sync()
    window.addEventListener(PLAYER_THEATER_STATE_CHANGED, sync)
    return () => window.removeEventListener(PLAYER_THEATER_STATE_CHANGED, sync)
  }, [])

  const expandFromMini = useCallback(() => {
    sticky.sentinelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [sticky.sentinelRef])

  const onMiniPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-mini-dismiss]')) return
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: miniOffset.x,
        originY: miniOffset.y,
        dragged: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [miniOffset]
  )

  const onMiniPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.dragged = true
    if (!drag.dragged) return
    setMiniOffset({ x: drag.originX + dx, y: drag.originY + dy })
  }, [])

  const onMiniPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || drag.pointerId !== e.pointerId) return
      if (drag.dragged) {
        // Edge hide: drag far toward the end edge → dismiss
        if (onMiniDismiss && Math.abs(miniOffset.x) > Math.min(window.innerWidth * 0.35, 140)) {
          onMiniDismiss()
        }
        return
      }
      const now = Date.now()
      if (now - lastTapRef.current <= MINI_DOUBLE_TAP_MS) {
        lastTapRef.current = 0
        setMiniLarge((v) => !v)
        return
      }
      lastTapRef.current = now
      const scheduledAt = now
      window.setTimeout(() => {
        if (lastTapRef.current !== scheduledAt) return
        expandFromMini()
      }, MINI_DOUBLE_TAP_MS)
    },
    [expandFromMini, miniOffset.x, onMiniDismiss]
  )

  const fillStage = isShort || sticky.isMini

  // Always the same parent node around CleanPlayer. Switching between
  // `{fill ? <div/> : player}` remounted the iframe on long↔short / mini
  // and showed Android's black SurfaceView + green robot placeholder.

  return (
    <>
      {onBack && !sticky.isMini && !theaterActive ? (
        <div className="mb-2 flex items-center px-0.5">
          <WatchBackButton onClick={onBack} />
        </div>
      ) : null}
      <div ref={sticky.sentinelRef} className="h-0 w-full scroll-mt-chrome" aria-hidden />
      <div
        ref={sticky.slotRef}
        className="relative w-full"
        style={sticky.slotStyle}
        data-safetube-sticky-slot={sticky.isMini ? 'mini' : 'primary'}
        data-safetube-watch-surface="true"
      >
        <div
          className={cn(
            'relative transition-[transform,opacity,width] duration-200 ease-out',
            sticky.isMini &&
              'safetube-mini-player fixed z-[90] overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/55 ring-1 ring-white/20',
            sticky.isMini &&
              (miniLarge
                ? 'w-[min(72vw,320px)] max-w-[320px]'
                : 'w-[min(42vw,200px)] max-w-[200px]')
          )}
          style={
            sticky.isMini
              ? {
                  bottom: `max(0.75rem, env(safe-area-inset-bottom, 0px))`,
                  insetInlineEnd: `max(0.75rem, env(safe-area-inset-right, 0px))`,
                  transform: `translate3d(${miniOffset.x}px, ${miniOffset.y}px, 0)`,
                  touchAction: 'none',
                }
              : undefined
          }
          onPointerDown={sticky.isMini ? onMiniPointerDown : undefined}
          onPointerMove={sticky.isMini ? onMiniPointerMove : undefined}
          onPointerUp={sticky.isMini ? onMiniPointerUp : undefined}
          onPointerCancel={sticky.isMini ? onMiniPointerUp : undefined}
        >
          <PlayerAmbientFrame
            posterUrl={blankVideoFrame ? null : posterUrl}
            colorSeed={videoId}
            enabled={!blankVideoFrame && !sticky.isMini}
            className={cn(sticky.isMini ? 'rounded-xl' : 'sm:rounded-xl')}
          >
            <div
              className={cn(
                'safetube-watch-stage relative overflow-hidden bg-black touch-manipulation',
                sticky.isMini
                  ? 'safetube-watch-stage--mini w-full rounded-xl'
                  : isShort
                    ? 'safetube-watch-stage--short mx-auto w-full max-w-[min(100%,420px)] sm:rounded-xl'
                    : 'safetube-watch-stage--long w-full max-w-full sm:rounded-xl'
              )}
              data-format={isShort ? 'short' : 'long'}
              data-mini-player={sticky.isMini ? 'true' : undefined}
              aria-roledescription={isShort ? 'shorts player' : undefined}
            >
              <div className={cn('min-h-0 w-full', fillStage ? 'absolute inset-0' : 'relative')}>
                <CleanPlayer
                  videoId={videoId}
                  title={title}
                  channelTitle={channelTitle}
                  posterUrl={blankVideoFrame ? null : posterUrl}
                  blankVideoFrame={blankVideoFrame}
                  durationSeconds={durationSeconds}
                  onPreviousTrack={stablePrev}
                  onNextTrack={stableNext}
                  hasNextTrack={hasNextTrack}
                  className={fillStage ? 'h-full w-full' : 'w-full'}
                />
              </div>
            </div>
          </PlayerAmbientFrame>

          {sticky.isMini ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[96] bg-gradient-to-t from-black/85 via-black/35 to-transparent px-2 pb-1.5 pt-8">
                <p className="truncate text-[10px] font-semibold text-white/95">{title}</p>
                <p className="text-[9px] font-medium text-white/65">הקש · גרור · הקש כפול לגודל</p>
              </div>
              <span
                className="pointer-events-none absolute end-1.5 top-1.5 z-[96] inline-flex h-8 w-8 items-center justify-center rounded-lg bg-black/70 text-white ring-1 ring-white/25"
                aria-hidden
              >
                <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              </span>
              {onMiniDismiss ? (
                <button
                  type="button"
                  data-mini-dismiss
                  onClick={(e) => {
                    e.stopPropagation()
                    onMiniDismiss()
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute start-1 top-1 z-[97] inline-flex h-9 w-9 items-center justify-center rounded-lg bg-black/80 text-white ring-1 ring-white/30 backdrop-blur-sm touch-manipulation active:scale-95"
                  aria-label="סגור נגן ממוזער"
                  title="סגור"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}

function ChildWatchPlayerShellInner(props: ChildWatchPlayerShellProps) {
  return (
    <PlayerModeProvider contentShape={props.format}>
      <ChildWatchPlayerShellBody {...props} />
    </PlayerModeProvider>
  )
}

function propsAreEqual(prev: ChildWatchPlayerShellProps, next: ChildWatchPlayerShellProps) {
  return (
    prev.videoId === next.videoId &&
    prev.format === next.format &&
    prev.blankVideoFrame === next.blankVideoFrame &&
    prev.durationSeconds === next.durationSeconds &&
    prev.hasNextTrack === next.hasNextTrack &&
    prev.onMiniDismiss === next.onMiniDismiss &&
    prev.onBack === next.onBack
  )
}

/** Memoized watch player shell — avoids re-init when sidebar/recommendations update. */
export const ChildWatchPlayerShell = memo(ChildWatchPlayerShellInner, propsAreEqual)
