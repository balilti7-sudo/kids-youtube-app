import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  enterElementFullscreen,
  enterNativeVideoFullscreen,
  exitDocumentFullscreen,
  isDocumentFullscreen,
} from '../lib/requestElementFullscreen'
import { requestPlayerChromeBump, requestPlayerChromeHold, requestPlayerChromeRelease, requestPlayerChromeToggle } from './useAutoHidePlayerChrome'
import { lockPlayerOrientation, unlockPlayerOrientationSafe } from '../lib/playerOrientation'
import { requestChromeOffsetRefresh } from '../lib/chromeOffset'
import {
  enterLongVideoTheater,
  enterShortVideoTheater,
  exitPlayerTheater,
  isPlayerExpanded,
} from '../lib/playerTheater'
import { shortExpandDebug, shortExpandDebugClear } from '../lib/shortExpandDebug'
import type { NativeOrientationLockResult } from '../lib/nativeMediaPlayback'
import { getPlaybackContentShape } from '../lib/playbackContentShape'
import { getPlaybackPresentationShape } from '../lib/playbackPresentationShape'
import { resolvePresentationShapeForExpand } from '../lib/playbackPresentationContext'
import { setPlaybackPlayerMode } from '../lib/playbackPlayerMode'
import { theaterModeForPresentation } from '../lib/playerMode'

export const PLAYER_GESTURE_SEEK_STEP_SEC = 10
export const PLAYER_GESTURE_DOUBLE_TAP_MS = 320
export const PLAYER_GESTURE_STACK_WINDOW_MS = 900
export const PLAYER_GESTURE_HOLD_MS = 280
export const PLAYER_GESTURE_SWIPE_THRESHOLD_PX = 72
/** Clears SafeTube overlay chrome (gradient + icon row + safe-area) — shared with Shorts swipe. */
export const PLAYER_GESTURE_BOTTOM_DEADZONE_PX = 100
export const PLAYER_GESTURE_EDGE_BAND_PX = 56
/**
 * Expanded/fullscreen bottom exit strip — kept thin so it sits under YT seek/controls
 * (controls live ~40–64px up). Intentional vertical swipe still exits.
 */
export const PLAYER_GESTURE_BOTTOM_EXIT_BAND_PX = 22

export type SeekFlashSide = 'left' | 'right'

export type PlayerGestureFeedback = {
  seekSide: SeekFlashSide | null
  seekSeconds: number
  holdingSpeed: boolean
}

const IDLE_FEEDBACK: PlayerGestureFeedback = {
  seekSide: null,
  seekSeconds: 0,
  holdingSpeed: false,
}

async function unlockOrientationIfPossible(): Promise<void> {
  await unlockPlayerOrientationSafe()
}

export type ExpandTarget = {
  video?: HTMLVideoElement | null
  root?: HTMLElement | null
}

/**
 * @deprecated DOM probe — debug only. Expand routing uses {@link getPlaybackPresentationShape}.
 */
export function isShortWatchSurface(root?: HTMLElement | null, video?: HTMLVideoElement | null): boolean {
  return diagnoseShortWatchSurface(root, video).isShort
}

export type ShortWatchSurfaceDiagnosis = {
  isShort: boolean
  probeFrom: 'root' | 'video' | 'document-fallback' | 'none'
  rootTag: string | null
  checks: {
    dataFormatShort: boolean
    dataFormatOnClosest: string | null
    watchStageShortClass: boolean
    watchStageClassList: string | null
    shortsLane: boolean
    ariaShortsPlayer: boolean
    documentHasShortMarker: boolean
  }
}

/** Detailed probe for expand-router debug overlay. */
export function diagnoseShortWatchSurface(
  root?: HTMLElement | null,
  video?: HTMLVideoElement | null
): ShortWatchSurfaceDiagnosis {
  const el = root ?? video ?? null
  const closestFormat = el?.closest?.('[data-format]') as HTMLElement | null
  const closestStage = el?.closest?.('.safetube-watch-stage') as HTMLElement | null
  const dataFormatShort = el != null && el.closest('[data-format="short"]') != null
  const watchStageShortClass = el != null && el.closest('.safetube-watch-stage--short') != null
  const shortsLane = el != null && el.closest('.safetube-shorts-lane') != null
  const ariaShortsPlayer = el != null && el.closest('[aria-roledescription="shorts player"]') != null
  const documentHasShortMarker = Boolean(
    document.querySelector(
      '.safetube-shorts-lane, [data-format="short"], .safetube-watch-stage--short, [aria-roledescription="shorts player"]'
    )
  )

  let isShort = false
  let probeFrom: ShortWatchSurfaceDiagnosis['probeFrom'] = 'none'
  if (el) {
    probeFrom = root ? 'root' : 'video'
    isShort = dataFormatShort || watchStageShortClass || shortsLane || ariaShortsPlayer
  } else {
    probeFrom = 'document-fallback'
    isShort = documentHasShortMarker
  }

  return {
    isShort,
    probeFrom,
    rootTag: root ? `${root.tagName}.${root.className}` : null,
    checks: {
      dataFormatShort,
      dataFormatOnClosest: closestFormat?.getAttribute('data-format') ?? null,
      watchStageShortClass,
      watchStageClassList: closestStage?.className ?? null,
      shortsLane,
      ariaShortsPlayer,
      documentHasShortMarker,
    },
  }
}

/** Wait until orientation / visualViewport settle — long expand only (unchanged). */
async function waitForViewportSettle(): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    let orientTimer: number | null = null

    const cleanup = () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      window.visualViewport?.removeEventListener('resize', onResize)
      if (orientTimer != null) window.clearTimeout(orientTimer)
    }

    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      requestChromeOffsetRefresh()
      // Double rAF so layout/CSS (dvh) apply before the next paint.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve())
      })
    }

    const onResize = () => finish()
    const onOrientation = () => {
      // WebView often fires orientationchange before the new viewport metrics land.
      if (orientTimer != null) window.clearTimeout(orientTimer)
      orientTimer = window.setTimeout(finish, 140)
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientation)
    window.visualViewport?.addEventListener('resize', onResize)
    window.setTimeout(finish, 480)
  })
}

function isPortraitViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches
}

export type ShortPortraitWaitResult = {
  reason:
    | 'already-portrait'
    | 'plugin-config-matched'
    | 'plugin-config-timeout'
    | 'mql-change'
    | 'mql-timeout'
  portraitBefore: boolean
  portraitAfter: boolean
  plugin?: NativeOrientationLockResult | null
}

/**
 * Short expand only: lock portrait, then wait until the viewport is actually portrait.
 * Android: MediaPlayback.setOrientationLock resolves after Configuration matches.
 * Web / fallback: matchMedia('(orientation: portrait)') change (abort after 2.5s).
 */
async function lockAndWaitForPortrait(): Promise<ShortPortraitWaitResult> {
  const portraitBefore = isPortraitViewport()
  const plugin = (await lockPlayerOrientation('portrait')) as NativeOrientationLockResult | void
  const pluginResult =
    plugin && typeof plugin === 'object' ? (plugin as NativeOrientationLockResult) : null

  if (pluginResult) {
    if (pluginResult.applied) {
      return {
        reason: portraitBefore ? 'already-portrait' : 'plugin-config-matched',
        portraitBefore,
        portraitAfter: isPortraitViewport(),
        plugin: pluginResult,
      }
    }
    // Configuration wait timed out — fall through to matchMedia
  } else if (isPortraitViewport()) {
    return {
      reason: 'already-portrait',
      portraitBefore,
      portraitAfter: true,
      plugin: pluginResult,
    }
  }

  const mqlReason = await new Promise<'mql-change' | 'mql-timeout'>((resolve) => {
    const mql = window.matchMedia('(orientation: portrait)')
    if (mql.matches) {
      resolve('mql-change')
      return
    }
    let settled = false
    const done = (reason: 'mql-change' | 'mql-timeout') => {
      if (settled) return
      settled = true
      mql.removeEventListener('change', onChange)
      resolve(reason)
    }
    const onChange = () => {
      if (mql.matches) done('mql-change')
    }
    mql.addEventListener('change', onChange)
    window.setTimeout(() => done('mql-timeout'), 2500)
  })

  let reason: ShortPortraitWaitResult['reason'] = mqlReason
  if (pluginResult?.timedOut && mqlReason === 'mql-timeout') {
    reason = 'plugin-config-timeout'
  }

  return {
    reason,
    portraitBefore,
    portraitAfter: isPortraitViewport(),
    plugin: pluginResult,
  }
}

/**
 * Long-form expand only: landscape lock + long theater + optional native <video> FS.
 * Does not share orientation / theater flags with the short path.
 */
export async function enterLongVideoExpand(opts: ExpandTarget): Promise<void> {
  if (isPlayerExpanded()) {
    requestChromeOffsetRefresh()
    requestPlayerChromeBump()
    return
  }
  const video = opts.video
  const root = opts.root

  try {
    await lockPlayerOrientation('landscape')
    await waitForViewportSettle()
  } catch {
    /* continue — class theater still fills the viewport */
  }

  enterLongVideoTheater(root)
  requestPlayerChromeHold()

  try {
    if (video) {
      try {
        await enterNativeVideoFullscreen(video)
        return
      } catch {
        /* fall through to element fullscreen */
      }
    }
    if (root) {
      try {
        await enterElementFullscreen(root)
      } catch {
        /* long theater class already active — usable fallback */
      }
    }
  } finally {
    requestPlayerChromeRelease()
    requestChromeOffsetRefresh()
    requestPlayerChromeBump()
  }
}

function rectSnapshot(el: Element | null) {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    width: Math.round(r.width),
    height: Math.round(r.height),
    top: Math.round(r.top),
    left: Math.round(r.left),
  }
}

/**
 * Short expand only: wait for real portrait, then short theater.
 * Never uses native <video> fullscreen (Android forces landscape).
 * Stage CSS fills the fixed player-root (no svh/svw race).
 *
 * TEMP: on-screen + console debug overlay (shortExpandDebug) — remove after diagnosis.
 */
export async function enterShortVideoExpand(opts: ExpandTarget): Promise<void> {
  if (isPlayerExpanded()) {
    requestChromeOffsetRefresh()
    requestPlayerChromeBump()
    return
  }
  const root = opts.root

  shortExpandDebugClear()
  shortExpandDebug('1.before lockAndWaitForPortrait', {
    matchMediaPortrait: isPortraitViewport(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  })

  let waitResult: ShortPortraitWaitResult | null = null
  try {
    waitResult = await lockAndWaitForPortrait()
    shortExpandDebug('2.lockAndWaitForPortrait done', {
      reason: waitResult.reason,
      portraitBefore: waitResult.portraitBefore,
      portraitAfter: waitResult.portraitAfter,
      pluginApplied: waitResult.plugin?.applied ?? null,
      pluginTimedOut: waitResult.plugin?.timedOut ?? null,
      pluginAttempts: waitResult.plugin?.attempts ?? null,
      pluginOrientation: waitResult.plugin?.orientation ?? null,
    })
  } catch (err) {
    shortExpandDebug('2.lockAndWaitForPortrait threw', String(err))
  }

  enterShortVideoTheater(root)
  shortExpandDebug('3.after enterShortVideoTheater html.className', document.documentElement.className)

  // rAF so theater CSS has a chance to apply before measuring
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  shortExpandDebug('4.stage rect', rectSnapshot(document.querySelector('.safetube-player-stage')))
  shortExpandDebug(
    '5.player-root rect',
    rectSnapshot(root ?? document.querySelector('.safetube-player-root'))
  )
  shortExpandDebug('6.viewport', {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    matchMediaPortrait: isPortraitViewport(),
  })

  requestPlayerChromeHold()

  try {
    if (root) {
      try {
        await enterElementFullscreen(root)
      } catch {
        /* short theater class already active — usable fallback */
      }
    }
  } finally {
    requestPlayerChromeRelease()
    requestChromeOffsetRefresh()
    requestPlayerChromeBump()
  }
}

/**
 * Thin router for existing call sites (CleanPlayer / gestures).
 * Routes from authoritative presentation shape — never from DOM markers.
 * Content shape (Short vs long) remains separate and unchanged.
 */
export async function enterPlayerGestureFullscreen(opts: ExpandTarget): Promise<void> {
  shortExpandDebugClear()
  const contentShape = getPlaybackContentShape()
  const presentationShape = resolvePresentationShapeForExpand()
  const domDiagnosis = diagnoseShortWatchSurface(opts.root, opts.video)
  shortExpandDebug('router.presentationShape', {
    presentationShape,
    contentShape,
    willEnter:
      presentationShape === 'portrait' ? 'enterShortVideoExpand' : 'enterLongVideoExpand',
    rootPresent: Boolean(opts.root),
    videoPresent: Boolean(opts.video),
    note: 'Expand geometry from presentationShape — contentShape is product classification only.',
  })
  shortExpandDebug('router.domDiagnosis (debug only)', {
    isShort: domDiagnosis.isShort,
    dataFormatOnClosest: domDiagnosis.checks.dataFormatOnClosest,
    watchStageShortClass: domDiagnosis.checks.watchStageShortClass,
  })

  // Set theater playerMode before async portrait lock / DOM — prevents sticky-mini
  // fixed/transform wrapper from constraining the theater player-root (1.1.77 regression).
  setPlaybackPlayerMode(theaterModeForPresentation(presentationShape))

  if (presentationShape === 'portrait') {
    await enterShortVideoExpand(opts)
    return
  }
  await enterLongVideoExpand(opts)
}

export async function exitPlayerGestureFullscreen(): Promise<void> {
  requestPlayerChromeHold()
  try {
    exitPlayerTheater()
  } catch {
    /* ignore */
  }
  try {
    await unlockOrientationIfPossible()
  } catch {
    /* ignore — never leave UI waiting on orientation */
  }
  try {
    if (isDocumentFullscreen()) {
      await exitDocumentFullscreen()
    }
  } catch {
    /* ignore */
  } finally {
    requestPlayerChromeRelease()
    requestChromeOffsetRefresh()
    requestPlayerChromeBump()
  }
}

/**
 * YouTube-style touch gestures for the native `<video>` path (and fullscreen-only
 * edge bands for iframe). Does not touch stream resolution / iframe src.
 */
export function usePlayerTouchGestures(options: {
  enabled?: boolean
  canSeek?: boolean
  canSpeed?: boolean
  canFullscreen?: boolean
  videoRef?: RefObject<HTMLVideoElement | null>
  fullscreenRootRef?: RefObject<HTMLElement | null>
  bottomDeadzonePx?: number
}) {
  const {
    enabled = true,
    canSeek = true,
    canSpeed = true,
    canFullscreen = true,
    videoRef,
    fullscreenRootRef,
    bottomDeadzonePx = PLAYER_GESTURE_BOTTOM_DEADZONE_PX,
  } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [feedback, setFeedback] = useState<PlayerGestureFeedback>(IDLE_FEEDBACK)
  const seekFlashTimerRef = useRef<number | null>(null)
  const seekChromeHeldRef = useRef(false)
  const holdTimerRef = useRef<number | null>(null)
  const holdingRef = useRef(false)
  const savedRateRef = useRef(1)
  const stackRef = useRef<{ side: SeekFlashSide; total: number; at: number } | null>(null)

  const releaseSeekChromeHold = useCallback(() => {
    if (!seekChromeHeldRef.current) return
    seekChromeHeldRef.current = false
    requestPlayerChromeRelease()
  }, [])

  const clearSeekFlashTimer = useCallback(() => {
    if (seekFlashTimerRef.current != null) {
      window.clearTimeout(seekFlashTimerRef.current)
      seekFlashTimerRef.current = null
    }
  }, [])

  const showSeekFlash = useCallback(
    (side: SeekFlashSide, totalSec: number) => {
      clearSeekFlashTimer()
      // One nested hold for the whole stacked seek flash window (not per tap).
      if (!seekChromeHeldRef.current) {
        seekChromeHeldRef.current = true
        requestPlayerChromeHold()
      }
      setFeedback((prev) => ({ ...prev, seekSide: side, seekSeconds: totalSec }))
      seekFlashTimerRef.current = window.setTimeout(() => {
        setFeedback((prev) => ({ ...prev, seekSide: null, seekSeconds: 0 }))
        seekFlashTimerRef.current = null
        releaseSeekChromeHold()
      }, 700)
    },
    [clearSeekFlashTimer, releaseSeekChromeHold]
  )

  const seekBySide = useCallback(
    (side: SeekFlashSide) => {
      if (!canSeek) return
      const el = videoRef?.current
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return

      const now = Date.now()
      const stack = stackRef.current
      const continueStack =
        stack &&
        stack.side === side &&
        now - stack.at <= PLAYER_GESTURE_STACK_WINDOW_MS

      const total = continueStack ? stack.total + PLAYER_GESTURE_SEEK_STEP_SEC : PLAYER_GESTURE_SEEK_STEP_SEC
      stackRef.current = { side, total, at: now }

      const delta = side === 'right' ? PLAYER_GESTURE_SEEK_STEP_SEC : -PLAYER_GESTURE_SEEK_STEP_SEC
      el.currentTime = Math.min(Math.max(0, el.currentTime + delta), el.duration)
      showSeekFlash(side, total)
      requestPlayerChromeBump()
    },
    [canSeek, showSeekFlash, videoRef]
  )

  const startHoldSpeed = useCallback(() => {
    if (!canSpeed || holdingRef.current) return
    const el = videoRef?.current
    if (!el) return
    holdingRef.current = true
    savedRateRef.current = el.playbackRate > 0 ? el.playbackRate : 1
    el.playbackRate = 2
    requestPlayerChromeHold()
    setFeedback((prev) => ({ ...prev, holdingSpeed: true }))
  }, [canSpeed, videoRef])

  const endHoldSpeed = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (!holdingRef.current) return
    holdingRef.current = false
    const el = videoRef?.current
    if (el) el.playbackRate = savedRateRef.current || 1
    setFeedback((prev) => ({ ...prev, holdingSpeed: false }))
    requestPlayerChromeRelease()
    requestPlayerChromeBump()
  }, [videoRef])

  const toggleFullscreenFromSwipe = useCallback(
    async (direction: 'up' | 'down') => {
      if (!canFullscreen) return
      try {
        if (direction === 'up') {
          await enterPlayerGestureFullscreen({
            video: videoRef?.current ?? null,
            root: fullscreenRootRef?.current ?? null,
          })
          return
        }
        await exitPlayerGestureFullscreen()
      } catch (e) {
        console.warn('[PlayerGestures] fullscreen', e)
      }
    },
    [canFullscreen, fullscreenRootRef, videoRef]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return

    let tapSide: SeekFlashSide | null = null
    let tapAt = 0
    let pendingToggleTimer: number | null = null
    let track: {
      id: number
      startX: number
      startY: number
      axis: 'none' | 'vertical' | 'horizontal'
      fromDeadzone: boolean
      chromeHeld: boolean
      moved: boolean
    } | null = null

    const clearHoldTimer = () => {
      if (holdTimerRef.current != null) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }

    const clearPendingToggle = () => {
      if (pendingToggleTimer != null) {
        window.clearTimeout(pendingToggleTimer)
        pendingToggleTimer = null
      }
    }

    const releaseTrackChrome = () => {
      if (track?.chromeHeld) {
        requestPlayerChromeRelease()
        track.chromeHeld = false
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      // Never steal interactions aimed at SafeTube chrome / buttons.
      const target = e.target
      if (target instanceof Element && target.closest('.safetube-player-chrome, [role="toolbar"]')) {
        return
      }
      const touch = e.touches[0]!
      const rect = el.getBoundingClientRect()
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top
      const fromDeadzone = y > rect.height - bottomDeadzonePx
      track = {
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        axis: 'none',
        fromDeadzone,
        chromeHeld: false,
        moved: false,
      }

      clearHoldTimer()
      if (!fromDeadzone && canSpeed) {
        holdTimerRef.current = window.setTimeout(() => {
          clearPendingToggle()
          startHoldSpeed()
        }, PLAYER_GESTURE_HOLD_MS)
      }

      if (fromDeadzone || !canSeek) return
      const side: SeekFlashSide = x < rect.width * 0.5 ? 'left' : 'right'
      const now = Date.now()
      if (tapSide === side && now - tapAt <= PLAYER_GESTURE_DOUBLE_TAP_MS) {
        tapSide = null
        tapAt = 0
        clearHoldTimer()
        clearPendingToggle()
        seekBySide(side)
      } else {
        tapSide = side
        tapAt = now
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!track || e.touches.length !== 1) return
      const touch = e.touches[0]!
      if (touch.identifier !== track.id) return
      const dx = touch.clientX - track.startX
      const dy = touch.clientY - track.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (absDx > 8 || absDy > 8) {
        track.moved = true
        clearHoldTimer()
        clearPendingToggle()
        if (holdingRef.current) endHoldSpeed()
        // Movement cancels pending double-tap so a swipe cannot become a seek.
        tapSide = null
        tapAt = 0
      }

      if (track.fromDeadzone || !canFullscreen) return

      if (track.axis === 'none' && (absDx > 10 || absDy > 10)) {
        track.axis = absDy >= absDx * 1.25 ? 'vertical' : 'horizontal'
        if (track.axis === 'vertical' && !track.chromeHeld) {
          requestPlayerChromeHold()
          track.chromeHeld = true
        }
      }
      if (track.axis === 'vertical') {
        e.preventDefault()
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      clearHoldTimer()
      if (holdingRef.current) {
        endHoldSpeed()
        releaseTrackChrome()
        clearPendingToggle()
        track = null
        return
      }
      if (!track || !touch || touch.identifier !== track.id) {
        releaseTrackChrome()
        track = null
        return
      }
      // Only vertical swipes toggle fullscreen — never horizontal / ambiguous drags.
      if (
        !track.fromDeadzone &&
        canFullscreen &&
        track.axis === 'vertical'
      ) {
        const dy = touch.clientY - track.startY
        if (Math.abs(dy) >= PLAYER_GESTURE_SWIPE_THRESHOLD_PX) {
          tapSide = null
          tapAt = 0
          clearPendingToggle()
          void toggleFullscreenFromSwipe(dy < 0 ? 'up' : 'down')
          releaseTrackChrome()
          track = null
          return
        }
      }

      // YouTube: idle single-tap toggles chrome (never play/pause). Wait past double-tap window when seek is armed.
      if (!track.moved && track.axis === 'none' && !track.fromDeadzone) {
        clearPendingToggle()
        const delay = canSeek ? PLAYER_GESTURE_DOUBLE_TAP_MS + 40 : 0
        pendingToggleTimer = window.setTimeout(() => {
          pendingToggleTimer = null
          requestPlayerChromeToggle()
        }, delay)
      }

      releaseTrackChrome()
      track = null
    }

    const onTouchCancel = () => {
      clearHoldTimer()
      clearPendingToggle()
      endHoldSpeed()
      releaseTrackChrome()
      tapSide = null
      tapAt = 0
      track = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    el.addEventListener('touchend', onTouchEnd, { capture: true })
    el.addEventListener('touchcancel', onTouchCancel, { capture: true })
    return () => {
      clearHoldTimer()
      clearPendingToggle()
      endHoldSpeed()
      el.removeEventListener('touchstart', onTouchStart, true)
      el.removeEventListener('touchmove', onTouchMove, true)
      el.removeEventListener('touchend', onTouchEnd, true)
      el.removeEventListener('touchcancel', onTouchCancel, true)
    }
  }, [
    enabled,
    canSeek,
    canSpeed,
    canFullscreen,
    bottomDeadzonePx,
    seekBySide,
    startHoldSpeed,
    endHoldSpeed,
    toggleFullscreenFromSwipe,
  ])

  useEffect(() => {
    return () => {
      clearSeekFlashTimer()
      releaseSeekChromeHold()
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current)
      if (holdingRef.current) {
        holdingRef.current = false
        const el = videoRef?.current
        if (el) el.playbackRate = savedRateRef.current || 1
        requestPlayerChromeRelease()
      }
    }
  }, [clearSeekFlashTimer, releaseSeekChromeHold, videoRef])

  return { containerRef, feedback }
}
