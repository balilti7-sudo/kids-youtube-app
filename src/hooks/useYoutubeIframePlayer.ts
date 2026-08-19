import { useCallback, useEffect, useRef, useState } from 'react'
import { setMediaPlaybackActive, syncNativeMediaSession } from '../lib/mediaPlaybackActivity'
import { subscribeNativeMediaActions } from '../lib/nativeMediaPlayback'
import { registerPlaybackPauseHandler } from '../lib/playbackController'
import { useDailyWatchBudgetStore } from '../stores/dailyWatchBudgetStore'
import {
  buildYoutubePlayerVars,
  ensureYoutubeIframeApiLoaded,
  isYoutubePlayerPlaying,
  publishYoutubePlayerBridge,
  YT_PLAYER_STATE,
  type YoutubeIframePlayer,
} from '../lib/youtubeIframeApi'

function pickArtworkUrl(videoId: string, posterUrl?: string | null): string | undefined {
  const safePoster = posterUrl?.trim()
  if (safePoster) return safePoster
  if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }
  return undefined
}

export function useYoutubeIframePlayer(opts: {
  containerRef: React.RefObject<HTMLDivElement | null>
  videoId: string | null
  loopEnabled: boolean
  disabled: boolean
  title: string
  channelTitle?: string
  posterUrl?: string | null
  origin?: string
  onReady?: () => void
  onPlaybackStarted?: (videoId: string) => void
  onPlayingChange?: (playing: boolean) => void
  onNextTrack?: () => void
  onPreviousTrack?: () => void
  hasNextTrack?: boolean
}) {
  const {
    containerRef,
    videoId,
    loopEnabled,
    disabled,
    title,
    channelTitle,
    posterUrl,
    origin,
    onReady,
    onPlaybackStarted,
    onPlayingChange,
    onNextTrack,
    onPreviousTrack,
    hasNextTrack = true,
  } = opts

  const playerRef = useRef<YoutubeIframePlayer | null>(null)
  const playbackStartedRef = useRef(false)
  const [playerReady, setPlayerReady] = useState(false)
  const syncTimerRef = useRef<number | null>(null)

  const handleNextRef = useRef(onNextTrack)
  handleNextRef.current = onNextTrack

  const pausePlayer = useCallback(() => {
    try {
      playerRef.current?.pauseVideo()
    } catch {
      /* ignore */
    }
    setMediaPlaybackActive(false)
    onPlayingChange?.(false)
  }, [onPlayingChange])

  const syncTransport = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    const playing = isYoutubePlayerPlaying(player)
    let durationMs = 0
    let positionMs = 0
    try {
      durationMs = Math.max(0, Math.floor(player.getDuration() * 1000))
      positionMs = Math.max(0, Math.floor(player.getCurrentTime() * 1000))
    } catch {
      /* ignore */
    }
    const artworkUrl = videoId ? pickArtworkUrl(videoId, posterUrl) : undefined
    setMediaPlaybackActive(playing, {
      title: title || 'SafeTube',
      artist: (channelTitle || '').trim() || 'SafeTube',
      playing,
      durationMs: durationMs || undefined,
      positionMs: positionMs || undefined,
      artworkUrl,
      canSkipNext: hasNextTrack,
      canSkipPrev: Boolean(onPreviousTrack),
    })
    syncNativeMediaSession({
      title: title || 'SafeTube',
      artist: (channelTitle || '').trim() || 'SafeTube',
      playing,
      durationMs: durationMs || undefined,
      positionMs: positionMs || undefined,
      artworkUrl,
      canSkipNext: hasNextTrack,
      canSkipPrev: Boolean(onPreviousTrack),
    })
    onPlayingChange?.(playing)
  }, [videoId, title, channelTitle, posterUrl, hasNextTrack, onPreviousTrack, onPlayingChange])

  useEffect(() => {
    playbackStartedRef.current = false
    setPlayerReady(false)
    if (disabled || !videoId || !containerRef.current) {
      publishYoutubePlayerBridge(null)
      playerRef.current?.destroy()
      playerRef.current = null
      return
    }

    let cancelled = false
    const hostEl = containerRef.current

    void ensureYoutubeIframeApiLoaded()
      .then(() => {
        if (cancelled || !hostEl) return
        playerRef.current?.destroy()
        playerRef.current = null

        const player = new window.YT!.Player(hostEl, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: buildYoutubePlayerVars({
            origin,
            autoplay: true,
            loopVideoId: loopEnabled ? videoId : null,
          }),
          events: {
            onReady: (event) => {
              if (cancelled) return
              playerRef.current = event.target
              publishYoutubePlayerBridge(event.target)
              setPlayerReady(true)
              onReady?.()
              syncTransport()
            },
            onStateChange: (event) => {
              if (cancelled) return
              const state = event.data
              if (
                state === YT_PLAYER_STATE.PLAYING &&
                videoId &&
                onPlaybackStarted &&
                !playbackStartedRef.current
              ) {
                playbackStartedRef.current = true
                onPlaybackStarted(videoId)
              }
              syncTransport()
            },
            onError: () => {
              if (cancelled) return
              setMediaPlaybackActive(false)
              onPlayingChange?.(false)
            },
          },
        })
        playerRef.current = player
        publishYoutubePlayerBridge(player)
      })
      .catch((err) => {
        console.warn('[useYoutubeIframePlayer] init failed', err)
      })

    return () => {
      cancelled = true
      if (syncTimerRef.current != null) {
        window.clearInterval(syncTimerRef.current)
        syncTimerRef.current = null
      }
      publishYoutubePlayerBridge(null)
      try {
        playerRef.current?.destroy()
      } catch {
        /* ignore */
      }
      playerRef.current = null
      setPlayerReady(false)
      setMediaPlaybackActive(false)
      onPlayingChange?.(false)
    }
  }, [
    videoId,
    loopEnabled,
    disabled,
    origin,
    containerRef,
    onReady,
    onPlaybackStarted,
    onPlayingChange,
    syncTransport,
  ])

  useEffect(() => {
    if (!playerReady) return
    return registerPlaybackPauseHandler(pausePlayer)
  }, [playerReady, pausePlayer])

  useEffect(() => {
    if (!playerReady) return
    if (syncTimerRef.current != null) window.clearInterval(syncTimerRef.current)
    syncTimerRef.current = window.setInterval(() => {
      if (!isYoutubePlayerPlaying(playerRef.current)) return
      syncTransport()
    }, 2000)
    return () => {
      if (syncTimerRef.current != null) {
        window.clearInterval(syncTimerRef.current)
        syncTimerRef.current = null
      }
    }
  }, [playerReady, syncTransport])

  useEffect(() => {
    if (!playerReady || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const artworkUrl = videoId ? pickArtworkUrl(videoId, posterUrl) : undefined
    const artwork = artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }] : []

    try {
      ms.metadata = new MediaMetadata({
        title: title || 'SafeTube',
        artist: (channelTitle || '').trim() || 'SafeTube',
        album: 'SafeTube',
        artwork,
      })
    } catch {
      /* ignore */
    }

    const seekBy = (deltaSec: number) => {
      const player = playerRef.current
      if (!player) return
      try {
        const cur = player.getCurrentTime()
        const dur = player.getDuration()
        const next = Math.min(Math.max(0, cur + deltaSec), dur > 0 ? dur : cur + deltaSec)
        player.seekTo(next, true)
        syncTransport()
      } catch {
        /* ignore */
      }
    }

    try {
      ms.setActionHandler('play', () => {
        if (useDailyWatchBudgetStore.getState().isLimitReached) {
          pausePlayer()
          return
        }
        try {
          playerRef.current?.playVideo()
        } catch {
          /* ignore */
        }
      })
      ms.setActionHandler('pause', () => pausePlayer())
      ms.setActionHandler('previoustrack', onPreviousTrack ?? null)
      ms.setActionHandler('nexttrack', () => handleNextRef.current?.())
      ms.setActionHandler('seekbackward', (details) => seekBy(-(details.seekOffset || 10)))
      ms.setActionHandler('seekforward', (details) => seekBy(details.seekOffset || 10))
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime == null) return
        try {
          playerRef.current?.seekTo(Math.max(0, details.seekTime), true)
          syncTransport()
        } catch {
          /* ignore */
        }
      })
    } catch {
      /* older WebKit */
    }

    return () => {
      try {
        ms.metadata = null
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
        ms.setActionHandler('seekbackward', null)
        ms.setActionHandler('seekforward', null)
        ms.setActionHandler('seekto', null)
      } catch {
        /* ignore */
      }
    }
  }, [playerReady, videoId, title, channelTitle, posterUrl, onPreviousTrack, pausePlayer, syncTransport])

  useEffect(() => {
    if (!playerReady) return
    const player = playerRef.current
    if (!player) return

    return subscribeNativeMediaActions((event) => {
      if (useDailyWatchBudgetStore.getState().isLimitReached && event.action === 'play') {
        pausePlayer()
        return
      }
      switch (event.action) {
        case 'play':
          try {
            player.playVideo()
          } catch {
            /* ignore */
          }
          break
        case 'pause':
          pausePlayer()
          break
        case 'next':
          handleNextRef.current?.()
          break
        case 'previous':
          onPreviousTrack?.()
          break
        case 'seekto':
          if (typeof event.seekToMs === 'number') {
            try {
              player.seekTo(Math.max(0, event.seekToMs / 1000), true)
              syncTransport()
            } catch {
              /* ignore */
            }
          }
          break
        case 'seekforward':
          seekByNative(player, (event.seekToMs ?? 10000) / 1000)
          syncTransport()
          break
        case 'seekbackward':
          seekByNative(player, -((event.seekToMs ?? 10000) / 1000))
          syncTransport()
          break
        default:
          break
      }
    })
  }, [playerReady, onPreviousTrack, pausePlayer, syncTransport])

  return { playerReady, pausePlayer }
}

function seekByNative(player: YoutubeIframePlayer, deltaSec: number) {
  try {
    const cur = player.getCurrentTime()
    const dur = player.getDuration()
    const next = Math.min(Math.max(0, cur + deltaSec), dur > 0 ? dur : cur + deltaSec)
    player.seekTo(next, true)
  } catch {
    /* ignore */
  }
}
