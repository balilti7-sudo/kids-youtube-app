import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Maximize, Minimize, PictureInPicture2, RectangleHorizontal, Repeat, SkipForward } from 'lucide-react'
import Hls from 'hls.js'
import { setMediaPlaybackActive } from '../../lib/mediaPlaybackActivity'
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
  onUpgraded: (info: StreamApiResponse) => void
): () => void {
  const startHeight = playbackQualityHeight(startInfo.quality || STREAM_START_QUALITY)
  const upgradeHeight = playbackQualityHeight(STREAM_UPGRADE_QUALITY)
  if (startHeight >= upgradeHeight) {
    return () => {}
  }

  let cancelled = false

  const runUpgrade = () => {
    if (cancelled) return
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
    window.setTimeout(runUpgrade, 800)
  }

  if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    window.setTimeout(runUpgrade, 800)
  } else {
    el.addEventListener('canplay', onCanPlay, { once: true })
  }

  return () => {
    cancelled = true
    el.removeEventListener('canplay', onCanPlay)
  }
}

async function swapVideoSourcePreservingTime(
  el: HTMLVideoElement,
  info: StreamApiResponse,
  detachHls: () => void
): Promise<boolean> {
  const { src } = streamResponseToSource(info)
  const savedTime = el.currentTime
  const wasPlaying = !el.paused && !el.ended

  detachHls()
  el.removeAttribute('src')

  return new Promise((resolve) => {
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onReady)
      el.removeEventListener('error', onErr)
    }

    const onReady = () => {
      cleanup()
      try {
        const duration = Number.isFinite(el.duration) ? el.duration : savedTime
        el.currentTime = Math.min(Math.max(0, savedTime), duration)
      } catch {
        /* ignore seek errors */
      }
      if (wasPlaying) {
        void el.play().finally(() => resolve(true))
      } else {
        resolve(true)
      }
    }

    const onErr = () => {
      cleanup()
      resolve(false)
    }

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

function PlayerControlBar({
  loopEnabled,
  onLoopToggle,
  onNext,
  hasNext,
  showQueueControls,
  className,
  videoRef,
  playerShellRef,
}: {
  loopEnabled: boolean
  onLoopToggle: () => void
  onNext: () => void
  hasNext: boolean
  showQueueControls: boolean
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

  if (!showQueueControls && !showTheaterDesktop && !showMobileExpand) return null

  const expandActive = nativeFullscreen

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-black/90 px-2 py-2.5 sm:px-3',
        className
      )}
      dir="rtl"
      role="toolbar"
      aria-label="בקרת ניגון"
    >
      {showMobileExpand ? (
        <button
          type="button"
          onClick={() => void handleMobileExpand()}
          aria-pressed={expandActive}
          aria-label={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
          className={cn(
            'flex min-h-[48px] min-w-[48px] flex-1 max-w-[220px] items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400 lg:hidden',
            expandActive
              ? 'border-brand-400 bg-brand-600/90 text-white shadow-md'
              : 'border-white/25 bg-white/10 text-zinc-100 hover:bg-white/15'
          )}
          title={expandActive ? 'יציאה ממסך מלא' : 'הגדלה למסך מלא'}
        >
          {expandActive ? (
            <Minimize className="h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <Maximize className="h-5 w-5 shrink-0" aria-hidden />
          )}
          <span className="text-sm font-bold">{expandActive ? 'צמצום' : 'הגדלה'}</span>
        </button>
      ) : null}
      {showTheaterDesktop ? (
        <button
          type="button"
          onClick={theater!.toggleTheaterMode}
          aria-pressed={theater!.theaterMode}
          aria-label={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
          className={cn(
            'hidden min-h-[48px] min-w-[48px] flex-1 max-w-[200px] items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400 lg:flex',
            theater!.theaterMode
              ? 'border-brand-400 bg-brand-600/90 text-white shadow-md'
              : 'border-white/25 bg-white/10 text-zinc-100 hover:bg-white/15'
          )}
          title={theater!.theaterMode ? 'יציאה ממצב תיאטרון' : 'מצב תיאטרון'}
        >
          <RectangleHorizontal className="h-5 w-5 shrink-0" aria-hidden />
          <span className="text-sm font-bold">תיאטרון</span>
        </button>
      ) : null}
      {showQueueControls ? (
        <>
          <button
            type="button"
            onClick={onLoopToggle}
            aria-pressed={loopEnabled}
            className={cn(
              'flex min-h-[48px] min-w-[48px] flex-1 max-w-[200px] items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-bold transition focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400',
              loopEnabled
                ? 'border-brand-400 bg-brand-600/90 text-white shadow-md'
                : 'border-white/25 bg-white/10 text-zinc-100 hover:bg-white/15'
            )}
            title={loopEnabled ? 'נגן שוב ושוב — פעיל' : 'נגן שוב ושוב'}
          >
            <Repeat className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-sm font-bold">נגן שוב ושוב</span>
          </button>
          <button
            type="button"
            onClick={onNext}
            className={cn(
              'flex min-h-[48px] min-w-[48px] flex-1 max-w-[200px] items-center justify-center gap-2 rounded-xl border-2 border-white/25 bg-white/10 px-3 text-sm font-bold text-zinc-100 transition hover:bg-white/15 focus-visible:outline focus-visible:ring-2 focus-visible:ring-brand-400',
              !hasNext && 'opacity-85'
            )}
            title="הסרטון הבא"
            aria-label="הסרטון הבא"
          >
            <SkipForward className="h-5 w-5 shrink-0" aria-hidden />
            <span className="text-sm font-bold">הסרטון הבא</span>
          </button>
        </>
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
  onNextTrack,
  hasNextTrack = true,
  queueControls,
  onVideoPlaybackStarted,
  onPlaybackActiveChange,
}: CleanPlayerProps) {
  const playerShellRef = useRef<HTMLDivElement>(null)
  const isLimitReached = useDailyWatchBudgetStore((s) => s.isLimitReached)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const theater = useWatchTheaterMode()
  const showQueueControls = queueControls ?? Boolean(onNextTrack)
  const showControlBar = showQueueControls || Boolean(theater)
  const handleNextVideo = useNextVideoHandler(onNextTrack, hasNextTrack)
  const safeId = sanitizeYoutubeVideoId(videoId)
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const [iframeReady, setIframeReady] = useState(false)
  const iframePlaybackNotifiedRef = useRef(false)
  const src = useMemo(() => {
    if (!safeId || isLimitReached) return ''
    const base = buildYoutubePrivacyEmbedUrl(safeId, { origin, autoplay: true })
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
    <div
      className={cn('flex h-full w-full min-h-0 flex-col overflow-hidden bg-black', className)}
      dir="ltr"
    >
      <div ref={playerShellRef} className="relative min-h-0 flex-1">
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
          {!iframeReady ? <PlayerLoadingSkeleton posterUrl={posterUrl} videoId={safeId} /> : null}
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
        </>
      )}
      <span className="sr-only">{title}</span>
      </div>
      {showControlBar ? (
        <PlayerControlBar
          loopEnabled={loopEnabled}
          onLoopToggle={() => setLoopEnabled((v) => !v)}
          onNext={handleNextVideo}
          hasNext={hasNextTrack}
          showQueueControls={showQueueControls}
          playerShellRef={playerShellRef}
        />
      ) : null}
    </div>
  )
}

function CleanPlayerMediaBridge({
  videoId,
  title,
  className,
  channelTitle,
  posterUrl,
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
  const theater = useWatchTheaterMode()
  const showQueueControls = queueControls ?? Boolean(onNextTrack)
  const showControlBar = showQueueControls || Boolean(theater)
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
              }
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
  const videoPoster =
    (posterUrl || '').trim() ||
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
      } catch {
        /* ignore */
      }
    }
  }, [phase.kind, videoId, onNextTrack, onPreviousTrack])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el || !('mediaSession' in navigator)) return

    let raf = 0
    const push = () => {
      if (!el.duration || !Number.isFinite(el.duration) || el.duration <= 0) return
      try {
        navigator.mediaSession.setPositionState({
          duration: el.duration,
          playbackRate: el.playbackRate || 1,
          position: Math.min(Math.max(0, el.currentTime), el.duration),
        })
      } catch {
        /* e.g. iOS */
      }
    }
    const onTime = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(push)
    }

    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onTime)
    el.addEventListener('seeked', onTime)
    el.addEventListener('ratechange', onTime)
    onTime()

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onTime)
      el.removeEventListener('seeked', onTime)
      el.removeEventListener('ratechange', onTime)
      try {
        navigator.mediaSession.setPositionState(undefined)
      } catch {
        /* ignore */
      }
    }
  }, [phase.kind, videoId])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const sync = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) {
        if (!el.paused) el.pause()
        setMediaPlaybackActive(false)
        return
      }
      const on = !el.paused && !el.ended
      setMediaPlaybackActive(on)
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
    const onPause = () => sync()
    const onEndedForActivity = () => sync()

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEndedForActivity)
    sync()

    const tick = window.setInterval(() => {
      if (!el.paused && !el.ended) touchParentalGateActivity()
    }, 30_000)

    return () => {
      window.clearInterval(tick)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEndedForActivity)
      setMediaPlaybackActive(false)
    }
  }, [phase.kind, videoId])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const tryAutoplay = () => {
      if (useDailyWatchBudgetStore.getState().isLimitReached) return
      void el.play().catch(() => {})
    }
    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryAutoplay()
    } else {
      el.addEventListener('canplay', tryAutoplay, { once: true })
    }
    return () => el.removeEventListener('canplay', tryAutoplay)
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
      if (hasNextTrackRef.current) {
        onNextTrackRef.current?.()
      }
    }

    el.addEventListener('ended', onQueueEnded)
    return () => el.removeEventListener('ended', onQueueEnded)
  }, [phase.kind, videoId, loopEnabled])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasPlayingBeforeHiddenRef.current = !el.paused
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

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [phase.kind, videoId])

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
  const hideVideo = isUpcomingLive || isPlaybackError || isDailyLimit
  const showLoadingOverlay = phase.kind === 'resolving' && !isLimitReached

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
      {phase.kind === 'playing' && pipSupported && !isLimitReached ? (
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
        controls
        tabIndex={hideVideo ? -1 : undefined}
        aria-hidden={hideVideo}
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
      <span className="sr-only">{title}</span>
      </div>
      {showControlBar ? (
        <PlayerControlBar
          loopEnabled={loopEnabled}
          onLoopToggle={() => setLoopEnabled((v) => !v)}
          onNext={handleNextVideo}
          hasNext={hasNextTrack}
          showQueueControls={showQueueControls}
          videoRef={videoRef}
          playerShellRef={playerShellRef}
        />
      ) : null}
    </div>
  )
}

/**
 * Default: native `<video>` through the Media Bridge — **not** a YouTube iframe, so there is no
 * YouTube logo / “Watch on YouTube” in the player chrome (stream is proxied).
 *
 * Optional: set `VITE_YOUTUBE_IFRAME_PLAYER=true` to use `youtube-nocookie.com/embed` with
 * `modestbranding=1`, `rel=0`, and related params (see `buildYoutubePrivacyEmbedUrl`).
 */
export function CleanPlayer(props: CleanPlayerProps) {
  if (YOUTUBE_IFRAME_PLAYER) {
    return <CleanPlayerYoutubeIframe {...props} />
  }
  return <CleanPlayerMediaBridge {...props} />
}
