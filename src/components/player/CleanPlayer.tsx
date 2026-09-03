import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { Capacitor } from '@capacitor/core'
import { toast } from 'sonner'
import {
  Lock,
  LockOpen,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Repeat,
  SkipBack,
  SkipForward,
} from 'lucide-react'
import Hls from 'hls.js'
import { setMediaPlaybackActive, syncNativeMediaSession } from '../../lib/mediaPlaybackActivity'
import { subscribeNativeMediaActions } from '../../lib/nativeMediaPlayback'
import {
  youtubeIframePause,
  youtubeIframePlay,
  youtubeIframeSeekTo,
} from '../../lib/youtubeIframeCommands'
import { touchParentalGateActivity } from '../../lib/parentalGateActivity'
import { cn } from '../../lib/utils'
import { registerPlaybackPauseHandler } from '../../lib/playbackController'
import {
  requestPlayerChromeHold,
  requestPlayerChromeRelease,
  useAutoHidePlayerChrome,
} from '../../hooks/useAutoHidePlayerChrome'
import {
  QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC,
  useQueueAutoAdvanceTimer,
} from '../../hooks/useQueueAutoAdvanceTimer'
import { useWatchTheaterMode } from '../../hooks/useWatchTheaterMode'
import { isPlayerExpanded } from '../../lib/playerTheater'
import {
  enterPlayerGestureFullscreen,
  exitPlayerGestureFullscreen,
} from '../../hooks/usePlayerTouchGestures'
import { buildYoutubePrivacyEmbedUrl, sanitizeYoutubeVideoId } from '../../lib/youtubeEmbedUrl'
import { PlayerGestureOverlay } from './PlayerGestureOverlay'
import {
  buildSmoothHlsAbrConfig,
  decideAdaptiveProgressiveTarget,
  getForwardBufferSeconds,
  getNetworkQualityHint,
  playbackQualityHeight,
} from '../../lib/adaptivePlaybackQuality'
import { attachPlayerAudioNormalizer, type PlayerAudioNormalizer } from '../../lib/playerAudioNormalizer'
import {
  fetchStreamInfo,
  getStreamApiBaseUrl,
  STREAM_START_QUALITY,
  streamResponseToSource,
  type StreamApiResponse,
} from '../../lib/streamApi'
import { classifyPlaybackFailure, logPlaybackFailure } from '../../lib/playerPlaybackErrors'
import { UpcomingLiveLionOverlay } from './UpcomingLiveLionOverlay'
import { PlayerErrorOverlay } from './PlayerErrorOverlay'
import { DailyLimitOverlay } from '../kid/DailyLimitOverlay'
import { fetchVideoDetailsBatch } from '../../lib/youtube'
import { assertChildPlaybackAllowedForStream } from '../../lib/childRuntime'
import { useDailyWatchBudgetStore } from '../../stores/dailyWatchBudgetStore'

const YOUTUBE_IFRAME_PLAYER = import.meta.env.VITE_YOUTUBE_IFRAME_PLAYER === 'true'

function scheduleAdaptiveQuality(
  el: HTMLVideoElement,
  vid: string,
  startInfo: StreamApiResponse,
  detachHls: () => void,
  onQualityChanged: (info: StreamApiResponse) => void,
  opts?: { skip?: boolean }
): () => void {
  if (opts?.skip) return () => {}

  let cancelled = false
  let currentInfo = startInfo
  let switching = false
  let cooldownUntil = 0
  let recentlyWaiting = false
  let waitingClearTimer: number | null = null
  const COOLDOWN_MS = 18_000
  const POLL_MS = 4_000

  const onWaiting = () => {
    recentlyWaiting = true
    if (waitingClearTimer != null) window.clearTimeout(waitingClearTimer)
    waitingClearTimer = window.setTimeout(() => {
      recentlyWaiting = false
      waitingClearTimer = null
    }, 6_000)
  }

  const onPlaying = () => {
    // Keep recentlyWaiting sticky briefly after recovery so we can decide downgrade.
  }

  el.addEventListener('waiting', onWaiting)
  el.addEventListener('playing', onPlaying)

  const trySwitch = async () => {
    if (cancelled || switching) return
    const decision = decideAdaptiveProgressiveTarget({
      currentQuality: currentInfo.quality,
      forwardBufferSec: getForwardBufferSeconds(el),
      recentlyWaiting,
      cooldownActive: Date.now() < cooldownUntil,
    })
    if (decision.reason === 'hold') return

    const currentH = playbackQualityHeight(currentInfo.quality || STREAM_START_QUALITY)
    const targetH = playbackQualityHeight(decision.quality)
    if (targetH === currentH) return

    // Extra guard: never upgrade while buffer is thin.
    if (decision.reason === 'upgrade' && getForwardBufferSeconds(el) < 8) return

    switching = true
    try {
      const next = await fetchStreamInfo(vid, { quality: decision.quality })
      if (cancelled) return
      const nextH = playbackQualityHeight(next.quality)
      if (decision.reason === 'upgrade' && nextH <= currentH) return
      if (decision.reason === 'downgrade' && nextH >= currentH) return

      console.info(
        `[CleanPlayer] adaptive ${decision.reason} ${vid} ${currentInfo.quality || '?'} -> ${next.quality || decision.quality}`
      )

      const ok = await swapVideoSourcePreservingTime(el, next, detachHls)
      if (!ok || cancelled) return

      currentInfo = next
      cooldownUntil = Date.now() + COOLDOWN_MS
      recentlyWaiting = false
      onQualityChanged(next)
    } catch (err) {
      if (!cancelled) {
        console.warn(
          '[CleanPlayer] adaptive quality skipped:',
          err instanceof Error ? err.message : err
        )
      }
    } finally {
      switching = false
    }
  }

  const poll = () => {
    if (cancelled) return
    void trySwitch()
  }

  let pollTimer: number | null = null
  let started = false
  const startPolling = () => {
    if (cancelled || started) return
    started = true
    pollTimer = window.setInterval(poll, POLL_MS)
    // First evaluation after playback has a chance to buffer.
    window.setTimeout(poll, 5_000)
  }

  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    startPolling()
  } else {
    el.addEventListener('canplay', startPolling, { once: true })
  }

  return () => {
    cancelled = true
    el.removeEventListener('waiting', onWaiting)
    el.removeEventListener('playing', onPlaying)
    el.removeEventListener('canplay', startPolling)
    if (pollTimer != null) window.clearInterval(pollTimer)
    if (waitingClearTimer != null) window.clearTimeout(waitingClearTimer)
  }
}

/** If the upgraded source doesn't produce metadata within this budget, revert to the old URL. */
const SOURCE_SWAP_WATCHDOG_MS = 12_000

async function swapVideoSourcePreservingTime(
  el: HTMLVideoElement,
  info: StreamApiResponse,
  detachHls: () => void
): Promise<boolean> {
  const { src } = streamResponseToSource(info)
  const savedTime = el.currentTime
  const wasPlaying = !el.paused && !el.ended
  const previousSrc = el.currentSrc || el.src
  const previousVolume = el.volume
  const previousMuted = el.muted

  // Soften audible glitches while the decoder rebinds the new progressive URL.
  el.muted = true

  detachHls()
  el.removeAttribute('src')

  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      window.clearTimeout(watchdog)
      el.removeEventListener('loadedmetadata', onReady)
      el.removeEventListener('error', onErr)
    }

    const restoreAudio = () => {
      el.muted = previousMuted
      try {
        el.volume = previousVolume
      } catch {
        /* ignore */
      }
    }

    const seekToSavedTime = () => {
      try {
        const duration = Number.isFinite(el.duration) ? el.duration : savedTime
        el.currentTime = Math.min(Math.max(0, savedTime), duration)
      } catch {
        /* ignore seek errors */
      }
    }

    const revertToPreviousSource = (reason: string) => {
      if (settled) return
      settled = true
      cleanup()
      console.warn(`[CleanPlayer] quality swap ${reason} — reverting to previous source`)
      if (previousSrc && previousSrc.startsWith('http')) {
        el.addEventListener(
          'loadedmetadata',
          () => {
            seekToSavedTime()
            restoreAudio()
            if (wasPlaying) void el.play().catch(() => {})
          },
          { once: true }
        )
        el.src = previousSrc
        el.load()
      } else {
        restoreAudio()
      }
      resolve(false)
    }

    const onReady = () => {
      if (settled) return
      settled = true
      cleanup()
      seekToSavedTime()
      const finish = () => {
        restoreAudio()
        resolve(true)
      }
      if (wasPlaying) {
        void el.play().finally(finish)
      } else {
        finish()
      }
    }

    const onErr = () => revertToPreviousSource('failed')

    const watchdog = window.setTimeout(
      () => revertToPreviousSource(`stalled after ${SOURCE_SWAP_WATCHDOG_MS}ms`),
      SOURCE_SWAP_WATCHDOG_MS
    )

    el.addEventListener('loadedmetadata', onReady, { once: true })
    el.addEventListener('error', onErr, { once: true })
    el.src = src
    el.load()
  })
}

export type CleanPlayerProps = {
  videoId: string
  title: string
  className?: string
  /** Shown as lock-screen / notification “artist” (e.g. channel name). */
  channelTitle?: string
  /** Poster / artwork; falls back to YouTube thumbnail URLs for `videoId`. */
  posterUrl?: string | null
  /**
   * Parental “hide thumbnails”: keep playback/audio running but show a black frame
   * (no poster / visible video pixels).
   */
  blankVideoFrame?: boolean
  /** Lock screen / headset “next” — omit to hide the control where supported. */
  onNextTrack?: () => void
  /** Lock screen / headset “previous”. */
  onPreviousTrack?: () => void
  /** When false, the “next” button is disabled (e.g. last item in channel/playlist). */
  hasNextTrack?: boolean
  /** Kid queue bar (next + loop). Default: true when `onNextTrack` is provided. */
  queueControls?: boolean
  /**
   * Mobile “maximize” control. Disable when the host is already immersive
   * (e.g. Shorts lane) so kids are not trapped in a nested fullscreen.
   */
  allowMobileExpand?: boolean
  /** Fired once when playback actually starts for a video (both paths). */
  onVideoPlaybackStarted?: (videoId: string) => void
  /** Fired when the underlying media element starts or stops playing (for watch-time breaks). */
  onPlaybackActiveChange?: (playing: boolean) => void
  /** Current playback position in seconds (native `<video>` path only; throttled ~1 Hz). */
  onPlaybackTimeUpdate?: (currentTimeSeconds: number) => void
  /** Catalog duration — used for iframe auto-advance when `ended` is unavailable. */
  durationSeconds?: number | null
  /**
   * Immersive host (Shorts lane): no under-player chrome — video fills the frame.
   * Does not change stream/embed path.
   */
  immersive?: boolean
}

const END_OF_PLAYLIST_TOAST = 'הגעת לסוף הפלייליסט'

function useNextVideoHandler(onNextTrack?: () => void, hasNextTrack = true) {
  return useCallback(() => {
    if (!onNextTrack) return
    if (hasNextTrack) {
      onNextTrack()
      return
    }
    toast.message(END_OF_PLAYLIST_TOAST, { duration: 2800 })
  }, [onNextTrack, hasNextTrack])
}

const CONTROL_BTN_GHOST =
  'inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-white/95 drop-shadow-md transition active:scale-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40'

const CONTROL_BTN_CENTER =
  'inline-flex h-16 w-16 shrink-0 touch-manipulation items-center justify-center rounded-full bg-black/55 text-white shadow-xl ring-1 ring-white/25 backdrop-blur-[2px] transition active:scale-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/70'

const CONTROL_BTN_SECONDARY =
  'inline-flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-full bg-black/35 text-white/90 ring-1 ring-white/15 backdrop-blur-[2px] transition active:scale-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40'

function playerFillsParentHeight(className?: string) {
  return Boolean(className && (/\bh-full\b/.test(className) || /\binset-0\b/.test(className)))
}

const CONTROL_BTN_ACTIVE_CLASS = 'bg-brand-600/90 ring-brand-300/50 text-white'

function formatPlayerClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function PlayerControlBar({
  loopEnabled,
  onLoopToggle,
  onNext,
  onPrevious,
  showQueueControls,
  tapsLocked,
  onTapsLockToggle,
  className,
  videoRef,
  iframeRef,
  fullscreenRootRef,
  allowMobileExpand = true,
  onIframePlayingChange,
  /** When false, buttons stay non-focusable (hidden chrome). */
  interactive = true,
}: {
  loopEnabled: boolean
  onLoopToggle: () => void
  onNext: () => void
  onPrevious?: () => void
  hasNext?: boolean
  showQueueControls: boolean
  tapsLocked?: boolean
  onTapsLockToggle?: () => void
  className?: string
  videoRef?: RefObject<HTMLVideoElement | null>
  iframeRef?: RefObject<HTMLIFrameElement | null>
  fullscreenRootRef?: RefObject<HTMLElement | null>
  allowMobileExpand?: boolean
  onIframePlayingChange?: (playing: boolean) => void
  interactive?: boolean
}) {
  const theater = useWatchTheaterMode()
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentSec, setCurrentSec] = useState(0)
  const [durationSec, setDurationSec] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const chromePointerHeldRef = useRef(false)

  useEffect(() => {
    const sync = () => setNativeFullscreen(isPlayerExpanded())
    sync()
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    const mo = new MutationObserver(sync)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
      mo.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = videoRef?.current
    if (!el) {
      setIsPlaying(true)
      return
    }
    const sync = () => {
      setIsPlaying(!el.paused && !el.ended)
    }
    sync()
    el.addEventListener('play', sync)
    el.addEventListener('pause', sync)
    el.addEventListener('ended', sync)
    return () => {
      el.removeEventListener('play', sync)
      el.removeEventListener('pause', sync)
      el.removeEventListener('ended', sync)
    }
  }, [videoRef])

  useEffect(() => {
    const el = videoRef?.current
    if (!el) {
      setCurrentSec(0)
      setDurationSec(0)
      return
    }
    const syncTime = () => {
      if (scrubbing) return
      setCurrentSec(el.currentTime || 0)
      setDurationSec(Number.isFinite(el.duration) ? el.duration : 0)
    }
    syncTime()
    el.addEventListener('timeupdate', syncTime)
    el.addEventListener('durationchange', syncTime)
    el.addEventListener('seeked', syncTime)
    return () => {
      el.removeEventListener('timeupdate', syncTime)
      el.removeEventListener('durationchange', syncTime)
      el.removeEventListener('seeked', syncTime)
    }
  }, [videoRef, scrubbing])

  useEffect(() => {
    return () => {
      if (chromePointerHeldRef.current) {
        chromePointerHeldRef.current = false
        requestPlayerChromeRelease()
      }
    }
  }, [])

  const handleMobileExpand = useCallback(async () => {
    try {
      if (isPlayerExpanded()) {
        await exitPlayerGestureFullscreen()
        setNativeFullscreen(false)
        return
      }
      await enterPlayerGestureFullscreen({
        video: videoRef?.current ?? null,
        root: fullscreenRootRef?.current ?? null,
      })
      setNativeFullscreen(isPlayerExpanded())
    } catch (e) {
      console.warn('[CleanPlayer] fullscreen', e)
      toast.message('לא ניתן להגדיל למסך מלא במכשיר זה', { duration: 2500 })
    }
  }, [videoRef, fullscreenRootRef])

  const handleTogglePlay = useCallback(() => {
    const el = videoRef?.current
    if (el) {
      if (el.paused || el.ended) {
        void el.play().catch(() => {})
        setIsPlaying(true)
      } else {
        el.pause()
        setIsPlaying(false)
      }
      return
    }
    const iframe = iframeRef?.current
    if (iframe) {
      if (isPlaying) {
        youtubeIframePause(iframe)
        setIsPlaying(false)
        onIframePlayingChange?.(false)
      } else {
        youtubeIframePlay(iframe)
        setIsPlaying(true)
        onIframePlayingChange?.(true)
      }
    }
  }, [videoRef, iframeRef, isPlaying, onIframePlayingChange])

  const showMobileExpand = allowMobileExpand && Boolean(videoRef || fullscreenRootRef)
  const showTheaterDesktop = Boolean(theater)
  const showPrev = showQueueControls && Boolean(onPrevious)
  const showLock = Boolean(onTapsLockToggle)
  const showTransport = Boolean(videoRef || iframeRef)
  const showScrubber = Boolean(videoRef)

  const holdChromeWhilePointer = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation()
    if (chromePointerHeldRef.current) return
    chromePointerHeldRef.current = true
    requestPlayerChromeHold()
    const release = () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      if (!chromePointerHeldRef.current) return
      chromePointerHeldRef.current = false
      requestPlayerChromeRelease()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
  }, [])

  if (!showQueueControls && !showTheaterDesktop && !showMobileExpand && !showLock && !showTransport) {
    return null
  }

  const expandActive = nativeFullscreen
  const focusable = interactive ? undefined : -1
  const progressMax = durationSec > 0 ? durationSec : 1
  const progressValue = Math.min(currentSec, progressMax)

  return (
    <div
      className={cn(
        'safetube-yt-chrome absolute inset-0 z-30 flex flex-col justify-between',
        interactive ? 'pointer-events-none' : 'pointer-events-none',
        className
      )}
      dir="ltr"
      role="toolbar"
      aria-label="בקרת ניגון"
      onPointerDownCapture={interactive ? holdChromeWhilePointer : undefined}
    >
      {/* Top secondary — SafeTube extras stay quiet */}
      <div
        className={cn(
          'flex items-start justify-between gap-2 bg-gradient-to-b from-black/70 via-black/25 to-transparent px-3 pt-[max(0.5rem,env(safe-area-inset-top,0px))] pb-8',
          interactive ? 'pointer-events-auto' : 'pointer-events-none',
          expandActive && 'pt-[max(0.65rem,env(safe-area-inset-top,0px))]'
        )}
      >
        <div className="flex items-center gap-1.5">
          {showLock ? (
            <button
              type="button"
              onClick={onTapsLockToggle}
              tabIndex={focusable}
              aria-pressed={Boolean(tapsLocked)}
              className={cn(CONTROL_BTN_SECONDARY, tapsLocked && CONTROL_BTN_ACTIVE_CLASS)}
              title={tapsLocked ? 'בטל נעילת מסך' : 'נעילת מסך'}
              aria-label={tapsLocked ? 'בטל נעילת מסך' : 'נעילת מסך'}
            >
              {tapsLocked ? <Lock className="h-4 w-4" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
            </button>
          ) : null}
          {showQueueControls ? (
            <button
              type="button"
              onClick={onLoopToggle}
              tabIndex={focusable}
              aria-pressed={loopEnabled}
              className={cn(CONTROL_BTN_SECONDARY, 'max-[340px]:hidden', loopEnabled && CONTROL_BTN_ACTIVE_CLASS)}
              title={loopEnabled ? 'נגן שוב ושוב — פעיל' : 'נגן שוב ושוב'}
              aria-label={loopEnabled ? 'כיבוי נגן שוב ושוב' : 'הפעלת נגן שוב ושוב'}
            >
              <Repeat className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {showTheaterDesktop ? (
            <button
              type="button"
              onClick={theater!.toggleTheaterMode}
              tabIndex={focusable}
              aria-pressed={theater!.theaterMode}
              className={cn(
                CONTROL_BTN_SECONDARY,
                'hidden lg:inline-flex',
                theater!.theaterMode && CONTROL_BTN_ACTIVE_CLASS
              )}
              aria-label={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
            >
              <RectangleHorizontal className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* Center play — primary YouTube affordance */}
      {showTransport ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              'flex items-center gap-5 sm:gap-8',
              interactive ? 'pointer-events-auto' : 'pointer-events-none'
            )}
          >
            {showPrev ? (
              <button
                type="button"
                onClick={() => onPrevious?.()}
                tabIndex={focusable}
                className={CONTROL_BTN_GHOST}
                aria-label="הסרטון הקודם"
              >
                <SkipBack className="h-7 w-7" aria-hidden />
              </button>
            ) : (
              <span className="h-10 w-10" aria-hidden />
            )}
            <button
              type="button"
              onClick={handleTogglePlay}
              tabIndex={focusable}
              className={CONTROL_BTN_CENTER}
              aria-label={isPlaying ? 'השהייה' : 'ניגון'}
            >
              {isPlaying ? <Pause className="h-8 w-8" aria-hidden /> : <Play className="h-8 w-8 translate-x-0.5" aria-hidden />}
            </button>
            {showQueueControls ? (
              <button
                type="button"
                onClick={onNext}
                tabIndex={focusable}
                className={CONTROL_BTN_GHOST}
                aria-label="הסרטון הבא"
              >
                <SkipForward className="h-7 w-7" aria-hidden />
              </button>
            ) : (
              <span className="h-10 w-10" aria-hidden />
            )}
          </div>
        </div>
      ) : null}

      {/* Bottom: scrubber (Media Bridge) + fullscreen */}
      <div
        className={cn(
          'bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pt-10',
          interactive ? 'pointer-events-auto' : 'pointer-events-none',
          expandActive
            ? 'pb-[max(1rem,calc(env(safe-area-inset-bottom,0px)+0.65rem))]'
            : 'pb-[max(0.65rem,calc(env(safe-area-inset-bottom,0px)+0.35rem))]'
        )}
      >
        {showScrubber ? (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="w-10 shrink-0 text-end text-[11px] font-semibold tabular-nums text-white/90">
              {formatPlayerClock(currentSec)}
            </span>
            <input
              type="range"
              min={0}
              max={progressMax}
              step={0.1}
              value={progressValue}
              tabIndex={focusable}
              aria-label="התקדמות הסרטון"
              className="safetube-yt-scrubber h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-red-500"
              onPointerDown={() => {
                setScrubbing(true)
                requestPlayerChromeHold()
              }}
              onPointerUp={() => {
                setScrubbing(false)
                requestPlayerChromeRelease()
              }}
              onPointerCancel={() => {
                setScrubbing(false)
                requestPlayerChromeRelease()
              }}
              onChange={(e) => {
                const next = Number(e.target.value)
                setCurrentSec(next)
                const el = videoRef?.current
                if (el && Number.isFinite(next)) el.currentTime = next
              }}
            />
            <span className="w-10 shrink-0 text-start text-[11px] font-semibold tabular-nums text-white/90">
              {formatPlayerClock(durationSec)}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-end">
          <div
            className={cn(
              'flex items-center',
              showMobileExpand && !videoRef && 'pointer-events-auto rounded-xl bg-black/80 p-0.5 ps-10'
            )}
          >
            {showMobileExpand ? (
              <button
                type="button"
                onClick={() => void handleMobileExpand()}
                tabIndex={focusable}
                aria-pressed={expandActive}
                aria-label={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
                className={cn(CONTROL_BTN_SECONDARY, 'lg:hidden', expandActive && CONTROL_BTN_ACTIVE_CLASS)}
                title={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
              >
                {expandActive ? <Minimize className="h-4 w-4" aria-hidden /> : <Maximize className="h-4 w-4" aria-hidden />}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function buildYoutubeArtwork(videoId: string): MediaImage[] {
  const id = sanitizeYoutubeVideoId(videoId)
  if (!id) return []
  return [
    { src: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, sizes: '1280x720', type: 'image/jpeg' },
    { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
    { src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
  ]
}

/**
 * Instant, animated feedback shown the millisecond a card is tapped, while the player
 * (iframe or media bridge) is still initializing. Uses the poster as a blurred backdrop
 * with a shimmer sweep + spinner so the child never sees a blank black box.
 */
function PlayerLoadingSkeleton({
  posterUrl,
  videoId,
}: {
  posterUrl?: string | null
  videoId?: string | null
}) {
  const poster =
    (posterUrl || '').trim() ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '')
  return (
    // pointer-events-none: never block taps to the iframe / <video> underneath.
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-zinc-950" aria-hidden>
      {poster ? (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-md"
          referrerPolicy="no-referrer"
          decoding="async"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/50" />
      <div className="absolute inset-0 -translate-x-full animate-[playerShimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/25 border-t-white drop-shadow-lg" />
      </div>
    </div>
  )
}

function pickArtwork(videoId: string, posterUrl: string | null | undefined): MediaImage[] {
  const fromPoster = (posterUrl || '').trim()
  if (fromPoster) {
    return [{ src: fromPoster, type: 'image/jpeg' }, ...buildYoutubeArtwork(videoId)]
  }
  return buildYoutubeArtwork(videoId)
}

function primaryArtworkUrl(videoId: string, posterUrl: string | null | undefined): string | null {
  const fromPoster = (posterUrl || '').trim()
  if (fromPoster) return fromPoster
  const id = sanitizeYoutubeVideoId(videoId)
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null
}

type PlayerPhase =
  | { kind: 'resolving' }
  | { kind: 'playing'; info: StreamApiResponse }
  | { kind: 'upcoming_live' }
  | { kind: 'error'; retryable: boolean }
  | { kind: 'daily_limit' }

function applyPlaybackFailure(
  err: unknown,
  context: string,
  setPhase: (phase: PlayerPhase) => void
): void {
  const result = classifyPlaybackFailure(err)
  logPlaybackFailure(context, result, err)
  if (result.phase === 'upcoming_live') {
    setPhase({ kind: 'upcoming_live' })
    return
  }
  setPhase({ kind: 'error', retryable: result.retryable })
}

function canPlayNativeHls(): boolean {
  if (typeof document === 'undefined') return false
  const v = document.createElement('video')
  return (
    v.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    v.canPlayType('application/x-mpegURL') !== ''
  )
}

function CleanPlayerYoutubeIframe({
  videoId,
  title,
  className,
  channelTitle,
  posterUrl,
  blankVideoFrame = false,
  durationSeconds,
  onNextTrack,
  onPreviousTrack,
  hasNextTrack = true,
  queueControls,
  allowMobileExpand = true,
  onVideoPlaybackStarted,
  onPlaybackActiveChange,
  immersive = false,
}: CleanPlayerProps) {
  const fullscreenRootRef = useRef<HTMLDivElement>(null)
  const playerShellRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [tapsLocked, setTapsLocked] = useState(false)
  const [iframePlaying, setIframePlaying] = useState(true)
  // YouTube-like: controls fade after ~3s while playing, stay while paused/locked, tap toggles.
  const { chromeVisible, bumpChrome } = useAutoHidePlayerChrome({
    locked: tapsLocked,
    playing: iframePlaying,
  })
  const showQueueControls = !immersive && (queueControls ?? Boolean(onNextTrack))
  // Always keep the SafeTube bar (lock + queue/theater when available) — except immersive Shorts.
  const showControlBar = !immersive
  const fillParent = immersive || playerFillsParentHeight(className)
  const handleNextVideo = useNextVideoHandler(onNextTrack, hasNextTrack)
  const handleNextVideoRef = useRef(handleNextVideo)
  handleNextVideoRef.current = handleNextVideo
  const onPreviousTrackRef = useRef(onPreviousTrack)
  onPreviousTrackRef.current = onPreviousTrack
  /** Wall-clock estimate of iframe position (no IFrame API currentTime). */
  const iframePosSecRef = useRef(0)
  const iframePlayingRef = useRef(true)
  const safeId = sanitizeYoutubeVideoId(videoId)
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const [iframeReady, setIframeReady] = useState(false)
  const iframePlaybackNotifiedRef = useRef(false)
  /** After first paint, keep the same iframe DOM node across Short/queue src swaps. */
  const initialSkeletonDoneRef = useRef(false)
  const [resolvedDurationSec, setResolvedDurationSec] = useState<number | null>(null)
  const src = useMemo(() => {
    if (!safeId || isLimitReached) return ''
    const base = buildYoutubePrivacyEmbedUrl(safeId, {
      origin,
      autoplay: true,
      host:
        Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
          ? 'youtube'
          : 'nocookie',
    })
    if (!loopEnabled) return base
    const u = new URL(base)
    u.searchParams.set('loop', '1')
    u.searchParams.set('playlist', safeId)
    return u.toString()
  }, [safeId, origin, loopEnabled, isLimitReached])

  // Leave document fullscreen when the clip changes so next/prev is never stuck off-screen.
  useEffect(() => {
    if (!isPlayerExpanded()) return
    void exitPlayerGestureFullscreen()
  }, [videoId])

  // First open: skeleton until load/timeout (Android WebView often skips iframe onLoad).
  // Later videoId/src swaps: do NOT set iframeReady=false — that flashes PlayerLoadingSkeleton
  // with the next Short's poster/logo. React updates src on the same iframe (no key={src}).
  useEffect(() => {
    iframePlaybackNotifiedRef.current = false
    setTapsLocked(false)
    setIframePlaying(true)
    if (!src) return
    if (initialSkeletonDoneRef.current) return
    setIframeReady(false)
    const clearSkeleton = window.setTimeout(() => {
      initialSkeletonDoneRef.current = true
      setIframeReady(true)
    }, 900)
    return () => window.clearTimeout(clearSkeleton)
  }, [src])

  useEffect(() => {
    setResolvedDurationSec(null)
    const fromProps = Number(durationSeconds)
    if (Number.isFinite(fromProps) && fromProps >= QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC) return
    const id = sanitizeYoutubeVideoId(videoId)
    if (!id) return
    let cancelled = false
    void fetchVideoDetailsBatch([id]).then((map) => {
      if (cancelled) return
      const sec = map.get(id)?.durationSeconds
      if (sec != null && sec >= QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC) {
        setResolvedDurationSec(sec)
      }
    })
    return () => {
      cancelled = true
    }
  }, [videoId, durationSeconds])

  const effectiveDurationSec =
    Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= QUEUE_AUTO_ADVANCE_MIN_DURATION_SEC
      ? Number(durationSeconds)
      : resolvedDurationSec

  // Android iframe: no `ended` event without IFrame API — advance queue by catalog duration.
  useQueueAutoAdvanceTimer({
    enabled: Boolean(onNextTrack) && !isLimitReached && !blankVideoFrame,
    durationSeconds: effectiveDurationSec,
    loopEnabled,
    resetKey: videoId,
    playbackStarted: iframeReady,
    onAdvance: () => handleNextVideoRef.current(),
  })

  useEffect(() => {
    if (!isLimitReached) return
    onPlaybackActiveChange?.(false)
    setMediaPlaybackActive(false)
  }, [isLimitReached, onPlaybackActiveChange])

  useEffect(() => {
    return registerPlaybackPauseHandler(() => {
      youtubeIframePause(iframeRef.current)
      iframePlayingRef.current = false
      syncNativeMediaSession({ playing: false })
    })
  }, [])

  // Car / Bluetooth / lock-screen — transport only. Never fight YouTube audio focus.
  // Play/pause/seek via postMessage (enablejsapi=1, no localhost origin).
  // Next/previous via queue handlers (safe even if postMessage is ignored).
  useEffect(() => {
    type YtBridge = {
      play: () => void
      pause: () => void
      seekToMs: (ms: number) => void
      seekForwardMs: (ms: number) => void
      seekBackwardMs: (ms: number) => void
    }
    const w = window as unknown as { __safetubeYtPlayer?: YtBridge }

    const markPlaying = (playing: boolean) => {
      iframePlayingRef.current = playing
      // Update session state only — do not restart/stop the FGS (avoids focus thrash).
      syncNativeMediaSession({
        playing,
        canSkipNext: hasNextTrack,
        canSkipPrev: Boolean(onPreviousTrackRef.current),
        durationMs:
          effectiveDurationSec != null && effectiveDurationSec > 0
            ? Math.round(effectiveDurationSec * 1000)
            : undefined,
        positionMs: Math.round(Math.max(0, iframePosSecRef.current) * 1000),
      })
    }

    const bridge: YtBridge = {
      play: () => {
        if (useDailyWatchBudgetStore.getState().isLimitReached) return
        youtubeIframePlay(iframeRef.current)
        markPlaying(true)
      },
      pause: () => {
        youtubeIframePause(iframeRef.current)
        markPlaying(false)
      },
      seekToMs: (ms: number) => {
        const sec = Math.max(0, ms / 1000)
        iframePosSecRef.current = sec
        youtubeIframeSeekTo(iframeRef.current, sec)
        syncNativeMediaSession({ positionMs: Math.round(sec * 1000) })
      },
      seekForwardMs: (ms: number) => {
        const step = (ms || 10_000) / 1000
        const next = iframePosSecRef.current + step
        const capped =
          effectiveDurationSec != null && effectiveDurationSec > 0
            ? Math.min(next, effectiveDurationSec)
            : next
        iframePosSecRef.current = capped
        youtubeIframeSeekTo(iframeRef.current, capped)
        syncNativeMediaSession({ positionMs: Math.round(capped * 1000) })
      },
      seekBackwardMs: (ms: number) => {
        const step = (ms || 10_000) / 1000
        const next = Math.max(0, iframePosSecRef.current - step)
        iframePosSecRef.current = next
        youtubeIframeSeekTo(iframeRef.current, next)
        syncNativeMediaSession({ positionMs: Math.round(next * 1000) })
      },
    }
    w.__safetubeYtPlayer = bridge

    const unsubscribe = subscribeNativeMediaActions((event) => {
      if (useDailyWatchBudgetStore.getState().isLimitReached && event.action === 'play') {
        bridge.pause()
        return
      }
      switch (event.action) {
        case 'play':
          bridge.play()
          break
        case 'pause':
          bridge.pause()
          break
        case 'next':
          handleNextVideoRef.current()
          break
        case 'previous':
          if (iframePosSecRef.current > 3) {
            bridge.seekToMs(0)
          } else if (onPreviousTrackRef.current) {
            onPreviousTrackRef.current()
          } else {
            bridge.seekToMs(0)
          }
          break
        case 'seekto':
          if (typeof event.seekToMs === 'number') bridge.seekToMs(event.seekToMs)
          break
        case 'seekforward':
          bridge.seekForwardMs(event.seekToMs ?? 10_000)
          break
        case 'seekbackward':
          bridge.seekBackwardMs(event.seekToMs ?? 10_000)
          break
        default:
          break
      }
    })

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      const ms = navigator.mediaSession
      try {
        ms.setActionHandler('play', () => bridge.play())
        ms.setActionHandler('pause', () => bridge.pause())
        ms.setActionHandler('previoustrack', () => {
          if (iframePosSecRef.current > 3) bridge.seekToMs(0)
          else onPreviousTrackRef.current?.()
        })
        ms.setActionHandler('nexttrack', () => handleNextVideoRef.current())
        ms.setActionHandler('seekbackward', (d) => {
          bridge.seekBackwardMs((d.seekOffset || 10) * 1000)
        })
        ms.setActionHandler('seekforward', (d) => {
          bridge.seekForwardMs((d.seekOffset || 10) * 1000)
        })
        ms.setActionHandler('seekto', (d) => {
          if (d.seekTime == null || !Number.isFinite(d.seekTime)) return
          bridge.seekToMs(d.seekTime * 1000)
        })
      } catch {
        /* older WebView */
      }
    }

    return () => {
      unsubscribe()
      if (w.__safetubeYtPlayer === bridge) delete w.__safetubeYtPlayer
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        const ms = navigator.mediaSession
        try {
          ms.setActionHandler('play', null)
          ms.setActionHandler('pause', null)
          ms.setActionHandler('previoustrack', null)
          ms.setActionHandler('nexttrack', null)
          ms.setActionHandler('seekbackward', null)
          ms.setActionHandler('seekforward', null)
          ms.setActionHandler('seekto', null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [hasNextTrack, effectiveDurationSec])

  // Light position clock for relative seek only — do NOT hammer MediaSession every second.
  useEffect(() => {
    if (!iframeReady || isLimitReached) return
    iframePosSecRef.current = 0
    iframePlayingRef.current = true
    const tick = window.setInterval(() => {
      if (!iframePlayingRef.current) return
      iframePosSecRef.current += 1
      if (effectiveDurationSec != null && effectiveDurationSec > 0) {
        iframePosSecRef.current = Math.min(iframePosSecRef.current, effectiveDurationSec)
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [iframeReady, videoId, isLimitReached, effectiveDurationSec])

  useEffect(() => {
    if (!iframeReady || isLimitReached) return
    syncNativeMediaSession({
      title: title || 'SafeTube',
      artist: (channelTitle || '').trim() || 'SafeTube',
      playing: iframePlayingRef.current,
      canSkipNext: hasNextTrack,
      canSkipPrev: Boolean(onPreviousTrack),
      durationMs:
        effectiveDurationSec != null && effectiveDurationSec > 0
          ? Math.round(effectiveDurationSec * 1000)
          : undefined,
    })
  }, [
    iframeReady,
    isLimitReached,
    title,
    channelTitle,
    hasNextTrack,
    onPreviousTrack,
    effectiveDurationSec,
  ])

  useEffect(() => {
    let cancelled = false
    void assertChildPlaybackAllowedForStream().catch((e) => {
      if (cancelled) return
      console.warn('[CleanPlayer] iframe blocked', e)
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const handleIframeLoad = useCallback(() => {
    initialSkeletonDoneRef.current = true
    setIframeReady(true)
    iframePosSecRef.current = 0
    iframePlayingRef.current = true
    const id = sanitizeYoutubeVideoId(videoId)
    if (id && onVideoPlaybackStarted && !iframePlaybackNotifiedRef.current) {
      iframePlaybackNotifiedRef.current = true
      onVideoPlaybackStarted(id)
    }
    onPlaybackActiveChange?.(true)
    const artwork = primaryArtworkUrl(id ?? videoId, posterUrl)
    setMediaPlaybackActive(true, {
      title: title || 'SafeTube',
      artist: (channelTitle || '').trim() || 'SafeTube',
      artworkUrl: artwork ?? undefined,
      playing: true,
      canSkipNext: hasNextTrack,
      canSkipPrev: Boolean(onPreviousTrack),
      durationMs:
        effectiveDurationSec != null && effectiveDurationSec > 0
          ? Math.round(effectiveDurationSec * 1000)
          : undefined,
      positionMs: 0,
    })
  }, [
    videoId,
    title,
    channelTitle,
    posterUrl,
    onVideoPlaybackStarted,
    onPlaybackActiveChange,
    hasNextTrack,
    onPreviousTrack,
    effectiveDurationSec,
  ])

  useEffect(() => {
    return () => {
      onPlaybackActiveChange?.(false)
      setMediaPlaybackActive(false)
    }
  }, [videoId, onPlaybackActiveChange])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const artwork = pickArtwork(videoId, posterUrl)
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'SafeTube',
        artist: (channelTitle || '').trim() || 'SafeTube',
        album: 'SafeTube',
        artwork: artwork.length ? artwork : buildYoutubeArtwork(videoId),
      })
    } catch {
      /* ignore */
    }
    return () => {
      try {
        navigator.mediaSession.metadata = null
      } catch {
        /* ignore */
      }
    }
  }, [videoId, title, channelTitle, posterUrl])

  return (
    <div
      ref={fullscreenRootRef}
      className={cn(
        'safetube-player-root flex w-full min-h-0 flex-col overflow-hidden bg-black',
        fillParent && 'h-full',
        className
      )}
      dir="ltr"
      onPointerDownCapture={bumpChrome}
    >
      <div
        ref={playerShellRef}
        className={cn(
          'safetube-player-stage relative min-h-0 w-full overflow-hidden',
          fillParent ? 'flex-1' : 'aspect-video'
        )}
      >
      {isLimitReached ? <DailyLimitOverlay /> : null}
      {!safeId ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/90 px-4 text-center text-sm text-amber-100"
          role="alert"
          dir="rtl"
        >
          <p>מזהה סרטון YouTube לא תקין.</p>
        </div>
      ) : !src ? null : (
        <>
          {!iframeReady && !blankVideoFrame ? (
            <PlayerLoadingSkeleton posterUrl={posterUrl} videoId={safeId} />
          ) : null}
          <iframe
            ref={iframeRef}
            title={title}
            src={src}
            className={cn(
              'absolute inset-0 h-full w-full border-0',
              isLimitReached && 'pointer-events-none invisible'
            )}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="eager"
            onLoad={handleIframeLoad}
            referrerPolicy="strict-origin-when-cross-origin"
          />
          {/* Cover YouTube embed mute (top-end) — cannot remove native iframe chrome. */}
          {!isLimitReached && !tapsLocked && chromeVisible ? (
            <div
              className="pointer-events-auto absolute top-1 end-1 z-[22] h-11 w-11 rounded-md bg-black"
              aria-hidden
            />
          ) : null}
          {/* Black cover only — never visibility:hidden the iframe (throttles decode on WebView). */}
          {blankVideoFrame && !isLimitReached ? (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-black" aria-hidden />
          ) : null}
          {tapsLocked && !isLimitReached ? (
            <div className="safetube-player-lock absolute inset-0 z-[25] flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
              <button
                type="button"
                onClick={() => setTapsLocked(false)}
                className="inline-flex min-h-12 items-center gap-2 rounded-full bg-black/85 px-5 py-3 text-sm font-semibold text-white shadow-xl ring-2 ring-white/35 touch-manipulation"
                aria-label="בטל נעילת מסך"
              >
                <Lock className="h-5 w-5" aria-hidden />
                בטל נעילה
              </button>
            </div>
          ) : null}
          {!isLimitReached && !tapsLocked && safeId && src ? (
            <PlayerGestureOverlay
              layout="edges"
              canSeek={false}
              canSpeed={false}
              canFullscreen={allowMobileExpand}
              fullscreenRootRef={fullscreenRootRef}
            />
          ) : null}
        </>
      )}
      <span className="sr-only">{title}</span>
      {showControlBar ? (
        <div
          className={cn(
            'safetube-player-chrome absolute inset-0 z-30 isolate transition-opacity duration-150 ease-out',
            chromeVisible || tapsLocked
              ? 'pointer-events-none opacity-100'
              : 'pointer-events-none opacity-0'
          )}
          aria-hidden={!(chromeVisible || tapsLocked)}
        >
          <PlayerControlBar
            key={videoId}
            loopEnabled={loopEnabled}
            onLoopToggle={() => setLoopEnabled((v) => !v)}
            onNext={handleNextVideo}
            onPrevious={onPreviousTrack}
            hasNext={hasNextTrack}
            showQueueControls={showQueueControls}
            tapsLocked={tapsLocked}
            onTapsLockToggle={() => setTapsLocked((v) => !v)}
            iframeRef={iframeRef}
            fullscreenRootRef={fullscreenRootRef}
            allowMobileExpand={allowMobileExpand}
            interactive={chromeVisible || tapsLocked}
            onIframePlayingChange={(playing) => {
              setIframePlaying(playing)
              iframePlayingRef.current = playing
              syncNativeMediaSession({
                playing,
                canSkipNext: hasNextTrack,
                canSkipPrev: Boolean(onPreviousTrack),
                positionMs: Math.round(Math.max(0, iframePosSecRef.current) * 1000),
                durationMs:
                  effectiveDurationSec != null && effectiveDurationSec > 0
                    ? Math.round(effectiveDurationSec * 1000)
                    : undefined,
              })
            }}
          />
        </div>
      ) : null}
      </div>
    </div>
  )
}

function CleanPlayerMediaBridge({
  videoId,
  title,
  className,
  channelTitle,
  posterUrl,
  blankVideoFrame = false,
  onNextTrack,
  onPreviousTrack,
  hasNextTrack = true,
  queueControls,
  allowMobileExpand = true,
  onVideoPlaybackStarted,
  onPlaybackActiveChange,
  onPlaybackTimeUpdate,
  immersive = false,
}: CleanPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fullscreenRootRef = useRef<HTMLDivElement>(null)
  const playerShellRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const audioNormalizerRef = useRef<PlayerAudioNormalizer | null>(null)
  /** Cancels deferred adaptive quality polling when the video changes or unmounts. */
  const upgradeCleanupRef = useRef<(() => void) | null>(null)
  /** True while hls.js is driving the `<video>`; suppresses the raw `onError` channel. */
  const hlsJsActiveRef = useRef(false)
  const wasPlayingBeforeHiddenRef = useRef(false)
  const onNextTrackRef = useRef(onNextTrack)
  const hasNextTrackRef = useRef(hasNextTrack)
  const handleNextVideoRef = useRef<() => void>(() => {})
  const [phase, setPhase] = useState<PlayerPhase>({ kind: 'resolving' })
  const [retryNonce, setRetryNonce] = useState(0)
  const [bridgeWaking, setBridgeWaking] = useState(false)
  const [filePreparing, setFilePreparing] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  const [pipSupported, setPipSupported] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [needsUserGesture, setNeedsUserGesture] = useState(false)
  const [tapsLocked, setTapsLocked] = useState(false)
  const [mediaPlaying, setMediaPlaying] = useState(true)
  // YouTube-like: controls fade after ~3s while playing, stay while paused/locked, tap toggles.
  const { chromeVisible, bumpChrome } = useAutoHidePlayerChrome({
    locked: tapsLocked,
    playing: mediaPlaying,
  })
  const showQueueControls = !immersive && (queueControls ?? Boolean(onNextTrack))
  const showControlBar = !immersive
  const fillParent = immersive || playerFillsParentHeight(className)
  const blankVideoFrameRef = useRef(blankVideoFrame)
  blankVideoFrameRef.current = blankVideoFrame
  const handleNextVideo = useNextVideoHandler(onNextTrack, hasNextTrack)
  const playbackNotifiedRef = useRef(false)
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)

  useEffect(() => {
    onNextTrackRef.current = onNextTrack
  }, [onNextTrack])

  useEffect(() => {
    hasNextTrackRef.current = hasNextTrack
  }, [hasNextTrack])

  useEffect(() => {
    handleNextVideoRef.current = handleNextVideo
  }, [handleNextVideo])

  useEffect(() => {
    setLoopEnabled(false)
    setNeedsUserGesture(false)
    setTapsLocked(false)
    setMediaPlaying(true)
    if (isPlayerExpanded()) {
      void exitPlayerGestureFullscreen()
    }
  }, [videoId])

  // Stable volume: soft compressor on the Media Bridge element (once per mount).
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    audioNormalizerRef.current?.dispose()
    audioNormalizerRef.current = attachPlayerAudioNormalizer(el)
    return () => {
      audioNormalizerRef.current?.dispose()
      audioNormalizerRef.current = null
    }
  }, [])

  useEffect(() => {
    playbackNotifiedRef.current = false
  }, [videoId])

  useEffect(() => {
    if (phase.kind !== 'playing' || !onVideoPlaybackStarted) return
    const el = videoRef.current
    if (!el) return

    const notifyOnce = () => {
      const id = sanitizeYoutubeVideoId(videoId)
      if (!id || playbackNotifiedRef.current) return
      playbackNotifiedRef.current = true
      onVideoPlaybackStarted(id)
    }

    const onPlaybackStarted = () => notifyOnce()
    const onPlaybackEnded = () => notifyOnce()

    el.addEventListener('play', onPlaybackStarted)
    el.addEventListener('ended', onPlaybackEnded)
    if (!el.paused && !el.ended) notifyOnce()

    return () => {
      el.removeEventListener('play', onPlaybackStarted)
      el.removeEventListener('ended', onPlaybackEnded)
    }
  }, [phase.kind, videoId, onVideoPlaybackStarted])

  useEffect(() => {
    if (phase.kind !== 'playing') {
      onPlaybackActiveChange?.(false)
      return
    }
    const el = videoRef.current
    if (!el) return

    const sync = () => {
      onPlaybackActiveChange?.(!el.paused && !el.ended)
    }

    el.addEventListener('play', sync)
    el.addEventListener('pause', sync)
    el.addEventListener('ended', sync)
    sync()

    return () => {
      el.removeEventListener('play', sync)
      el.removeEventListener('pause', sync)
      el.removeEventListener('ended', sync)
      onPlaybackActiveChange?.(false)
    }
  }, [phase.kind, videoId, onPlaybackActiveChange])

  useEffect(() => {
    if (phase.kind !== 'playing' || !onPlaybackTimeUpdate) return
    const el = videoRef.current
    if (!el) return

    let lastSent = -1
    const emit = () => {
      if (!Number.isFinite(el.currentTime)) return
      const t = Math.floor(el.currentTime)
      if (t === lastSent) return
      lastSent = t
      onPlaybackTimeUpdate(t)
    }

    el.addEventListener('timeupdate', emit)
    el.addEventListener('seeked', emit)
    emit()

    return () => {
      el.removeEventListener('timeupdate', emit)
      el.removeEventListener('seeked', emit)
    }
  }, [phase.kind, videoId, onPlaybackTimeUpdate])

  const handleRetry = useCallback(() => {
    setBridgeWaking(false)
    setRetryNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let attachRafId: number | null = null
    let cancelled = false
    let ac: AbortController | null = null

    const detachHls = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }

    upgradeCleanupRef.current?.()
    upgradeCleanupRef.current = null

    if (!videoId.trim()) {
      applyPlaybackFailure(new Error('missing videoId'), 'invalid videoId', setPhase)
      return () => {
        cancelled = true
      }
    }

    if (isLimitReached) {
      detachHls()
      setPhase({ kind: 'daily_limit' })
      return () => {
        cancelled = true
      }
    }

    setPhase({ kind: 'resolving' })
    setBridgeWaking(false)
    setFilePreparing(false)
    hlsJsActiveRef.current = false
    ac = new AbortController()
    const signal = ac.signal

    /**
     * Stream metadata must not depend on `<video ref>`: StrictMode / rapid dependency
     * changes can tear down the effect before a ref-wait rAF runs, and a rAF that sees
     * `cancelled` would previously exit silently — no fetch, no UI error, no 8787 traffic.
     */
    void (async () => {
      try {
        console.info(`[CleanPlayer] resolving stream for ${videoId} via ${getStreamApiBaseUrl()}/api/stream/…`)
        const info = await fetchStreamInfo(videoId, {
          quality: STREAM_START_QUALITY,
          signal,
          onTransientRetry: () => {
            if (cancelled || signal.aborted) return
            setBridgeWaking(true)
          },
          onFilePreparing: () => {
            if (cancelled || signal.aborted) return
            setFilePreparing(true)
          },
        })
        setBridgeWaking(false)
        setFilePreparing(false)
        if (cancelled || signal.aborted) return

        console.info(
          `[CleanPlayer] resolved ${videoId} via ${info.source} (${info.format}${info.quality ? `, ${info.quality}` : ''})`
        )

        const MAX_ATTACH_FRAMES = 45
        let attachFrames = 0

        const applyToElement = (el: HTMLVideoElement) => {
          detachHls()
          upgradeCleanupRef.current?.()
          upgradeCleanupRef.current = null
          el.removeAttribute('src')
          el.load()

          const { src: playbackSrc } = streamResponseToSource(info)
          const safeId = sanitizeYoutubeVideoId(videoId)

          const attachUpgradeAfterStart = () => {
            if (!safeId) return
            upgradeCleanupRef.current = scheduleAdaptiveQuality(
              el,
              safeId,
              info,
              detachHls,
              (upgrade) => {
                hlsJsActiveRef.current = false
                setPhase({ kind: 'playing', info: upgrade })
              },
              // Skip mid-stream progressive swaps when:
              // - black-screen / audio-first mode (swap stutter is very visible), or
              // - hls.js is driving playback (native ABR handles ladder changes).
              { skip: blankVideoFrameRef.current || hlsJsActiveRef.current }
            )
          }

          if (info.format === 'hls' && !canPlayNativeHls()) {
            if (!Hls.isSupported()) {
              applyPlaybackFailure(new Error('HLS not supported'), 'hls unsupported', setPhase)
              return
            }
            hlsJsActiveRef.current = true
            const hls = new Hls({
              ...buildSmoothHlsAbrConfig(),
              xhrSetup: (xhr) => {
                xhr.withCredentials = false
              },
            })
            hlsRef.current = hls
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              if (!data.fatal) return
              console.error('[CleanPlayer] hls.js fatal', data)
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                try {
                  hls.recoverMediaError()
                  return
                } catch {
                  /* fall through */
                }
              }
              applyPlaybackFailure(new Error(`hls fatal: ${data.type}`), 'hls.js', setPhase)
            })
            // Cap upshifts when the network hint is poor (keeps decode time stable).
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              try {
                if (hls.levels.length <= 1) return
                const hint = getNetworkQualityHint()
                if (hint === 'poor') {
                  hls.autoLevelCapping = Math.min(1, hls.levels.length - 1)
                } else {
                  hls.autoLevelCapping = -1
                }
              } catch {
                /* ignore */
              }
            })
            hls.loadSource(playbackSrc)
            hls.attachMedia(el)
            setPhase({ kind: 'playing', info })
            attachUpgradeAfterStart()
            return
          }

          el.src = playbackSrc
          if (import.meta.env.DEV) {
            console.info('[CleanPlayer] <video src>', playbackSrc)
          }
          setPhase({ kind: 'playing', info })
          attachUpgradeAfterStart()
        }

        const tryAttach = () => {
          if (cancelled) return
          const el = videoRef.current
          if (el) {
            applyToElement(el)
            return
          }
          attachFrames += 1
          if (attachFrames >= MAX_ATTACH_FRAMES) {
            applyPlaybackFailure(new Error('video element not mounted'), 'attach timeout', setPhase)
            return
          }
          attachRafId = requestAnimationFrame(tryAttach)
        }

        tryAttach()
      } catch (e) {
        setBridgeWaking(false)
        setFilePreparing(false)
        if (cancelled || signal.aborted) return
        applyPlaybackFailure(e, 'resolve failed', setPhase)
      }
    })()

    return () => {
      cancelled = true
      if (attachRafId != null) cancelAnimationFrame(attachRafId)
      ac?.abort()
      upgradeCleanupRef.current?.()
      upgradeCleanupRef.current = null
      detachHls()
    }
  }, [videoId, retryNonce, isLimitReached])

  useEffect(() => {
    if (phase.kind !== 'resolving') return
    const timer = window.setTimeout(() => setFilePreparing(true), 3_000)
    return () => window.clearTimeout(timer)
  }, [phase.kind, videoId, retryNonce])

  useEffect(() => {
    if (!isLimitReached) return
    const el = videoRef.current
    if (el && !el.paused) {
      el.pause()
    }
    setMediaPlaybackActive(false)
    onPlaybackActiveChange?.(false)
    if (phase.kind === 'playing') {
      setPhase({ kind: 'daily_limit' })
    }
  }, [isLimitReached, phase.kind, onPlaybackActiveChange])

  const safePosterVideoId = sanitizeYoutubeVideoId(videoId)
  const videoPoster = blankVideoFrame
    ? undefined
    : (posterUrl || '').trim() ||
      (safePosterVideoId ? `https://i.ytimg.com/vi/${safePosterVideoId}/hqdefault.jpg` : undefined)

  useEffect(() => {
    if (typeof document === 'undefined') return
    setPipSupported(
      Boolean(
        document.pictureInPictureEnabled &&
          typeof HTMLVideoElement !== 'undefined' &&
          'requestPictureInPicture' in HTMLVideoElement.prototype
      )
    )
  }, [])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const artwork = pickArtwork(videoId, posterUrl)
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'SafeTube',
        artist: (channelTitle || '').trim() || 'SafeTube',
        album: 'SafeTube Kids',
        artwork: artwork.length ? artwork : buildYoutubeArtwork(videoId),
      })
    } catch {
      /* ignore */
    }
    return () => {
      try {
        navigator.mediaSession.metadata = null
      } catch {
        /* ignore */
      }
    }
  }, [phase.kind, videoId, title, channelTitle, posterUrl])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession

    const syncPlayback = () => {
      try {
        ms.playbackState = el.paused ? 'paused' : 'playing'
      } catch {
        /* ignore */
      }
    }

    const onPlay = () => syncPlayback()
    const onPause = () => syncPlayback()

    const seekBy = (deltaSec: number) => {
      if (!Number.isFinite(el.duration) || el.duration <= 0) return
      el.currentTime = Math.min(Math.max(0, el.currentTime + deltaSec), el.duration)
    }

    try {
      ms.setActionHandler('play', () => {
        if (useDailyWatchBudgetStore.getState().isLimitReached) {
          el.pause()
          return
        }
        void el.play()
      })
      ms.setActionHandler('pause', () => {
        el.pause()
      })
      ms.setActionHandler('previoustrack', onPreviousTrack ?? null)
      ms.setActionHandler('nexttrack', () => handleNextVideoRef.current())
      ms.setActionHandler('seekbackward', (details) => {
        seekBy(-(details.seekOffset || 10))
      })
      ms.setActionHandler('seekforward', (details) => {
        seekBy(details.seekOffset || 10)
      })
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime == null || !Number.isFinite(details.seekTime)) return
        if (!Number.isFinite(el.duration) || el.duration <= 0) return
        el.currentTime = Math.min(Math.max(0, details.seekTime), el.duration)
      })
    } catch {
      /* older WebKit */
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    syncPlayback()

    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
        ms.setActionHandler('seekbackward', null)
        ms.setActionHandler('seekforward', null)
        ms.setActionHandler('seekto', null)
      } catch {
        /* ignore */
      }
    }
  }, [phase.kind, videoId, onNextTrack, onPreviousTrack])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const unsubscribe = subscribeNativeMediaActions((event) => {
      if (useDailyWatchBudgetStore.getState().isLimitReached && event.action === 'play') {
        el.pause()
        return
      }
      switch (event.action) {
        case 'play':
          void el.play().catch(() => {})
          break
        case 'pause':
          el.pause()
          break
        case 'next':
          handleNextVideoRef.current()
          break
        case 'previous':
          // Car / headset UX: restart current track if well underway, otherwise skip back.
          if (el.currentTime > 3) {
            el.currentTime = 0
          } else if (onPreviousTrack) {
            onPreviousTrack()
          } else {
            el.currentTime = 0
          }
          break
        case 'seekto':
          if (typeof event.seekToMs === 'number' && Number.isFinite(el.duration) && el.duration > 0) {
            el.currentTime = Math.min(Math.max(0, event.seekToMs / 1000), el.duration)
          }
          break
        case 'seekforward': {
          const step = (event.seekToMs ?? 10_000) / 1000
          if (Number.isFinite(el.duration) && el.duration > 0) {
            el.currentTime = Math.min(el.duration, el.currentTime + step)
          }
          break
        }
        case 'seekbackward': {
          const step = (event.seekToMs ?? 10_000) / 1000
          el.currentTime = Math.max(0, el.currentTime - step)
          break
        }
        default:
          break
      }
    })

    return unsubscribe
  }, [phase.kind, videoId, onPreviousTrack])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el || !('mediaSession' in navigator)) return

    let raf = 0
    let lastPosPush = 0
    let lastNativePush = 0
    const artworkUrl = blankVideoFrame ? null : primaryArtworkUrl(videoId, posterUrl)
    const push = (forceNative = false) => {
      if (!el.duration || !Number.isFinite(el.duration) || el.duration <= 0) return
      const position = Math.min(Math.max(0, el.currentTime), el.duration)
      const now = Date.now()
      // setPositionState on every timeupdate janks Android WebView — ~1 Hz is enough.
      if (forceNative || now - lastPosPush >= 1000) {
        lastPosPush = now
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration,
            playbackRate: el.playbackRate || 1,
            position,
          })
        } catch {
          /* e.g. iOS */
        }
      }

      if (!forceNative && now - lastNativePush < 2000) return
      lastNativePush = now
      syncNativeMediaSession({
        title: title || 'SafeTube',
        artist: channelTitle || 'מתנגן עכשיו',
        durationMs: Math.round(el.duration * 1000),
        positionMs: Math.round(position * 1000),
        playing: !el.paused && !el.ended,
        artworkUrl,
        canSkipNext: hasNextTrack,
        canSkipPrev: Boolean(onPreviousTrack),
      })
    }
    const onTime = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => push(false))
    }
    const onTransport = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => push(true))
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onTransport)
    el.addEventListener('seeked', onTransport)
    el.addEventListener('ratechange', onTransport)
    el.addEventListener('play', onTransport)
    el.addEventListener('pause', onTransport)
    onTransport()

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onTransport)
      el.removeEventListener('seeked', onTransport)
      el.removeEventListener('ratechange', onTransport)
      el.removeEventListener('play', onTransport)
      el.removeEventListener('pause', onTransport)
      try {
        navigator.mediaSession.setPositionState(undefined)
      } catch {
        /* ignore */
      }
    }
  }, [phase.kind, videoId, title, channelTitle, posterUrl, blankVideoFrame, hasNextTrack, onPreviousTrack])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    // Marks this element so native MainActivity can nudge play() while backgrounded.
    el.setAttribute('data-safetube-bg', '1')

    const meta = {
      title: title || 'SafeTube',
      artist: channelTitle || 'מתנגן עכשיו',
      artworkUrl: primaryArtworkUrl(videoId, posterUrl),
      canSkipNext: hasNextTrack,
      canSkipPrev: Boolean(onPreviousTrack),
      durationMs:
        el.duration && Number.isFinite(el.duration) && el.duration > 0
          ? Math.round(el.duration * 1000)
          : undefined,
      positionMs: Math.round(Math.max(0, el.currentTime) * 1000),
    }

    const sync = (opts?: { fromPause?: boolean }) => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) {
        if (!el.paused) el.pause()
        setMediaPlaybackActive(false)
        return
      }
      const hidden =
        typeof document !== 'undefined' &&
        (document.visibilityState === 'hidden' || document.hidden)

      // Background may briefly pause the element. Keep the native service alive so
      // resume can work, but do NOT mark content as playing (watch budget must stop).
      if (opts?.fromPause && hidden && !el.ended) {
        setMediaPlaybackActive(false, { ...meta, playing: false }, { maintainNativeService: true })
        window.setTimeout(() => {
          if (useDailyWatchBudgetStore.getState().isLimitReached) return
          if (document.visibilityState === 'visible') return
          if (!el.ended) void el.play().catch(() => {})
        }, 120)
        return
      }

      const on = !el.paused && !el.ended
      setMediaPlaybackActive(on, {
        ...meta,
        playing: on,
        durationMs:
          el.duration && Number.isFinite(el.duration) && el.duration > 0
            ? Math.round(el.duration * 1000)
            : meta.durationMs,
        positionMs: Math.round(Math.max(0, el.currentTime) * 1000),
      })
      if (on) touchParentalGateActivity()
    }

    const onPlay = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) {
        el.pause()
        setMediaPlaybackActive(false)
        return
      }
      sync()
    }
    const onPause = () => sync({ fromPause: true })
    const onEndedForActivity = () => sync()

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEndedForActivity)
    // Sync from the real element state — do not force "playing" before playback starts.
    sync()

    const tick = window.setInterval(() => {
      if (!el.paused && !el.ended) touchParentalGateActivity()
    }, 30_000)

    return () => {
      window.clearInterval(tick)
      el.removeAttribute('data-safetube-bg')
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEndedForActivity)
      setMediaPlaybackActive(false)
    }
  }, [phase.kind, videoId, title, channelTitle, posterUrl, hasNextTrack, onPreviousTrack])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const clearGestureGate = () => setNeedsUserGesture(false)
    const tryAutoplay = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) return
      void el
        .play()
        .then(() => {
          setNeedsUserGesture(false)
        })
        .catch((err: unknown) => {
          // Show the tap-to-play gate ONLY for autoplay policy blocks. AbortError fires
          // when a source swap (360p→720p upgrade) interrupts play() — covering the
          // video with an overlay then made playback look frozen.
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            setNeedsUserGesture(true)
          }
        })
    }
    el.addEventListener('playing', clearGestureGate)
    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryAutoplay()
    } else {
      el.addEventListener('canplay', tryAutoplay, { once: true })
    }
    return () => {
      el.removeEventListener('playing', clearGestureGate)
      el.removeEventListener('canplay', tryAutoplay)
    }
  }, [phase.kind, videoId, isLimitReached])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const onQueueEnded = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) return
      if (loopEnabled) {
        el.currentTime = 0
        void el.play().catch(() => {})
        return
      }
      // Always go through the shared next handler so end-of-playlist toasts fire.
      handleNextVideoRef.current()
    }

    el.addEventListener('ended', onQueueEnded)
    return () => el.removeEventListener('ended', onQueueEnded)
  }, [phase.kind, videoId, loopEnabled])

  // Playlist resilience: if resolve/playback fails and there is a next track, skip forward
  // instead of getting stuck on an error card mid-playlist.
  useEffect(() => {
    if (phase.kind !== 'error') return
    if (!hasNextTrackRef.current || !onNextTrackRef.current) return
    if (useDailyWatchBudgetStore.getState().isLimitReached) return
    const t = window.setTimeout(() => {
      if (!hasNextTrackRef.current) return
      toast.message('מדלג לסרטון הבא…', { duration: 1800 })
      onNextTrackRef.current?.()
    }, 1600)
    return () => window.clearTimeout(t)
  }, [phase.kind, videoId])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const resumeIfNeeded = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) return
      if (el.ended) return
      if (el.paused) {
        void el.play()
          .then(() => {
            setMediaPlaybackActive(true, {
              title: title || 'SafeTube',
              artist: channelTitle || 'מתנגן עכשיו',
            })
          })
          .catch(() => {
            setMediaPlaybackActive(false, undefined, { maintainNativeService: true })
          })
        return
      }
      setMediaPlaybackActive(true, {
        title: title || 'SafeTube',
        artist: channelTitle || 'מתנגן עכשיו',
      })
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasPlayingBeforeHiddenRef.current = !el.paused || wasPlayingBeforeHiddenRef.current
        if (wasPlayingBeforeHiddenRef.current) {
          // Prefer real playback; if paused, keep service only (no budget tick).
          if (el.paused) {
            setMediaPlaybackActive(false, undefined, { maintainNativeService: true })
          }
          window.setTimeout(resumeIfNeeded, 80)
          window.setTimeout(resumeIfNeeded, 400)
        }
        return
      }
      if (
        document.visibilityState === 'visible' &&
        wasPlayingBeforeHiddenRef.current &&
        !useDailyWatchBudgetStore.getState().isLimitReached
      ) {
        void el.play().catch(() => {})
      }
    }

    // Cordova/Capacitor fires a document "pause" event on Android backgrounding.
    const onCordovaPause = () => {
      wasPlayingBeforeHiddenRef.current = !el.paused || wasPlayingBeforeHiddenRef.current
      if (!wasPlayingBeforeHiddenRef.current) return
      if (el.paused) {
        setMediaPlaybackActive(false, undefined, { maintainNativeService: true })
      }
      window.setTimeout(resumeIfNeeded, 80)
      window.setTimeout(resumeIfNeeded, 400)
    }

    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('pause', onCordovaPause)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('pause', onCordovaPause)
    }
  }, [phase.kind, videoId, title, channelTitle])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return
    const onEnter = () => setPipActive(true)
    const onLeave = () => setPipActive(false)
    el.addEventListener('enterpictureinpicture', onEnter)
    el.addEventListener('leavepictureinpicture', onLeave)
    setPipActive(document.pictureInPictureElement === el)
    return () => {
      el.removeEventListener('enterpictureinpicture', onEnter)
      el.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [phase.kind, videoId])

  const handlePipToggle = useCallback(async () => {
    const el = videoRef.current
    if (!el || !pipSupported) return
    try {
      if (document.pictureInPictureElement === el) {
        await document.exitPictureInPicture()
      } else {
        await el.requestPictureInPicture()
      }
    } catch (e) {
      console.warn('[CleanPlayer] Picture-in-Picture', e)
    }
  }, [pipSupported])

  const isUpcomingLive = phase.kind === 'upcoming_live'
  const isPlaybackError = phase.kind === 'error'
  const isDailyLimit = phase.kind === 'daily_limit' || isLimitReached
  // Do NOT fold blankVideoFrame into hideVideo — visibility:hidden on a playing
  // <video> makes Chromium/Android WebView throttle decode and causes stutter.
  const hideVideo = isUpcomingLive || isPlaybackError || isDailyLimit
  const showLoadingOverlay = phase.kind === 'resolving' && !isLimitReached && !blankVideoFrame

  return (
    <div
      ref={fullscreenRootRef}
      className={cn(
        'safetube-player-root flex w-full min-h-0 flex-col overflow-hidden bg-black',
        fillParent && 'h-full',
        className
      )}
      dir="ltr"
      onPointerDownCapture={bumpChrome}
    >
      <div
        ref={playerShellRef}
        className={cn(
          'safetube-player-stage relative min-h-0 w-full overflow-hidden',
          fillParent ? 'flex-1' : 'aspect-video'
        )}
      >
      {showLoadingOverlay ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/75 px-4 text-center text-sm leading-relaxed text-zinc-200"
          role="status"
          aria-live="polite"
          dir="rtl"
        >
          <PlayerLoadingSkeleton posterUrl={posterUrl} videoId={sanitizeYoutubeVideoId(videoId)} />
          <p className="relative z-10 drop-shadow">
            {bridgeWaking
              ? 'השרת מתעורר... מיד מתחילים'
              : filePreparing
                ? 'הסרטון בהכנה, זה עשוי לקחת דקה…'
                : 'מכין את הוידאו…'}
          </p>
        </div>
      ) : null}
      {blankVideoFrame && phase.kind === 'resolving' && !isLimitReached ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black px-4 text-center text-sm text-zinc-400"
          role="status"
          aria-live="polite"
          dir="rtl"
        >
          {bridgeWaking
            ? 'השרת מתעורר... מיד מתחילים'
            : filePreparing
              ? 'הסרטון בהכנה, זה עשוי לקחת דקה…'
              : 'מכין את הוידאו…'}
        </div>
      ) : null}
      {isUpcomingLive ? <UpcomingLiveLionOverlay /> : null}
      {isPlaybackError ? (
        <PlayerErrorOverlay
          onRetry={phase.retryable ? handleRetry : undefined}
        />
      ) : null}
      {isDailyLimit ? (
        <DailyLimitOverlay
          onSnoozed={() => {
            setRetryNonce((n) => n + 1)
          }}
        />
      ) : null}
      {phase.kind === 'playing' &&
      needsUserGesture &&
      !isLimitReached &&
      !blankVideoFrame &&
      !hideVideo ? (
        <button
          type="button"
          className="absolute inset-0 z-[25] flex flex-col items-center justify-center gap-3 bg-black/45 text-white backdrop-blur-[1px]"
          onClick={() => {
            const el = videoRef.current
            if (!el) return
            void audioNormalizerRef.current?.resume()
            void el
              .play()
              .then(() => setNeedsUserGesture(false))
              .catch(() => {
                // Strict autoplay policy — muted playback is always allowed; the child
                // can unmute via the native controls once playing.
                el.muted = true
                void el
                  .play()
                  .then(() => setNeedsUserGesture(false))
                  .catch(() => setNeedsUserGesture(true))
              })
          }}
          aria-label="נגן סרטון"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-black shadow-lg shadow-black/40">
            <Play className="ms-1 h-8 w-8 fill-current" aria-hidden />
          </span>
          <span className="rounded-full bg-black/55 px-3 py-1 text-sm font-semibold" dir="rtl">
            לחצו לניגון
          </span>
        </button>
      ) : null}
      {phase.kind === 'playing' &&
      pipSupported &&
      !isLimitReached &&
      !blankVideoFrame &&
      (chromeVisible || tapsLocked) ? (
        <button
          type="button"
          onClick={() => void handlePipToggle()}
          className={cn(
            'absolute end-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-black/55 text-white shadow-md backdrop-blur-sm transition hover:bg-black/70 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400',
            pipActive && 'ring-2 ring-brand-400'
          )}
          title={pipActive ? 'יציאה ממצב תמונה-בתוך-תמונה' : 'תמונה בתוך תמונה'}
          aria-label={pipActive ? 'יציאה ממצב תמונה בתוך תמונה' : 'הפעלת תמונה בתוך תמונה'}
        >
          <PictureInPicture2 className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
      <video
        ref={videoRef}
        className={cn('absolute inset-0 h-full w-full', hideVideo && 'pointer-events-none invisible')}
        controls={false}
        tabIndex={hideVideo || blankVideoFrame ? -1 : undefined}
        aria-hidden={hideVideo || blankVideoFrame}
        controlsList="nodownload"
        playsInline
        preload="auto"
        poster={videoPoster}
        onPlay={() => setMediaPlaying(true)}
        onPause={() => setMediaPlaying(false)}
        onEnded={() => setMediaPlaying(false)}
        onError={(e) => {
          if (hlsJsActiveRef.current) return
          const target = e.currentTarget
          console.error('[CleanPlayer] <video> error', {
            code: target.error?.code,
            message: target.error?.message,
          })
          applyPlaybackFailure(
            target.error ?? new Error('video element error'),
            'video element',
            setPhase
          )
        }}
      />
      {/* Opaque cover keeps audio/video decoding uninterrupted (no visibility:hidden). */}
      {blankVideoFrame && !isDailyLimit && !isUpcomingLive && !isPlaybackError ? (
        <div className="absolute inset-0 z-[5] bg-black" aria-hidden />
      ) : null}
      {tapsLocked && !isDailyLimit && !isUpcomingLive && !isPlaybackError ? (
        <div className="safetube-player-lock absolute inset-0 z-[25] flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
          <button
            type="button"
            onClick={() => setTapsLocked(false)}
            className="inline-flex min-h-12 items-center gap-2 rounded-full bg-black/85 px-5 py-3 text-sm font-semibold text-white shadow-xl ring-2 ring-white/35 touch-manipulation"
            aria-label="בטל נעילת מסך"
          >
            <Lock className="h-5 w-5" aria-hidden />
            בטל נעילה
          </button>
        </div>
      ) : null}
      {phase.kind === 'playing' &&
      !isDailyLimit &&
      !isUpcomingLive &&
      !isPlaybackError &&
      !tapsLocked &&
      !blankVideoFrame &&
      !needsUserGesture ? (
        <PlayerGestureOverlay
          layout="full"
          canSeek
          canSpeed
          canFullscreen={allowMobileExpand}
          videoRef={videoRef}
          fullscreenRootRef={fullscreenRootRef}
        />
      ) : null}
      <span className="sr-only">{title}</span>
      {showControlBar ? (
        <div
          className={cn(
            'safetube-player-chrome absolute inset-0 z-30 isolate transition-opacity duration-150 ease-out',
            chromeVisible || tapsLocked
              ? 'pointer-events-none opacity-100'
              : 'pointer-events-none opacity-0'
          )}
          aria-hidden={!(chromeVisible || tapsLocked)}
        >
          <PlayerControlBar
            key={videoId}
            loopEnabled={loopEnabled}
            onLoopToggle={() => setLoopEnabled((v) => !v)}
            onNext={handleNextVideo}
            onPrevious={onPreviousTrack}
            hasNext={hasNextTrack}
            showQueueControls={showQueueControls}
            tapsLocked={tapsLocked}
            onTapsLockToggle={() => setTapsLocked((v) => !v)}
            videoRef={videoRef}
            fullscreenRootRef={fullscreenRootRef}
            allowMobileExpand={allowMobileExpand}
            interactive={chromeVisible || tapsLocked}
          />
        </div>
      ) : null}
      </div>
    </div>
  )
}

/**
 * Android (Capacitor): simple YouTube embed iframe — native YT controls, no IFrame API / custom DOM.
 * Web/desktop: Media Bridge + native `<video>` (proxied stream).
 *
 * Optional: set `VITE_YOUTUBE_IFRAME_PLAYER=true` to force iframe on web too.
 */
export function CleanPlayer(props: CleanPlayerProps) {
  const useEmbed =
    YOUTUBE_IFRAME_PLAYER ||
    (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')
  if (useEmbed) {
    return <CleanPlayerYoutubeIframe {...props} />
  }
  return <CleanPlayerMediaBridge {...props} />
}
