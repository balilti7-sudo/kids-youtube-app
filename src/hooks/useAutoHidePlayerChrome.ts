import { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_HIDE_MS = 2800

/** Fired on expand/exit/mini transitions so every mounted player chrome re-shows. */
export const PLAYER_CHROME_BUMP_EVENT = 'safetube:player-chrome-bump'
/** YouTube-like single-tap: show if hidden, hide if visible. */
export const PLAYER_CHROME_TOGGLE_EVENT = 'safetube:player-chrome-toggle'
/** Keep chrome visible while seeking / dragging / pressing controls / gesturing. */
export const PLAYER_CHROME_HOLD_EVENT = 'safetube:player-chrome-hold'
export const PLAYER_CHROME_RELEASE_EVENT = 'safetube:player-chrome-release'

/** Ask all active `useAutoHidePlayerChrome` hooks to show chrome (layout transitions). */
export function requestPlayerChromeBump(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_BUMP_EVENT))
}

/** Toggle chrome visibility (YouTube single-tap on video). */
export function requestPlayerChromeToggle(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_TOGGLE_EVENT))
}

/** Pause auto-hide while an interaction is in progress (nestable). */
export function requestPlayerChromeHold(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_HOLD_EVENT))
}

/** Resume auto-hide after the matching hold (nestable). */
export function requestPlayerChromeRelease(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_RELEASE_EVENT))
}

/**
 * YouTube-style chrome visibility: hide after idle, show on any interaction,
 * single-tap toggles when idle (not while held / locked / paused).
 */
export function useAutoHidePlayerChrome(options?: {
  enabled?: boolean
  hideAfterMs?: number
  locked?: boolean
  /** When false, keep chrome visible (paused / ended). Defaults to true. */
  playing?: boolean
}) {
  const enabled = options?.enabled ?? true
  const hideAfterMs = options?.hideAfterMs ?? DEFAULT_HIDE_MS
  const locked = options?.locked ?? false
  const playing = options?.playing ?? true
  const [chromeVisible, setChromeVisible] = useState(true)
  const timerRef = useRef<number | null>(null)
  const holdDepthRef = useRef(0)
  const visibleRef = useRef(true)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const bump = useCallback(() => {
    if (!enabled) {
      visibleRef.current = true
      setChromeVisible(true)
      return
    }
    if (!visibleRef.current) {
      visibleRef.current = true
      setChromeVisible(true)
    }
    clearTimer()
    if (locked || !playing || holdDepthRef.current > 0) return
    timerRef.current = window.setTimeout(() => {
      if (holdDepthRef.current > 0) return
      visibleRef.current = false
      setChromeVisible(false)
      timerRef.current = null
    }, hideAfterMs)
  }, [clearTimer, enabled, hideAfterMs, locked, playing])

  const hide = useCallback(() => {
    if (!enabled || locked || !playing || holdDepthRef.current > 0) return
    clearTimer()
    if (!visibleRef.current) return
    visibleRef.current = false
    setChromeVisible(false)
  }, [clearTimer, enabled, locked, playing])

  const toggle = useCallback(() => {
    if (!enabled) return
    if (locked || !playing) {
      bump()
      return
    }
    if (holdDepthRef.current > 0) return
    if (visibleRef.current) hide()
    else bump()
  }, [enabled, locked, playing, bump, hide])

  const hold = useCallback(() => {
    holdDepthRef.current += 1
    clearTimer()
    if (!visibleRef.current) {
      visibleRef.current = true
      setChromeVisible(true)
    }
  }, [clearTimer])

  const release = useCallback(() => {
    holdDepthRef.current = Math.max(0, holdDepthRef.current - 1)
    if (holdDepthRef.current === 0) bump()
  }, [bump])

  useEffect(() => {
    if (!enabled) {
      clearTimer()
      holdDepthRef.current = 0
      visibleRef.current = true
      setChromeVisible(true)
      return
    }
    bump()
    return clearTimer
  }, [enabled, bump, clearTimer])

  useEffect(() => {
    if (locked || !playing) {
      clearTimer()
      visibleRef.current = true
      setChromeVisible(true)
    } else {
      bump()
    }
  }, [locked, playing, bump, clearTimer])

  useEffect(() => {
    if (!enabled) return
    const onBump = () => bump()
    const onToggle = () => toggle()
    const onHold = () => hold()
    const onRelease = () => release()
    window.addEventListener(PLAYER_CHROME_BUMP_EVENT, onBump)
    window.addEventListener(PLAYER_CHROME_TOGGLE_EVENT, onToggle)
    window.addEventListener(PLAYER_CHROME_HOLD_EVENT, onHold)
    window.addEventListener(PLAYER_CHROME_RELEASE_EVENT, onRelease)
    return () => {
      window.removeEventListener(PLAYER_CHROME_BUMP_EVENT, onBump)
      window.removeEventListener(PLAYER_CHROME_TOGGLE_EVENT, onToggle)
      window.removeEventListener(PLAYER_CHROME_HOLD_EVENT, onHold)
      window.removeEventListener(PLAYER_CHROME_RELEASE_EVENT, onRelease)
    }
  }, [enabled, bump, toggle, hold, release])

  return {
    chromeVisible,
    bumpChrome: bump,
    toggleChrome: toggle,
    hideChrome: hide,
    holdChrome: hold,
    releaseChrome: release,
  }
}
