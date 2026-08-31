import { useCallback, useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { exitPlayerGestureFullscreen } from './usePlayerTouchGestures'
import { isPlayerExpanded } from '../lib/playerTheater'
import {
  ensurePlayerHistoryLayer,
  popPlayerHistoryLayerIfPresent,
  readPlayerHistoryLayer,
  type SafetubePlayerHistoryLayer,
} from '../lib/watchPlayerNav'

type Options = {
  /** When false, no listeners / history sync. */
  enabled?: boolean
  isShortsOpen: boolean
  isWatchOpen: boolean
  /** Single exit for Shorts (X, swipe-down, Android/browser Back). */
  onExitShorts: () => void
  /** Exit normal long-form watch → browse. */
  onExitWatch: () => void
}

type BackHandler = (fromPopstate?: boolean) => boolean

/** Newest handlers win first (e.g. playlist tab over dormant channel watch). */
const hardwareBackStack: BackHandler[] = []
let hardwareBackInstalled = false
let hardwareBackHandle: { remove: () => Promise<void> } | null = null

/**
 * Shared browser-Back stack — one window popstate listener.
 * Prevents KidModePage + KidPlaylistView (both mounted under /kid) from
 * double-handling the same history event.
 */
const popstateBackStack: BackHandler[] = []
let popstateInstalled = false
/** Shared suppress so UI-initiated history.back() does not exit twice. */
let suppressNextPopstate = false

function onSharedPopState(): void {
  if (suppressNextPopstate) {
    suppressNextPopstate = false
    return
  }
  for (let i = popstateBackStack.length - 1; i >= 0; i--) {
    if (popstateBackStack[i]?.(true)) return
  }
}

function installPopstateOnce(): void {
  if (popstateInstalled || typeof window === 'undefined') return
  popstateInstalled = true
  window.addEventListener('popstate', onSharedPopState)
}

/**
 * Drop the player history entry without running Back handlers
 * (e.g. switching channels while Shorts/Watch is open).
 */
export function discardPlayerHistoryLayerQuietly(): void {
  if (typeof history === 'undefined') return
  if (readPlayerHistoryLayer(history.state) == null) return
  suppressNextPopstate = true
  popPlayerHistoryLayerIfPresent()
}

function installHardwareBackOnce(): void {
  if (hardwareBackInstalled || !Capacitor.isNativePlatform()) return
  hardwareBackInstalled = true
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    for (let i = hardwareBackStack.length - 1; i >= 0; i--) {
      if (hardwareBackStack[i]?.(false)) return
    }
    if (canGoBack) {
      window.history.back()
      return
    }
    void CapApp.exitApp()
  }).then((h) => {
    hardwareBackHandle = h
  })
}

/**
 * Player-owned Back only — does not intercept when the player has no layer.
 * Priority per handler: Shorts → expanded/fullscreen → watch → (fall through).
 * One history entry per Watch/Shorts session; swipes do not push.
 */
export function usePlayerOwnedBackNavigation(options: Options): {
  handlePlayerBack: () => boolean
} {
  const enabled = options.enabled ?? true
  const optionsRef = useRef(options)
  optionsRef.current = options

  const exitWithHistoryPop = useCallback((exit: () => void) => {
    exit()
    if (readPlayerHistoryLayer(history.state) != null) {
      suppressNextPopstate = true
      popPlayerHistoryLayerIfPresent()
    }
  }, [])

  const handlePlayerBack = useCallback((fromPopstate = false): boolean => {
    if (optionsRef.current.enabled === false) return false

    if (optionsRef.current.isShortsOpen) {
      exitWithHistoryPop(() => optionsRef.current.onExitShorts())
      return true
    }

    if (isPlayerExpanded()) {
      void exitPlayerGestureFullscreen()
      // Expand has no history entry — browser Back already consumed the Watch layer.
      if (fromPopstate && optionsRef.current.isWatchOpen) {
        ensurePlayerHistoryLayer('watch')
      }
      return true
    }

    if (optionsRef.current.isWatchOpen) {
      exitWithHistoryPop(() => optionsRef.current.onExitWatch())
      return true
    }

    return false
  }, [exitWithHistoryPop])

  useEffect(() => {
    if (!enabled) return
    let layer: SafetubePlayerHistoryLayer | null = null
    if (options.isShortsOpen) layer = 'shorts'
    else if (options.isWatchOpen) layer = 'watch'
    if (layer) ensurePlayerHistoryLayer(layer)
  }, [enabled, options.isShortsOpen, options.isWatchOpen])

  useEffect(() => {
    if (!enabled) return
    installPopstateOnce()
    popstateBackStack.push(handlePlayerBack)
    return () => {
      const idx = popstateBackStack.lastIndexOf(handlePlayerBack)
      if (idx >= 0) popstateBackStack.splice(idx, 1)
    }
  }, [enabled, handlePlayerBack])

  useEffect(() => {
    if (!enabled) return
    installHardwareBackOnce()
    hardwareBackStack.push(handlePlayerBack)
    return () => {
      const idx = hardwareBackStack.lastIndexOf(handlePlayerBack)
      if (idx >= 0) hardwareBackStack.splice(idx, 1)
    }
  }, [enabled, handlePlayerBack])

  return {
    // UI / Android callers never pass fromPopstate (expand must not re-push history).
    handlePlayerBack: () => handlePlayerBack(false),
  }
}

/** Test/teardown helper — not used in production UI. */
export function __resetPlayerHardwareBackForTests(): void {
  hardwareBackStack.length = 0
  popstateBackStack.length = 0
  suppressNextPopstate = false
  void hardwareBackHandle?.remove()
  hardwareBackHandle = null
  hardwareBackInstalled = false
}
