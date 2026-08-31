/**
 * Visual theater mode — layout only.
 * Android WebView often accepts requestFullscreen() without actually
 * promoting the player to the screen, so :fullscreen CSS never fills.
 * html.safetube-theater is the reliable viewport contract.
 */
import { isDocumentFullscreen } from './requestElementFullscreen'
import { requestChromeOffsetRefresh } from './chromeOffset'
import { requestPlayerChromeBump } from '../hooks/useAutoHidePlayerChrome'
import { unlockPlayerOrientationSafe } from './playerOrientation'

const THEATER_CLASS = 'safetube-theater'
const THEATER_PORTRAIT_CLASS = 'safetube-theater-portrait'

/** True only after native document fullscreen actually engaged for this expand session. */
let nativeFullscreenEngaged = false
let recoveryInstalled = false

export function isPlayerTheaterActive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains(THEATER_CLASS)
}

export function isPlayerExpanded(): boolean {
  return isDocumentFullscreen() || isPlayerTheaterActive()
}

export function setPlayerTheaterActive(
  on: boolean,
  root?: HTMLElement | null,
  opts?: { portrait?: boolean }
): void {
  if (typeof document === 'undefined') return
  installPlayerTheaterRecovery()
  document.documentElement.classList.toggle(THEATER_CLASS, on)
  document.body.classList.toggle(THEATER_CLASS, on)
  const portrait = Boolean(on && opts?.portrait)
  document.documentElement.classList.toggle(THEATER_PORTRAIT_CLASS, portrait)
  document.body.classList.toggle(THEATER_PORTRAIT_CLASS, portrait)
  if (root) {
    root.classList.toggle('safetube-theater-root', on)
  }
  if (!on) {
    nativeFullscreenEngaged = false
    document.documentElement.classList.remove(THEATER_PORTRAIT_CLASS)
    document.body.classList.remove(THEATER_PORTRAIT_CLASS)
    document.querySelectorAll('.safetube-theater-root').forEach((el) => {
      el.classList.remove('safetube-theater-root')
    })
  }
  // Keep measured chrome + auto-hide in sync with expand / collapse.
  requestChromeOffsetRefresh()
  requestPlayerChromeBump()
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
    setPlayerTheaterActive(false)
    void unlockPlayerOrientationSafe()
  }

  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  // Orientation needs a chrome re-show; plain resize only refreshes measured offsets.
  window.addEventListener('orientationchange', syncViewportAndChrome)
  window.addEventListener('resize', syncViewport)
  window.visualViewport?.addEventListener('resize', syncViewport)
}
