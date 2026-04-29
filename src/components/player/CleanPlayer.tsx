import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Hls from 'hls.js'
import { cn } from '../../lib/utils'
import {
  fetchStreamInfo,
  getMediaBridgeMediaUrl,
  getStreamApiBaseUrl,
  StreamApiError,
  type StreamApiResponse,
} from '../../lib/streamApi'

type CleanPlayerProps = {
  videoId: string
  title: string
  className?: string
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

/**
 * Native `<video>` through the Media Bridge (`VITE_STREAM_API_BASE` or localhost:8787).
 * HLS (m3u8) is common from Piped / ytdl — desktop Chrome/Firefox/Edge need hls.js; Safari uses native HLS.
 */
export function CleanPlayer({ videoId, title, className }: CleanPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  /** True while hls.js is driving the `<video>`; suppresses the raw `onError` channel. */
  const hlsJsActiveRef = useRef(false)
  const [phase, setPhase] = useState<PlayerPhase>({ kind: 'resolving' })
  const [retryNonce, setRetryNonce] = useState(0)
  const errId = useId()

  const handleRetry = useCallback(() => {
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
    hlsJsActiveRef.current = false
    ac = new AbortController()
    const signal = ac.signal
    const mediaUrl = getMediaBridgeMediaUrl(videoId)

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
        const info = await fetchStreamInfo(videoId, { signal })
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
            hls.loadSource(mediaUrl)
            hls.attachMedia(el)
            setPhase({ kind: 'playing', info })
            return
          }

          el.src = mediaUrl
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
              <p>מכין את הוידאו…</p>
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
      <video
        ref={videoRef}
        className="h-full w-full"
        controls
        playsInline
        preload="auto"
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
