import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSavedChildAccessToken } from '../../lib/childDevice'
import { childAddInterceptWatchSeconds } from '../../lib/childRuntime'
import { useChildRuntimeOptional } from '../../contexts/ChildRuntimeContext'
import {
  EDUCATIONAL_BREAKS_RUNTIME_ENABLED,
  normalizeBreakIntervalFromDevice,
  type InterceptPendingVideo,
} from '../../lib/educationalIntercept'
import { CleanPlayer, type CleanPlayerProps } from '../player/CleanPlayer'
import { CountdownOverlay } from './CountdownOverlay'

type Props = CleanPlayerProps

/**
 * CleanPlayer + pre-break countdown (final minute before break_interval_minutes).
 */
export function EducationalBreakPlayerChrome(props: Props) {
  const { videoId, title, channelTitle, posterUrl } = props
  const runtime = useChildRuntimeOptional()

  const hasKidToken = Boolean(getSavedChildAccessToken())
  const serverEnabled = runtime?.effectiveRuntime?.educationalInterceptEnabled ?? false
  const interceptActive = Boolean(runtime?.interceptActive)
  const enabled =
    EDUCATIONAL_BREAKS_RUNTIME_ENABLED && hasKidToken && serverEnabled && !interceptActive

  const intervalMinutes = normalizeBreakIntervalFromDevice(
    runtime?.breakIntervalMinutes ?? 30
  )
  const preBreakStartSeconds = Math.max(0, (intervalMinutes - 1) * 60)
  const breakAtVideoSeconds = intervalMinutes * 60

  const pendingVideo = useMemo(
    (): InterceptPendingVideo => ({
      videoId,
      title,
      channelTitle,
      posterUrl,
    }),
    [videoId, title, channelTitle, posterUrl]
  )
  const pendingRef = useRef(pendingVideo)
  useEffect(() => {
    pendingRef.current = pendingVideo
  }, [pendingVideo])

  const countdownVisibleRef = useRef(false)
  const breakTriggeredRef = useRef(false)
  const [showCountdown, setShowCountdown] = useState(false)

  useEffect(() => {
    countdownVisibleRef.current = false
    breakTriggeredRef.current = false
    setShowCountdown(false)
  }, [videoId])

  const triggerEducationalBreak = useCallback(() => {
    if (breakTriggeredRef.current || !runtime) return
    breakTriggeredRef.current = true
    countdownVisibleRef.current = false
    setShowCountdown(false)

    void (async () => {
      const pending = pendingRef.current
      const token = getSavedChildAccessToken()
      if (token) {
        const threshold = breakAtVideoSeconds
        const current = runtime.interceptWatchSeconds ?? 0
        const delta = Math.max(0, threshold - current)
        if (delta > 0) {
          await childAddInterceptWatchSeconds(token, delta)
        }
      }
      await runtime.tryBeginPlayback(pending)
      await runtime.refresh(true)
    })()
  }, [runtime, breakAtVideoSeconds])

  const onPlaybackTimeUpdate = useCallback(
    (currentTimeSeconds: number) => {
      if (!enabled || breakTriggeredRef.current) return
      if (currentTimeSeconds < preBreakStartSeconds) return
      if (!countdownVisibleRef.current) {
        countdownVisibleRef.current = true
        setShowCountdown(true)
      }
    },
    [enabled, preBreakStartSeconds]
  )

  /** Always one minute between (interval − 1) and interval on the video timeline. */
  const countdownMinutes =
    showCountdown ? (breakAtVideoSeconds - preBreakStartSeconds) / 60 : 0

  return (
    <div className="relative h-full w-full min-h-0">
      <CleanPlayer
        {...props}
        onPlaybackTimeUpdate={enabled ? onPlaybackTimeUpdate : undefined}
      />
      {showCountdown && enabled ? (
        <CountdownOverlay
          key={`${videoId}-prebreak`}
          minutesUntilBreak={countdownMinutes}
          onTimerEnd={triggerEducationalBreak}
        />
      ) : null}
    </div>
  )
}
