import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CleanPlayer } from '../player/CleanPlayer'
import { WatchBackButton } from '../player/WatchBackButton'
import { SafeTubeChannelAvatar } from '../ui/SafeTubeChannelAvatar'
import { YoutubeLikeButton } from '../youtube/YoutubeLikeButton'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import {
  SHORTS_LANE_BOTTOM_DEADZONE_PX,
  SHORTS_LANE_SWIPE_THRESHOLD_PX,
  useVerticalSwipeNav,
} from '../../hooks/useVerticalSwipeNav'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import { pauseAllPlayback } from '../../lib/playbackController'
import { SHORTS_LANE_CALM_BREAK_EVERY, SHORTS_LANE_HEART_XP } from '../../config/shortsLane'
import type { ShortsLaneItem } from '../../lib/shortsFeedRank'
import { cn } from '../../lib/utils'

type Props = {
  feed: ShortsLaneItem[]
  initialIndex?: number
  hideThumbnails?: boolean
  onClose: () => void
  onVideoChange?: (videoId: string) => void
}

const TOP_EXIT_THRESHOLD_PX = 72
const DOUBLE_TAP_MS = 320

export function KidShortsLane({
  feed,
  initialIndex = 0,
  hideThumbnails = false,
  onClose,
  onVideoChange,
}: Props) {
  const { t } = useTranslation()
  const lion = useLionProgressionOptional()
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(feed.length - 1, 0))
  )
  const [heartFlash, setHeartFlash] = useState(false)
  const [calmBreakOpen, setCalmBreakOpen] = useState(false)
  const [entered, setEntered] = useState(false)
  /** YouTube-like clear screen — hide meta/chrome overlays. */
  const [cleanScreen, setCleanScreen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const swipeCountRef = useRef(0)
  const lastTapRef = useRef(0)
  const chromeHideTimerRef = useRef<number | null>(null)
  const topExitRef = useRef<{ startY: number; tracking: boolean } | null>(null)

  const bumpShortsChrome = useCallback(() => {
    setChromeVisible(true)
    if (chromeHideTimerRef.current != null) window.clearTimeout(chromeHideTimerRef.current)
    if (cleanScreen) return
    chromeHideTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false)
      chromeHideTimerRef.current = null
    }, 2600)
  }, [cleanScreen])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    pauseAllPlayback()
    const id = window.requestAnimationFrame(() => setEntered(true))
    bumpShortsChrome()
    return () => {
      window.cancelAnimationFrame(id)
      document.body.style.overflow = ''
      if (chromeHideTimerRef.current != null) window.clearTimeout(chromeHideTimerRef.current)
    }
  }, [bumpShortsChrome])

  useEffect(() => {
    if (cleanScreen) {
      setChromeVisible(false)
      if (chromeHideTimerRef.current != null) window.clearTimeout(chromeHideTimerRef.current)
      return
    }
    bumpShortsChrome()
  }, [cleanScreen, bumpShortsChrome, activeIndex])

  const handleDoubleTapHeart = useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current <= DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      setHeartFlash(true)
      lion?.awardXp(SHORTS_LANE_HEART_XP)
      window.setTimeout(() => setHeartFlash(false), 700)
      bumpShortsChrome()
      return
    }
    lastTapRef.current = now
    const scheduledAt = now
    // Single tap → YouTube clear-screen toggle (after double-tap window).
    window.setTimeout(() => {
      if (lastTapRef.current !== scheduledAt) return
      setCleanScreen((v) => !v)
    }, DOUBLE_TAP_MS + 20)
  }, [lion, bumpShortsChrome])

  const activeItem = feed[activeIndex] ?? null
  const hasNext = activeIndex < feed.length - 1
  const hasPrevious = activeIndex > 0

  useEffect(() => {
    const idx = Math.min(Math.max(initialIndex, 0), Math.max(feed.length - 1, 0))
    setActiveIndex(idx)
  }, [initialIndex, feed.length])

  useEffect(() => {
    if (!activeItem) return
    onVideoChange?.(activeItem.videoId)
  }, [activeItem, onVideoChange])

  const goNext = useCallback(() => {
    setActiveIndex((idx) => {
      if (idx >= feed.length - 1) return idx
      const next = idx + 1
      swipeCountRef.current += 1
      if (
        SHORTS_LANE_CALM_BREAK_EVERY > 0 &&
        swipeCountRef.current > 0 &&
        swipeCountRef.current % SHORTS_LANE_CALM_BREAK_EVERY === 0
      ) {
        setCalmBreakOpen(true)
      }
      return next
    })
    bumpShortsChrome()
  }, [feed.length, bumpShortsChrome])

  const goPrevious = useCallback(() => {
    setActiveIndex((idx) => (idx > 0 ? idx - 1 : idx))
    bumpShortsChrome()
  }, [bumpShortsChrome])

  const { containerRef, handlers, dragOffsetY, swiping } = useVerticalSwipeNav({
    enabled: feed.length > 1,
    onSwipeUp: goNext,
    onSwipeDown: goPrevious,
    thresholdPx: SHORTS_LANE_SWIPE_THRESHOLD_PX,
    bottomDeadzonePx: SHORTS_LANE_BOTTOM_DEADZONE_PX,
  })

  const handleTopExitPointerDown = useCallback((e: React.PointerEvent) => {
    topExitRef.current = { startY: e.clientY, tracking: true }
    bumpShortsChrome()
  }, [bumpShortsChrome])

  const showLaneChrome = chromeVisible && !cleanScreen

  const handleTopExitPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const track = topExitRef.current
      if (!track?.tracking) return
      const dy = e.clientY - track.startY
      if (dy >= TOP_EXIT_THRESHOLD_PX) {
        topExitRef.current = null
        onClose()
      }
    },
    [onClose]
  )

  const handleTopExitPointerEnd = useCallback(() => {
    topExitRef.current = null
  }, [])

  if (!activeItem) {
    return null
  }

  const nextItem = hasNext ? feed[activeIndex + 1] : null

  return (
    <div
      className={cn(
        'safetube-shorts-lane fixed inset-0 z-[120] flex flex-col bg-black text-white transition-opacity duration-200 ease-out',
        entered ? 'opacity-100' : 'opacity-0'
      )}
      data-format="short"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortsLane.title')}
    >
      <header className="relative z-30 flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <WatchBackButton onClick={onClose} />
        <p className="pointer-events-none max-w-[45%] truncate text-center text-[11px] font-medium text-white/65">
          {t('shortsLane.swipeDownToExit')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-md ring-1 ring-white/20 backdrop-blur-md touch-manipulation active:scale-[0.97]"
          aria-label={t('shortsLane.close')}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onPointerDown={handleTopExitPointerDown}
        onPointerMove={handleTopExitPointerMove}
        onPointerUp={handleTopExitPointerEnd}
        onPointerCancel={handleTopExitPointerEnd}
        style={
          dragOffsetY
            ? {
                transform: `translate3d(0, ${dragOffsetY}px, 0)`,
                transition: swiping ? 'none' : 'transform 200ms ease-out',
              }
            : { transition: 'transform 200ms ease-out' }
        }
      >
        {nextItem && dragOffsetY < -24 && !hideThumbnails && nextItem.thumbnail ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 top-1/4 z-0 opacity-35"
            aria-hidden
          >
            <img src={nextItem.thumbnail} alt="" className="h-full w-full object-cover blur-sm" />
          </div>
        ) : null}

        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <div className="relative h-full min-h-0 w-full max-w-[min(100vw,520px)]">
            {/*
              No React key on CleanPlayer — videoId prop updates in place so the shell
              stays stable; CleanPlayer already handles src/session reset per id.
            */}
            <CleanPlayer
              videoId={activeItem.videoId}
              title={activeItem.title}
              channelTitle={activeItem.channelName}
              posterUrl={hideThumbnails ? null : activeItem.thumbnail}
              blankVideoFrame={hideThumbnails}
              onNextTrack={hasNext ? goNext : undefined}
              onPreviousTrack={hasPrevious ? goPrevious : undefined}
              hasNextTrack={hasNext}
              allowMobileExpand={false}
              immersive
              className="h-full w-full"
            />
            {/*
              Swipe capture leaves the bottom dead-zone open so accidental swipes near
              chrome/meta do not steal navigation; iframe keeps center play if needed.
            */}
            <div
              ref={containerRef as React.RefObject<HTMLDivElement>}
              {...handlers}
              className="absolute inset-x-0 top-0 z-[15] touch-pan-y"
              style={{ bottom: SHORTS_LANE_BOTTOM_DEADZONE_PX }}
              onClick={handleDoubleTapHeart}
            />
          </div>
        </div>

        {heartFlash ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <Heart className="h-24 w-24 animate-ping fill-rose-400/80 text-rose-400" aria-hidden />
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          'relative z-20 flex shrink-0 items-end justify-between gap-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 transition-opacity duration-200',
          showLaneChrome ? 'opacity-100' : 'opacity-0'
        )}
      >
        <div className="min-w-0 flex-1 rounded-2xl bg-black/55 px-3 py-2.5 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <SafeTubeChannelAvatar
              name={activeItem.channelName}
              thumbnail={activeItem.channelThumbnail}
              hide={hideThumbnails}
              className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/20"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold drop-shadow-sm">{activeItem.channelName}</p>
              <p className="line-clamp-2 text-xs text-white/85 drop-shadow-sm">{activeItem.title}</p>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-white/70">
            {t('shortsLane.position', { current: activeIndex + 1, total: feed.length })}
          </p>
        </div>
        <div
          className={cn(
            'flex shrink-0 flex-col items-center gap-3 pb-1',
            showLaneChrome ? 'pointer-events-auto' : 'pointer-events-none'
          )}
        >
          <YoutubeLikeButton videoId={activeItem.videoId} rail />
        </div>
      </div>

      <span className="sr-only">{t('shortsLane.swipeHint')}</span>

      <Modal
        open={calmBreakOpen}
        onClose={() => setCalmBreakOpen(false)}
        title={t('shortsLane.calmBreakTitle')}
      >
        <p className="text-sm leading-relaxed text-yt-textMuted">{t('shortsLane.calmBreakBody')}</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t('shortsLane.calmBreakExit')}
          </Button>
          <Button type="button" className="flex-1" onClick={() => setCalmBreakOpen(false)}>
            {t('shortsLane.calmBreakContinue')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
