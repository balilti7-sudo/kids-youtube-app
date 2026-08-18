import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  Lock,
  LockOpen,
  Maximize,
  Minimize,
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
import { touchParentalGateActivity } from '../../lib/parentalGateActivity'
import { cn } from '../../lib/utils'
import { toast } from 'sonner'
import { useWatchTheaterMode } from '../../hooks/useWatchTheaterMode'
import {
  enterElementFullscreen,
  enterNativeVideoFullscreen,
  exitDocumentFullscreen,
  isDocumentFullscreen,
} from '../../lib/requestElementFullscreen'
import { buildYoutubePrivacyEmbedUrl, sanitizeYoutubeVideoId } from '../../lib/youtubeEmbedUrl'
import {
  fetchStreamInfo,
  getStreamApiBaseUrl,
  STREAM_START_QUALITY,
  STREAM_UPGRADE_QUALITY,
  streamResponseToSource,
  type StreamApiResponse,
} from '../../lib/streamApi'
import { classifyPlaybackFailure, logPlaybackFailure } from '../../lib/playerPlaybackErrors'
import { UpcomingLiveLionOverlay } from './UpcomingLiveLionOverlay'
import { PlayerErrorOverlay } from './PlayerErrorOverlay'
import { DailyLimitOverlay } from '../kid/DailyLimitOverlay'
import { assertChildPlaybackAllowedForStream } from '../../lib/childRuntime'
import { useDailyWatchBudgetStore } from '../../stores/dailyWatchBudgetStore'

const YOUTUBE_IFRAME_PLAYER = import.meta.env.VITE_YOUTUBE_IFRAME_PLAYER === 'true'

function playbackQualityHeight(raw: string | null | undefined): number {
  const m = String(raw || '').match(/(\d+)\s*p/i)
  return m ? Number(m[1]) : 0
}

function scheduleQualityUpgrade(
  el: HTMLVideoElement,
  vid: string,
  startInfo: StreamApiResponse,
  detachHls: () => void,
  onUpgraded: (info: StreamApiResponse) => void,
  opts?: { skip?: boolean }
): () => void {
  const startHeight = playbackQualityHeight(startInfo.quality || STREAM_START_QUALITY)
  const upgradeHeight = playbackQualityHeight(STREAM_UPGRADE_QUALITY)
  if (opts?.skip || startHeight >= upgradeHeight) {
    return () => {}
  }

  let cancelled = false

  const hasHealthyBuffer = () => {
    try {
      if (!el.buffered || el.buffered.length === 0) return false
      const end = el.buffered.end(el.buffered.length - 1)
      return end - el.currentTime >= 8
    } catch {
      return false
    }
  }

  const runUpgrade = () => {
    if (cancelled) return
    // Avoid mid-stream swaps while the buffer is thin — common stutter source.
    if (!hasHealthyBuffer()) {
      window.setTimeout(runUpgrade, 2500)
      return
    }
    void (async () => {
      try {
        const upgrade = await fetchStreamInfo(vid, { quality: STREAM_UPGRADE_QUALITY })
        if (cancelled) return

        const resolvedHeight = playbackQualityHeight(upgrade.quality)
        if (resolvedHeight <= startHeight) return

        console.info(
          `[CleanPlayer] upgrading ${vid} ${startInfo.quality || STREAM_START_QUALITY} -> ${upgrade.quality || STREAM_UPGRADE_QUALITY}`
        )

        const ok = await swapVideoSourcePreservingTime(el, upgrade, detachHls)
        if (!ok || cancelled) return

        onUpgraded(upgrade)
      } catch (err) {
        if (!cancelled) {
          console.warn(
            '[CleanPlayer] quality upgrade skipped:',
            err instanceof Error ? err.message : err
          )
        }
      }
    })()
  }

  const onCanPlay = () => {
    el.removeEventListener('canplay', onCanPlay)
    if (cancelled) return
    // Give playback time to stabilize before swapping the media URL.
    window.setTimeout(runUpgrade, 4500)
  }

  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    window.setTimeout(runUpgrade, 4500)
  } else {
    el.addEventListener('canplay', onCanPlay, { once: true })
  }

  return () => {
    cancelled = true
    el.removeEventListener('canplay', onCanPlay)
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
  // Only direct URL sources reach here (hls.js playback skips the upgrade), so the
  // previous src is a plain http(s) URL we can restore if the new one stalls.
  const previousSrc = el.currentSrc || el.src

  detachHls()
  el.removeAttribute('src')

  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      window.clearTimeout(watchdog)
      el.removeEventListener('loadedmetadata', onReady)
      el.removeEventListener('error', onErr)
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
            if (wasPlaying) void el.play().catch(() => {})
          },
          { once: true }
        )
        el.src = previousSrc
        el.load()
      }
      resolve(false)
    }

    const onReady = () => {
      if (settled) return
      settled = true
      cleanup()
      seekToSavedTime()
      if (wasPlaying) {
        void el.play().finally(() => resolve(true))
      } else {
        resolve(true)
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
  /** Fired once when playback actually starts for a video (both paths). */
  onVideoPlaybackStarted?: (videoId: string) => void
  /** Fired when the underlying media element starts or stops playing (for watch-time breaks). */
  onPlaybackActiveChange?: (playing: boolean) => void
  /** Current playback position in seconds (native `<video>` path only; throttled ~1 Hz). */
  onPlaybackTimeUpdate?: (currentTimeSeconds: number) => void
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

const CONTROL_BTN_CLASS =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-zinc-100 transition hover:bg-white/18 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40 sm:h-11 sm:w-11'

const CONTROL_BTN_ACTIVE_CLASS =
  'border-brand-400/80 bg-brand-600/90 text-white shadow-md shadow-brand-950/30 hover:bg-brand-600'

/** Overlay chips on the embed — stay above the red progress bar (bottom ~56px). */
const IFRAME_CHROME_BTN =
  'pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white shadow-md ring-1 ring-white/15 backdrop-blur-[2px] transition hover:bg-black/75 focus-visible:outline focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-40'

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
  playerShellRef,
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
  playerShellRef?: RefObject<HTMLDivElement | null>
}) {
  const theater = useWatchTheaterMode()
  const [nativeFullscreen, setNativeFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => setNativeFullscreen(isDocumentFullscreen())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])

  const handleMobileExpand = useCallback(async () => {
    try {
      if (isDocumentFullscreen()) {
        await exitDocumentFullscreen()
        return
      }
      const video = videoRef?.current
      if (video) {
        await enterNativeVideoFullscreen(video)
        return
      }
      const shell = playerShellRef?.current
      if (shell) await enterElementFullscreen(shell)
    } catch (e) {
      console.warn('[CleanPlayer] fullscreen', e)
      toast.message('לא ניתן להגדיל למסך מלא במכשיר זה', { duration: 2500 })
    }
  }, [videoRef, playerShellRef])

  const showMobileExpand = Boolean(videoRef || playerShellRef)
  const showTheaterDesktop = Boolean(theater)
  const showPrev = showQueueControls && Boolean(onPrevious)
  const showLock = Boolean(onTapsLockToggle)

  if (!showQueueControls && !showTheaterDesktop && !showMobileExpand && !showLock) return null

  const expandActive = nativeFullscreen

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center gap-1.5 border-t border-white/10 bg-black/90 px-2 py-2 sm:gap-2 sm:px-3 sm:py-2.5',
        className
      )}
      dir="rtl"
      role="toolbar"
      aria-label="בקרת ניגון"
    >
      {showPrev ? (
        <button
          type="button"
          onClick={() => onPrevious?.()}
          className={CONTROL_BTN_CLASS}
          title="הסרטון הקודם"
          aria-label="הסרטון הקודם"
        >
          <SkipBack className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      {showQueueControls ? (
        <button
          type="button"
          onClick={onNext}
          className={CONTROL_BTN_CLASS}
          title="הסרטון הבא"
          aria-label="הסרטון הבא"
        >
          <SkipForward className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      {showQueueControls ? (
        <button
          type="button"
          onClick={onLoopToggle}
          aria-pressed={loopEnabled}
          className={cn(CONTROL_BTN_CLASS, loopEnabled && CONTROL_BTN_ACTIVE_CLASS)}
          title={loopEnabled ? 'נגן שוב ושוב — פעיל' : 'נגן שוב ושוב'}
          aria-label={loopEnabled ? 'כיבוי נגן שוב ושוב' : 'הפעלת נגן שוב ושוב'}
        >
          <Repeat className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      {showLock ? (
        <button
          type="button"
          onClick={onTapsLockToggle}
          aria-pressed={Boolean(tapsLocked)}
          className={cn(CONTROL_BTN_CLASS, tapsLocked && CONTROL_BTN_ACTIVE_CLASS)}
          title={tapsLocked ? 'בטל נעילת מסך' : 'נעילת מסך — מונע לחיצות בטעות'}
          aria-label={tapsLocked ? 'בטל נעילת מסך' : 'נעילת מסך'}
        >
          {tapsLocked ? <Lock className="h-5 w-5" aria-hidden /> : <LockOpen className="h-5 w-5" aria-hidden />}
        </button>
      ) : null}

      {showMobileExpand ? (
        <button
          type="button"
          onClick={() => void handleMobileExpand()}
          aria-pressed={expandActive}
          aria-label={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
          className={cn(CONTROL_BTN_CLASS, 'lg:hidden', expandActive && CONTROL_BTN_ACTIVE_CLASS)}
          title={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
        >
          {expandActive ? (
            <Minimize className="h-5 w-5" aria-hidden />
          ) : (
            <Maximize className="h-5 w-5" aria-hidden />
          )}
        </button>
      ) : null}

      {showTheaterDesktop ? (
        <button
          type="button"
          onClick={theater!.toggleTheaterMode}
          aria-pressed={theater!.theaterMode}
          aria-label={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
          className={cn(
            CONTROL_BTN_CLASS,
            'hidden lg:inline-flex',
            theater!.theaterMode && CONTROL_BTN_ACTIVE_CLASS
          )}
          title={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
        >
          <RectangleHorizontal className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
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
    <div className="absolute inset-0 z-10 overflow-hidden bg-zinc-950" aria-hidden>
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
  onNextTrack,
  onPreviousTrack,
  hasNextTrack = true,
  queueControls,
  onVideoPlaybackStarted,
  onPlaybackActiveChange,
}: CleanPlayerProps) {
  const playerShellRef = useRef<HTMLDivElement>(null)
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [tapsLocked, setTapsLocked] = useState(false)
  const theater = useWatchTheaterMode()
  const showQueueControls = queueControls ?? Boolean(onNextTrack)
  const handleNextVideo = useNextVideoHandler(onNextTrack, hasNextTrack)
  const showPrev = showQueueControls && Boolean(onPreviousTrack)
  const showTheaterDesktop = Boolean(theater)
  const safeId = sanitizeYoutubeVideoId(videoId)
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const [iframeReady, setIframeReady] = useState(false)
  const iframePlaybackNotifiedRef = useRef(false)
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

  // Reset the skeleton whenever a new video mounts so feedback is instant on tap.
  useEffect(() => {
    setIframeReady(false)
    iframePlaybackNotifiedRef.current = false
    setTapsLocked(false)
  }, [src])

  useEffect(() => {
    if (!isLimitReached) return
    onPlaybackActiveChange?.(false)
    setMediaPlaybackActive(false)
  }, [isLimitReached, onPlaybackActiveChange])

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
    setIframeReady(true)
    const id = sanitizeYoutubeVideoId(videoId)
    if (id && onVideoPlaybackStarted && !iframePlaybackNotifiedRef.current) {
      iframePlaybackNotifiedRef.current = true
      onVideoPlaybackStarted(id)
    }
    onPlaybackActiveChange?.(true)
  }, [videoId, onVideoPlaybackStarted, onPlaybackActiveChange])

  useEffect(() => {
    return () => {
      onPlaybackActiveChange?.(false)
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
    <div className={cn('relative h-full w-full min-h-0 overflow-hidden bg-black', className)} dir="ltr">
      <div ref={playerShellRef} className="absolute inset-0">
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
              key={src}
              title={title}
              src={src}
              className={cn('h-full w-full border-0', isLimitReached && 'pointer-events-none invisible')}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
              allowFullScreen
              loading="eager"
              onLoad={handleIframeLoad}
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {/* Black cover only — never visibility:hidden the iframe (throttles decode on WebView). */}
            {blankVideoFrame && !isLimitReached ? (
              <div className="pointer-events-none absolute inset-0 z-[5] bg-black" aria-hidden />
            ) : null}
            {tapsLocked && !isLimitReached ? (
              <button
                type="button"
                className="absolute inset-0 z-[15] flex items-center justify-center bg-black/25"
                onClick={() => setTapsLocked(false)}
                aria-label="בטל נעילת מסך"
              >
                <span className="rounded-full bg-black/70 p-3 text-white shadow-lg ring-1 ring-white/20">
                  <Lock className="h-6 w-6" aria-hidden />
                </span>
              </button>
            ) : null}
            {!tapsLocked && !isLimitReached && safeId && src ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[12] h-14">
                <div className="absolute start-2 top-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTapsLocked(true)}
                    className={IFRAME_CHROME_BTN}
                    title="נעילת מסך — מונע לחיצות בטעות"
                    aria-label="נעילת מסך"
                  >
                    <LockOpen className="h-5 w-5" aria-hidden />
                  </button>
                  {showQueueControls ? (
                    <button
                      type="button"
                      onClick={() => setLoopEnabled((v) => !v)}
                      aria-pressed={loopEnabled}
                      className={cn(IFRAME_CHROME_BTN, loopEnabled && 'bg-white text-black hover:bg-white')}
                      title={loopEnabled ? 'נגן שוב ושוב — פעיל' : 'נגן שוב ושוב'}
                      aria-label={loopEnabled ? 'כיבוי נגן שוב ושוב' : 'הפעלת נגן שוב ושוב'}
                    >
                      <Repeat className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                  {showPrev ? (
                    <button
                      type="button"
                      onClick={() => onPreviousTrack?.()}
                      className={IFRAME_CHROME_BTN}
                      title="הסרטון הקודם"
                      aria-label="הסרטון הקודם"
                    >
                      <SkipBack className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                  {showQueueControls ? (
                    <button
                      type="button"
                      onClick={handleNextVideo}
                      className={IFRAME_CHROME_BTN}
                      title="הסרטון הבא"
                      aria-label="הסרטון הבא"
                    >
                      <SkipForward className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                  {showTheaterDesktop ? (
                    <button
                      type="button"
                      onClick={theater!.toggleTheaterMode}
                      aria-pressed={theater!.theaterMode}
                      aria-label={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
                      className={cn(
                        IFRAME_CHROME_BTN,
                        'hidden lg:inline-flex',
                        theater!.theaterMode && 'bg-white text-black hover:bg-white'
                      )}
                      title={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
                    >
                      <RectangleHorizontal className="h-5 w-5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
        <span className="sr-only">{title}</span>
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
  onVideoPlaybackStarted,
  onPlaybackActiveChange,
  onPlaybackTimeUpdate,
}: CleanPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerShellRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  /** Cancels deferred 720p upgrade when the video changes or unmounts. */
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
  const theater = useWatchTheaterMode()
  const showQueueControls = queueControls ?? Boolean(onNextTrack)
  const showControlBar = showQueueControls || Boolean(theater)
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
  }, [videoId])

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
            upgradeCleanupRef.current = scheduleQualityUpgrade(
              el,
              safeId,
              info,
              detachHls,
              (upgrade) => {
                hlsJsActiveRef.current = false
                setPhase({ kind: 'playing', info: upgrade })
              },
              // Skip the mid-stream URL swap when:
              // - black-screen / audio-first mode (swap stutter is very visible), or
              // - hls.js is driving playback (it adapts quality itself, and a failed
              //   swap after detaching hls.js cannot be reverted — frozen player).
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
              enableWorker: true,
              lowLatencyMode: false,
              // Prefer smoother playback over aggressive low-latency ABR on tablets.
              maxBufferLength: 45,
              maxMaxBufferLength: 90,
              backBufferLength: 30,
              startLevel: -1,
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
      className={cn('flex h-full w-full min-h-0 flex-col overflow-hidden bg-black', className)}
      dir="ltr"
    >
      <div ref={playerShellRef} className="relative min-h-0 flex-1">
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
      {phase.kind === 'playing' && pipSupported && !isLimitReached && !blankVideoFrame ? (
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
        className={cn('h-full w-full', hideVideo && 'pointer-events-none invisible')}
        controls={!blankVideoFrame}
        tabIndex={hideVideo || blankVideoFrame ? -1 : undefined}
        aria-hidden={hideVideo || blankVideoFrame}
        controlsList="nodownload"
        playsInline
        preload="auto"
        poster={videoPoster}
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
        <div
          className="absolute inset-0 z-[15] flex items-center justify-center bg-black/25"
          aria-hidden
        >
          <span className="rounded-full bg-black/70 p-3 text-white shadow-lg ring-1 ring-white/20">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
        </div>
      ) : null}
      <span className="sr-only">{title}</span>
      </div>
      {showControlBar ? (
        <PlayerControlBar
          loopEnabled={loopEnabled}
          onLoopToggle={() => setLoopEnabled((v) => !v)}
          onNext={handleNextVideo}
          onPrevious={onPreviousTrack}
          hasNext={hasNextTrack}
          showQueueControls={showQueueControls}
          tapsLocked={tapsLocked}
          onTapsLockToggle={() => setTapsLocked((v) => !v)}
          videoRef={videoRef}
          playerShellRef={playerShellRef}
        />
      ) : null}
    </div>
  )
}

/**
 * Android (Capacitor): YouTube embed (`CleanPlayerYoutubeIframe`). Direct googlevideo
 * `<video src>` freezes in this WebView — do not switch Android back to Media Bridge / HLS.
 *
 * Web / other platforms: native `<video>` via Media Bridge unless
 * `VITE_YOUTUBE_IFRAME_PLAYER=true`.
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
