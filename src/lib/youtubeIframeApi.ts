import { Capacitor } from '@capacitor/core'

export type YoutubeIframePlayerVars = {
  autoplay?: 0 | 1
  modestbranding?: 0 | 1
  rel?: 0 | 1
  iv_load_policy?: 1 | 3
  playsinline?: 0 | 1
  enablejsapi?: 0 | 1
  fs?: 0 | 1
  disablekb?: 0 | 1
  origin?: string
  loop?: 0 | 1
  playlist?: string
}

export type YoutubePlayerState = -1 | 0 | 1 | 2 | 3 | 5

export interface YoutubeIframePlayer {
  playVideo: () => void
  pauseVideo: () => void
  stopVideo: () => void
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => YoutubePlayerState
  destroy: () => void
}

type YoutubePlayerEvent = {
  data: YoutubePlayerState
  target: YoutubeIframePlayer
}

type YoutubePlayerOptions = {
  videoId: string
  width?: string | number
  height?: string | number
  playerVars?: YoutubeIframePlayerVars
  events?: {
    onReady?: (event: { target: YoutubeIframePlayer }) => void
    onStateChange?: (event: YoutubePlayerEvent) => void
    onError?: (event: { data: number }) => void
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: YoutubePlayerOptions) => YoutubeIframePlayer
      PlayerState: {
        UNSTARTED: -1
        ENDED: 0
        PLAYING: 1
        PAUSED: 2
        BUFFERING: 3
        CUED: 5
      }
    }
    onYouTubeIframeAPIReady?: () => void
    __safetubeYtPlayer?: {
      play: () => void
      pause: () => void
      seekToMs: (ms: number) => void
      seekForwardMs: (ms: number) => void
      seekBackwardMs: (ms: number) => void
    }
  }
}

export const YT_PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const

let apiReadyPromise: Promise<void> | null = null

export function ensureYoutubeIframeApiLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.YT?.Player) return Promise.resolve()
  if (apiReadyPromise) return apiReadyPromise

  apiReadyPromise = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube IFrame API load timeout'))
    }, 15000)

    const finish = () => {
      window.clearTimeout(timeout)
      if (window.YT?.Player) resolve()
      else reject(new Error('YouTube IFrame API unavailable'))
    }

    if (window.YT?.Player) {
      finish()
      return
    }

    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      finish()
    }

    if (!document.querySelector('script[data-safetube-yt-iframe-api]')) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      tag.async = true
      tag.dataset.safetubeYtIframeApi = '1'
      tag.onerror = () => {
        window.clearTimeout(timeout)
        apiReadyPromise = null
        reject(new Error('YouTube IFrame API script failed'))
      }
      document.head.appendChild(tag)
    }
  }).catch((err) => {
    apiReadyPromise = null
    throw err
  })

  return apiReadyPromise
}

export function buildYoutubePlayerVars(opts: {
  origin?: string
  autoplay?: boolean
  loopVideoId?: string | null
}): YoutubeIframePlayerVars {
  const vars: YoutubeIframePlayerVars = {
    modestbranding: 1,
    rel: 0,
    iv_load_policy: 3,
    playsinline: 1,
    enablejsapi: 1,
    fs: 0,
    disablekb: 1,
    autoplay: opts.autoplay === false ? 0 : 1,
  }
  const origin = opts.origin?.trim()
  if (origin) vars.origin = origin
  if (opts.loopVideoId) {
    vars.loop = 1
    vars.playlist = opts.loopVideoId
  }
  return vars
}

export function isYoutubePlayerPlaying(player: YoutubeIframePlayer | null): boolean {
  if (!player) return false
  try {
    const state = player.getPlayerState()
    return state === YT_PLAYER_STATE.PLAYING || state === YT_PLAYER_STATE.BUFFERING
  } catch {
    return false
  }
}

export function publishYoutubePlayerBridge(player: YoutubeIframePlayer | null) {
  if (typeof window === 'undefined') return
  if (!player) {
    delete window.__safetubeYtPlayer
    return
  }
  window.__safetubeYtPlayer = {
    play: () => {
      try {
        player.playVideo()
      } catch {
        /* ignore */
      }
    },
    pause: () => {
      try {
        player.pauseVideo()
      } catch {
        /* ignore */
      }
    },
    seekToMs: (ms: number) => {
      try {
        player.seekTo(Math.max(0, ms / 1000), true)
      } catch {
        /* ignore */
      }
    },
    seekForwardMs: (ms: number) => {
      try {
        const cur = player.getCurrentTime()
        const dur = player.getDuration()
        const next = Math.min(dur > 0 ? dur : cur + ms / 1000, cur + ms / 1000)
        player.seekTo(next, true)
      } catch {
        /* ignore */
      }
    },
    seekBackwardMs: (ms: number) => {
      try {
        const cur = player.getCurrentTime()
        player.seekTo(Math.max(0, cur - ms / 1000), true)
      } catch {
        /* ignore */
      }
    },
  }
}

/** Android must keep youtube.com embed host per working playback path. */
export function useYoutubeEmbedHost(): 'youtube' | 'nocookie' {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' ? 'youtube' : 'nocookie'
}
