import { useEffect, useRef, useState, type RefObject } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import { cn } from '../../lib/utils'
import { isPlayerExpanded } from '../../lib/playerTheater'
import { requestPlayerChromeHold, requestPlayerChromeRelease } from '../../hooks/useAutoHidePlayerChrome'
import {
  PLAYER_GESTURE_BOTTOM_DEADZONE_PX,
  PLAYER_GESTURE_BOTTOM_EXIT_BAND_PX,
  PLAYER_GESTURE_EDGE_BAND_PX,
  PLAYER_GESTURE_SWIPE_THRESHOLD_PX,
  usePlayerTouchGestures,
  exitPlayerGestureFullscreen,
  type PlayerGestureFeedback,
} from '../../hooks/usePlayerTouchGestures'

type Props = {
  enabled?: boolean
  /** Native `<video>` path — seek + 2x + fullscreen. */
  canSeek?: boolean
  canSpeed?: boolean
  canFullscreen?: boolean
  /**
   * `full` — covers the frame (Media Bridge). Leaves bottom dead-zone for SafeTube chrome.
   * `edges` — top band always; bottom exit uses swipe-intent (taps pass to YT controls).
   */
  layout?: 'full' | 'edges'
  videoRef?: RefObject<HTMLVideoElement | null>
  fullscreenRootRef?: RefObject<HTMLElement | null>
  className?: string
}

function GestureFeedbackChips({ feedback }: { feedback: PlayerGestureFeedback }) {
  return (
    <>
      {feedback.seekSide === 'left' && feedback.seekSeconds > 0 ? (
        <div
          className="safetube-seek-wash safetube-seek-wash--left pointer-events-none absolute inset-y-0 start-0 z-[1] flex w-[48%] items-center justify-center"
          aria-hidden
        >
          <span className="safetube-seek-flash flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full bg-white/15 text-white shadow-lg ring-2 ring-white/35 backdrop-blur-[2px]">
            <RotateCcw className="h-5 w-5 opacity-95" aria-hidden />
            <span className="mt-0.5 text-xs font-bold tabular-nums">−{feedback.seekSeconds}s</span>
          </span>
        </div>
      ) : null}
      {feedback.seekSide === 'right' && feedback.seekSeconds > 0 ? (
        <div
          className="safetube-seek-wash safetube-seek-wash--right pointer-events-none absolute inset-y-0 end-0 z-[1] flex w-[48%] items-center justify-center"
          aria-hidden
        >
          <span className="safetube-seek-flash flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center rounded-full bg-white/15 text-white shadow-lg ring-2 ring-white/35 backdrop-blur-[2px]">
            <RotateCw className="h-5 w-5 opacity-95" aria-hidden />
            <span className="mt-0.5 text-xs font-bold tabular-nums">+{feedback.seekSeconds}s</span>
          </span>
        </div>
      ) : null}
      {feedback.holdingSpeed ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-[16%] z-[1] flex justify-center"
          aria-hidden
        >
          <span className="safetube-speed-flash rounded-full bg-black/75 px-4 py-1.5 text-sm font-extrabold tracking-wide text-white shadow-lg ring-1 ring-white/30 backdrop-blur-[3px]">
            2×
          </span>
        </div>
      ) : null}
    </>
  )
}

/**
 * Bottom exit band for expanded iframe: capture only after an intentional vertical swipe.
 * Band itself is pointer-events:none so taps/seeks reach YouTube; we observe touches in capture.
 */
function BottomExitSwipeBand({ enabled }: { enabled: boolean }) {
  const bandRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<{ x: number; y: number; armed: boolean } | null>(null)

  useEffect(() => {
    const el = bandRef.current
    if (!el || !enabled) return

    const onDocStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]!
      const rect = el.getBoundingClientRect()
      if (t.clientY < rect.top || t.clientY > rect.bottom) return
      if (t.clientX < rect.left || t.clientX > rect.right) return
      trackRef.current = { x: t.clientX, y: t.clientY, armed: false }
    }

    const onDocMove = (e: TouchEvent) => {
      const track = trackRef.current
      if (!track || e.touches.length !== 1) return
      const t = e.touches[0]!
      const dx = t.clientX - track.x
      const dy = t.clientY - track.y
      if (!track.armed) {
        if (Math.abs(dy) < 12 && Math.abs(dx) < 12) return
        if (Math.abs(dy) >= Math.abs(dx) * 1.2) {
          track.armed = true
          requestPlayerChromeHold()
        } else {
          trackRef.current = null
          return
        }
      }
      if (track.armed) e.preventDefault()
    }

    const onDocEnd = (e: TouchEvent) => {
      const track = trackRef.current
      trackRef.current = null
      if (!track?.armed) return
      requestPlayerChromeRelease()
      const t = e.changedTouches[0]
      if (!t) return
      const dy = t.clientY - track.y
      if (dy >= PLAYER_GESTURE_SWIPE_THRESHOLD_PX) {
        void exitPlayerGestureFullscreen()
      }
    }

    const clear = () => {
      if (trackRef.current?.armed) requestPlayerChromeRelease()
      trackRef.current = null
    }

    document.addEventListener('touchstart', onDocStart, { passive: true, capture: true })
    document.addEventListener('touchmove', onDocMove, { passive: false, capture: true })
    document.addEventListener('touchend', onDocEnd, { capture: true })
    document.addEventListener('touchcancel', clear, { capture: true })
    return () => {
      document.removeEventListener('touchstart', onDocStart, true)
      document.removeEventListener('touchmove', onDocMove, true)
      document.removeEventListener('touchend', onDocEnd, true)
      document.removeEventListener('touchcancel', clear, true)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      ref={bandRef}
      className="pointer-events-none absolute inset-x-0 bottom-0"
      style={{ height: PLAYER_GESTURE_BOTTOM_EXIT_BAND_PX }}
      aria-hidden
    />
  )
}

/**
 * Lightweight YouTube-style gesture overlay.
 * Does not alter stream loading / iframe src — only optional video element + fullscreen shell.
 *
 * Stacking: z-[12] — above video/iframe, below lock (z-25) and SafeTube chrome (z-30).
 */
export function PlayerGestureOverlay({
  enabled = true,
  canSeek = true,
  canSpeed = true,
  canFullscreen = true,
  layout = 'full',
  videoRef,
  fullscreenRootRef,
  className,
}: Props) {
  const seekEnabled = layout === 'full' && canSeek
  const speedEnabled = layout === 'full' && canSpeed
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const sync = () => setExpanded(isPlayerExpanded())
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

  const { containerRef, feedback } = usePlayerTouchGestures({
    enabled,
    canSeek: seekEnabled,
    canSpeed: speedEnabled,
    canFullscreen,
    videoRef,
    fullscreenRootRef,
    bottomDeadzonePx: layout === 'edges' ? 0 : PLAYER_GESTURE_BOTTOM_DEADZONE_PX,
  })

  if (!enabled) return null

  if (layout === 'edges') {
    // Top band: enter/exit FS via existing gesture hook.
    // Bottom: swipe-intent only (see BottomExitSwipeBand) so YT seek/play stay tappable.
    return (
      <div
        ref={containerRef}
        className={cn('pointer-events-none absolute inset-0 z-[12]', className)}
        aria-hidden
      >
        <div
          className="pointer-events-auto absolute inset-x-0 top-0"
          style={{ height: PLAYER_GESTURE_EDGE_BAND_PX }}
        />
        <BottomExitSwipeBand enabled={expanded && canFullscreen} />
        <GestureFeedbackChips feedback={feedback} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('pointer-events-none absolute inset-0 z-[12]', className)}
      aria-hidden
    >
      {/* Active gesture surface — bottom strip stays clear for SafeTube chrome / controls. */}
      <div
        className="pointer-events-auto absolute inset-x-0 top-0 touch-none"
        style={{ bottom: PLAYER_GESTURE_BOTTOM_DEADZONE_PX }}
      />
      <GestureFeedbackChips feedback={feedback} />
    </div>
  )
}
