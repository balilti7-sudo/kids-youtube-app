/**
 * Visual theater mode — layout only.
 * Android WebView often accepts requestFullscreen() without actually
 * promoting the player to the screen, so :fullscreen CSS never fills.
 * html.safetube-theater is the reliable viewport contract.
 *
 * Long vs Short are separate expand modes (not a single portrait flag):
 * each sets its own orientation-facing CSS class and tracked mode.
 */
import { isDocumentFullscreen } from './requestElementFullscreen'
import { requestChromeOffsetRefresh } from './chromeOffset'
import { requestPlayerChromeBump } from '../hooks/useAutoHidePlayerChrome'
import { unlockPlayerOrientationSafe } from './playerOrientation'

const THEATER_CLASS = 'safetube-theater'
/** Long-form expand (16:9 / landscape-facing). */
const THEATER_LONG_CLASS = 'safetube-theater-long'
/** Short expand (9:16 / portrait-facing). */
const THEATER_SHORT_CLASS = 'safetube-theater-short'
/** Legacy alias kept so older CSS selectors still match short expand. */
const THEATER_PORTRAIT_LEGACY_CLASS = 'safetube-theater-portrait'

export type PlayerExpandMode = 'long' | 'short'

/** True only after native document fullscreen actually engaged for this expand session. */
let nativeFullscreenEngaged = false
let recoveryInstalled = false
let activeExpandMode: PlayerExpandMode | null = null

export function isPlayerTheaterActive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains(THEATER_CLASS)
}

export function isPlayerExpanded(): boolean {
  return isDocumentFullscreen() || isPlayerTheaterActive()
}

/** Which expand machine is active (null when collapsed). */
export function getPlayerExpandMode(): PlayerExpandMode | null {
  return activeExpandMode
}

function clearModeClasses(target: HTMLElement): void {
  target.classList.remove(THEATER_LONG_CLASS, THEATER_SHORT_CLASS, THEATER_PORTRAIT_LEGACY_CLASS)
}

function applyExpandMode(mode: PlayerExpandMode): void {
  const html = document.documentElement
  const body = document.body
  clearModeClasses(html)
  clearModeClasses(body)
  if (mode === 'long') {
    html.classList.add(THEATER_LONG_CLASS)
    body.classList.add(THEATER_LONG_CLASS)
  } else {
    html.classList.add(THEATER_SHORT_CLASS, THEATER_PORTRAIT_LEGACY_CLASS)
    body.classList.add(THEATER_SHORT_CLASS, THEATER_PORTRAIT_LEGACY_CLASS)
  }
}

function clearTheaterDom(root?: HTMLElement | null): void {
  document.documentElement.classList.remove(THEATER_CLASS)
  document.body.classList.remove(THEATER_CLASS)
  clearModeClasses(document.documentElement)
  clearModeClasses(document.body)
  if (root) root.classList.remove('safetube-theater-root')
  document.querySelectorAll('.safetube-theater-root').forEach((el) => {
    el.classList.remove('safetube-theater-root')
  })
  nativeFullscreenEngaged = false
  activeExpandMode = null
}

function enterTheaterMode(mode: PlayerExpandMode, root?: HTMLElement | null): void {
  if (typeof document === 'undefined') return
  installPlayerTheaterRecovery()
  activeExpandMode = mode
  document.documentElement.classList.add(THEATER_CLASS)
  document.body.classList.add(THEATER_CLASS)
  applyExpandMode(mode)
  if (root) root.classList.add('safetube-theater-root')
  requestChromeOffsetRefresh()
  requestPlayerChromeBump()
}

/** Long-form expand theater — landscape-facing 16:9 letterbox contract. */
export function enterLongVideoTheater(root?: HTMLElement | null): void {
  enterTheaterMode('long', root)
}

/** Short expand theater — portrait-facing 9:16 contract. */
export function enterShortVideoTheater(root?: HTMLElement | null): void {
  enterTheaterMode('short', root)
}

/** Exit whichever expand machine is active. */
export function exitPlayerTheater(): void {
  if (typeof document === 'undefined') return
  installPlayerTheaterRecovery()
  clearTheaterDom()
  requestChromeOffsetRefresh()
  requestPlayerChromeBump()
}

/**
 * @deprecated Prefer enterLongVideoTheater / enterShortVideoTheater / exitPlayerTheater.
 * Kept so older call sites that pass a portrait flag keep compiling during the split.
 */
export function setPlayerTheaterActive(
  on: boolean,
  root?: HTMLElement | null,
  opts?: { portrait?: boolean }
): void {
  if (!on) {
    exitPlayerTheater()
    return
  }
  if (opts?.portrait) enterShortVideoTheater(root)
  else enterLongVideoTheater(root)
}

/**
 * When the OS / browser dismisses native fullscreen, clear class theater + orientation
 * so we never leave a stuck expand session. Class-only Android theater (no real FS)
 * is unaffected because `nativeFullscreenEngaged` stays false.
 */
export function installPlayerTheaterRecovery(): void {
  if (typeof document === 'undefined' || recoveryInstalled) return
  recoveryInstalled = true

  const syncViewport = () => {
    if (!isPlayerExpanded()) return
    requestChromeOffsetRefresh()
  }

  const syncViewportAndChrome = () => {
    syncViewport()
    requestPlayerChromeBump()
  }

  const onFullscreenChange = () => {
    if (isDocumentFullscreen()) {
      nativeFullscreenEngaged = true
      syncViewportAndChrome()
      return
    }
    if (!nativeFullscreenEngaged) return
    nativeFullscreenEngaged = false
    if (!isPlayerTheaterActive()) {
      void unlockPlayerOrientationSafe()
      requestChromeOffsetRefresh()
      requestPlayerChromeBump()
      return
    }
    // External FS exit while class theater still on → full recovery.
    exitPlayerTheater()
    void unlockPlayerOrientationSafe()
  }

  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  // Orientation needs a chrome re-show; plain resize only refreshes measured offsets.
  window.addEventListener('orientationchange', syncViewportAndChrome)
  window.addEventListener('resize', syncViewport)
  window.visualViewport?.addEventListener('resize', syncViewport)
}
