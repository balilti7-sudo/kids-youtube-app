import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ContentShape } from '../lib/videoFormatClassification'
import {
  collapsedPlayerMode,
  playerModeFromTheaterExpandMode,
  theaterModeForPresentation,
  type PlayerMode,
} from '../lib/playerMode'
import {
  getPlayerExpandMode,
  isPlayerExpanded,
  PLAYER_THEATER_STATE_CHANGED,
} from '../lib/playerTheater'
import {
  enterPlayerGestureFullscreen,
  exitPlayerGestureFullscreen,
  type ExpandTarget,
} from '../hooks/usePlayerTouchGestures'
import { setPlaybackContentShape, resetPlaybackContentShape } from '../lib/playbackContentShape'
import type { PresentationShape } from '../lib/presentationShape'
import {
  getPlaybackPresentationShape,
  resetPlaybackPresentationShape,
  PLAYBACK_PRESENTATION_SHAPE_CHANGED,
} from '../lib/playbackPresentationShape'
import {
  resetPlaybackPresentationContext,
} from '../lib/playbackPresentationContext'
import {
  setPlaybackPlayerMode,
  resetPlaybackPlayerMode,
  getPlaybackPlayerMode,
} from '../lib/playbackPlayerMode'

export type { PlayerMode } from '../lib/playerMode'
export { modeBlocksStickyMini, isTheaterPlayerMode } from '../lib/playerMode'

type PlayerModeContextValue = {
  mode: PlayerMode
  contentShape: ContentShape
  presentationShape: PresentationShape
  requestExpand: (target: ExpandTarget) => Promise<void>
  requestCollapse: () => Promise<void>
  notifyMiniActive: (active: boolean) => void
}

const PlayerModeContext = createContext<PlayerModeContextValue | null>(null)

function applyPlayerMode(
  mode: PlayerMode,
  setMode: (mode: PlayerMode) => void
): void {
  setMode(mode)
  setPlaybackPlayerMode(mode)
}

function syncTheaterPlayerMode(
  miniActive: boolean,
  setMode: (mode: PlayerMode) => void
): void {
  if (!isPlayerExpanded()) {
    applyPlayerMode(collapsedPlayerMode(miniActive), setMode)
    return
  }
  applyPlayerMode(playerModeFromTheaterExpandMode(getPlayerExpandMode()), setMode)
}

type Props = {
  contentShape: ContentShape
  /** When omitted, reads the session registry set at video tap. */
  presentationShape?: PresentationShape
  children: ReactNode
}

/**
 * Central player-mode controller for the inline watch shell.
 * Three independent axes: contentShape, presentationShape, playerMode.
 * Theater DOM/orientation implementation remains in playerTheater.ts.
 */
export function PlayerModeProvider({
  contentShape,
  presentationShape: presentationShapeProp,
  children,
}: Props) {
  setPlaybackContentShape(contentShape)

  const [mode, setMode] = useState<PlayerMode>(() => getPlaybackPlayerMode())
  const [presentationShape, setPresentationShapeState] = useState<PresentationShape>(
    () => presentationShapeProp ?? getPlaybackPresentationShape()
  )
  const miniActiveRef = useRef(false)

  const commitMode = useCallback((next: PlayerMode) => {
    applyPlayerMode(next, setMode)
  }, [])

  useEffect(() => {
    setPlaybackContentShape(contentShape)
  }, [contentShape])

  useEffect(() => {
    if (presentationShapeProp != null) {
      setPresentationShapeState(presentationShapeProp)
    }
  }, [presentationShapeProp])

  useEffect(() => {
    const onPresentationChanged = () => {
      setPresentationShapeState(getPlaybackPresentationShape())
    }
    window.addEventListener(PLAYBACK_PRESENTATION_SHAPE_CHANGED, onPresentationChanged)
    return () => window.removeEventListener(PLAYBACK_PRESENTATION_SHAPE_CHANGED, onPresentationChanged)
  }, [])

  useEffect(() => {
    return () => {
      resetPlaybackContentShape()
      resetPlaybackPresentationShape()
      resetPlaybackPresentationContext()
      resetPlaybackPlayerMode()
    }
  }, [])

  const syncFromTheater = useCallback(() => {
    syncTheaterPlayerMode(miniActiveRef.current, setMode)
  }, [])

  useEffect(() => {
    const onTheaterChanged = () => syncFromTheater()
    const onFullscreenChange = () => syncFromTheater()
    window.addEventListener(PLAYER_THEATER_STATE_CHANGED, onTheaterChanged)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    return () => {
      window.removeEventListener(PLAYER_THEATER_STATE_CHANGED, onTheaterChanged)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
    }
  }, [syncFromTheater])

  const requestExpand = useCallback(
    async (target: ExpandTarget) => {
      await enterPlayerGestureFullscreen(target)
      commitMode(theaterModeForPresentation(getPlaybackPresentationShape()))
    },
    [commitMode]
  )

  const requestCollapse = useCallback(async () => {
    await exitPlayerGestureFullscreen()
    commitMode(collapsedPlayerMode(miniActiveRef.current))
  }, [commitMode])

  const notifyMiniActive = useCallback(
    (active: boolean) => {
      miniActiveRef.current = active
      if (isPlayerExpanded()) return
      commitMode(collapsedPlayerMode(active))
    },
    [commitMode]
  )

  const value = useMemo(
    () => ({
      mode,
      contentShape,
      presentationShape,
      requestExpand,
      requestCollapse,
      notifyMiniActive,
    }),
    [mode, contentShape, presentationShape, requestExpand, requestCollapse, notifyMiniActive]
  )

  return <PlayerModeContext.Provider value={value}>{children}</PlayerModeContext.Provider>
}

export function usePlayerMode(): PlayerModeContextValue {
  const ctx = useContext(PlayerModeContext)
  if (!ctx) {
    throw new Error('usePlayerMode must be used within PlayerModeProvider')
  }
  return ctx
}

export function usePlayerModeOptional(): PlayerModeContextValue | null {
  return useContext(PlayerModeContext)
}
