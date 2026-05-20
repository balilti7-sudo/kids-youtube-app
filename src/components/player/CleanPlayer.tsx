import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { PictureInPicture2 } from 'lucide-react'
import Hls from 'hls.js'
import { setMediaPlaybackActive } from '../../lib/mediaPlaybackActivity'
import { touchParentalGateActivity } from '../../lib/parentalGateActivity'
import { cn } from '../../lib/utils'
import { buildYoutubePrivacyEmbedUrl, sanitizeYoutubeVideoId } from '../../lib/youtubeEmbedUrl'
import {
  fetchStreamInfo,
  getStreamApiBaseUrl,
  streamResponseToSource,
  StreamApiError,
  type StreamApiResponse,
} from '../../lib/streamApi'

const YOUTUBE_IFRAME_PLAYER = import.meta.env.VITE_YOUTUBE_IFRAME_PLAYER === 'true'

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
  | { kind: 'error'; message: string; retryable: boolean }

function canPlayNativeHls(): boolean {
  if (typeof document === 'undefined') return false
  const v = document.createElement('video')
  return (
    v.canPlayType('application/vnd.apple.mpegurl') !== '' ||
    v.canPlayType('application/x-mpegURL') !== ''
  )
}

function mediaErrorMessage(err: MediaError | null): string {
  if (!err) return 'אירעה שגיאת ניגון לא ידועה.'
  switch (err.code) {
    case err.MEDIA_ERR_ABORTED:
      return 'הניגון בוטל.'
    case err.MEDIA_ERR_NETWORK:
      return 'בעיית רשת מול שרת המדיה. בדקו שהשרת רץ ופעיל.'
    case err.MEDIA_ERR_DECODE:
      return 'נכשל פענוח הוידאו. ייתכן שהפורמט לא נתמך.'
    case err.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'הדפדפן לא מצליח לפענח את הזרם. נסו סרטון אחר.'
    default:
      return err.message || 'שגיאת ניגון.'
  }
}

function CleanPlayerYoutubeIframe({
  videoId,
  title,
  className,
  channelTitle,
  posterUrl,
}: CleanPlayerProps) {
  const safeId = sanitizeYoutubeVideoId(videoId)
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const src = safeId ? buildYoutubePrivacyEmbedUrl(safeId, { origin }) : ''

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
      {!safeId || !src ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/90 px-4 text-center text-sm text-amber-100"
          role="alert"
          dir="rtl"
        >
          <p>מזהה סרטון YouTube לא תקין.</p>
        </div>
      ) : (
        <iframe
          title={title}
          src={src}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      <span className="sr-only">{title}</span>
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
}: CleanPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  /** True while hls.js is driving the `<video>`; suppresses the raw `onError` channel. */
  const hlsJsActiveRef = useRef(false)
  const wasPlayingBeforeHiddenRef = useRef(false)
  const [phase, setPhase] = useState<PlayerPhase>({ kind: 'resolving' })
  const [retryNonce, setRetryNonce] = useState(0)
  const [bridgeWaking, setBridgeWaking] = useState(false)
  const [pipActive, setPipActive] = useState(false)
  const [pipSupported, setPipSupported] = useState(false)
  const errId = useId()

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

    if (!videoId.trim()) {
      setPhase({ kind: 'error', message: 'מזהה סרטון חסר או לא תקין.', retryable: false })
      return () => {
        cancelled = true
      }
    }

    setPhase({ kind: 'resolving' })
    setBridgeWaking(false)
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
        if (import.meta.env.DEV) {
          console.info(`[CleanPlayer] fetching stream metadata → ${getStreamApiBaseUrl()}/api/stream/… (${videoId})`)
        }
        const info = await fetchStreamInfo(videoId, {
          signal,
          onTransientRetry: () => {
            if (cancelled || signal.aborted) return
            setBridgeWaking(true)
          },
        })
        setBridgeWaking(false)
        if (cancelled || signal.aborted) return

        console.info(
          `[CleanPlayer] resolved ${videoId} via ${info.source} (${info.format}${info.quality ? `, ${info.quality}` : ''})`
        )

        const MAX_ATTACH_FRAMES = 45
        let attachFrames = 0

        const applyToElement = (el: HTMLVideoElement) => {
          detachHls()
          el.removeAttribute('src')
          el.load()

          const { src: playbackSrc } = streamResponseToSource(info)

          if (info.format === 'hls' && !canPlayNativeHls()) {
            if (!Hls.isSupported()) {
              setPhase({
                kind: 'error',
                message: 'הדפדפן לא תומך ב־HLS. נסו דפדפן אחר או עדכנו את המכשיר.',
                retryable: false,
              })
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
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                setPhase({
                  kind: 'error',
                  message: 'בעיית רשת בזרם הוידאו. בדקו ששרת המדיה רץ ונסו שוב.',
                  retryable: true,
                })
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                try {
                  hls.recoverMediaError()
                  return
                } catch {
                  /* fall through to error */
                }
                setPhase({
                  kind: 'error',
                  message: 'נכשל פענוח הוידאו (HLS). נסו סרטון אחר.',
                  retryable: true,
                })
              } else {
                setPhase({
                  kind: 'error',
                  message: 'נכשל ניגון HLS. נסו שוב או בחרו סרטון אחר.',
                  retryable: true,
                })
              }
            })
            hls.loadSource(playbackSrc)
            hls.attachMedia(el)
            setPhase({ kind: 'playing', info })
            return
          }

          el.src = playbackSrc
          if (import.meta.env.DEV) {
            console.info('[CleanPlayer] <video src>', playbackSrc)
          }
          setPhase({ kind: 'playing', info })
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
            setPhase({
              kind: 'error',
              message: 'נגן הוידאו לא היה זמין לאחר הטעינה. רעננו את הדף.',
              retryable: true,
            })
            return
          }
          attachRafId = requestAnimationFrame(tryAttach)
        }

        tryAttach()
      } catch (e) {
        setBridgeWaking(false)
        if (cancelled || signal.aborted) return
        console.error('[CleanPlayer] resolve failed', e)
        if (e instanceof StreamApiError) {
          setPhase({ kind: 'error', message: e.message, retryable: true })
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        setPhase({
          kind: 'error',
          message:
            /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION/i.test(msg)
              ? `לא ניתן להתחבר לשרת הזרם (${getStreamApiBaseUrl()}). הריצו "npm run dev:api".`
              : msg,
          retryable: true,
        })
      }
    })()

    return () => {
      cancelled = true
      if (attachRafId != null) cancelAnimationFrame(attachRafId)
      ac?.abort()
      detachHls()
    }
  }, [videoId, retryNonce])

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
        void el.play()
      })
      ms.setActionHandler('pause', () => {
        el.pause()
      })
      ms.setActionHandler('previoustrack', onPreviousTrack ?? null)
      ms.setActionHandler('nexttrack', onNextTrack ?? null)
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
      const on = !el.paused && !el.ended
      setMediaPlaybackActive(on)
      if (on) touchParentalGateActivity()
    }

    const onPlay = () => sync()
    const onPause = () => sync()
    const onEnded = () => sync()

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('ended', onEnded)
    sync()

    const tick = window.setInterval(() => {
      if (!el.paused && !el.ended) touchParentalGateActivity()
    }, 30_000)

    return () => {
      window.clearInterval(tick)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
      setMediaPlaybackActive(false)
    }
  }, [phase.kind, videoId])

  useEffect(() => {
    if (phase.kind !== 'playing') return
    const el = videoRef.current
    if (!el) return

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasPlayingBeforeHiddenRef.current = !el.paused
        return
      }
      if (document.visibilityState === 'visible' && wasPlayingBeforeHiddenRef.current) {
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

  const showOverlay = phase.kind !== 'playing'

  return (
    <div
      className={cn('relative h-full w-full min-h-0 overflow-hidden bg-black', className)}
      dir="ltr"
    >
      {showOverlay ? (
        <div
          className={cn(
            'absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-4 text-center text-sm leading-relaxed',
            phase.kind === 'error'
              ? 'bg-black/90 text-amber-100'
              : 'bg-black/75 text-zinc-200'
          )}
          role={phase.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          id={phase.kind === 'error' ? errId : undefined}
          dir="rtl"
        >
          {phase.kind === 'resolving' ? (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
              <p>{bridgeWaking ? 'השרת מתעורר... מיד מתחילים' : 'מכין את הוידאו…'}</p>
            </>
          ) : phase.kind === 'error' ? (
            <>
              <p className="max-w-sm">{phase.message}</p>
              {phase.retryable ? (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="rounded-lg bg-amber-500/90 px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-400"
                >
                  נסה שוב
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {phase.kind === 'playing' && pipSupported ? (
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
        className="h-full w-full"
        controls
        controlsList="nodownload"
        playsInline
        preload="auto"
        poster={videoPoster}
        aria-describedby={phase.kind === 'error' ? errId : undefined}
        onError={(e) => {
          if (hlsJsActiveRef.current) return
          const target = e.currentTarget
          const msg = mediaErrorMessage(target.error)
          console.error('[CleanPlayer] <video> error', {
            code: target.error?.code,
            message: target.error?.message,
          })
          setPhase({ kind: 'error', message: msg, retryable: true })
        }}
      />
      <span className="sr-only">{title}</span>
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
