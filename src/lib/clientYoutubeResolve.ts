import type { StreamPlaybackQuality } from './streamApi'

/** Minimal shape from youtubei.js streaming_data formats (ANDROID client). */
type YoutubeStreamFormat = {
  url?: string | null
  height?: number | null
  has_video?: boolean
  has_audio?: boolean
  mime_type?: string | null
  quality_label?: string | null
  decipher?: (player: unknown) => Promise<string | undefined>
}

const HEIGHT_BY_QUALITY: Record<string, number> = {
  '240p': 240,
  '360p': 360,
  '480p': 480,
  '720p': 720,
  '1080p': 1080,
}

export type ClientResolvedStream = {
  playbackUrl: string
  mime: string
  format: 'direct' | 'hls'
  quality: string
}

let innertubePromise: Promise<import('youtubei.js').default> | null = null

async function getInnertube(): Promise<import('youtubei.js').default> {
  if (!innertubePromise) {
    innertubePromise = import('youtubei.js').then(({ Innertube, ClientType }) =>
      Innertube.create({
        client_type: ClientType.ANDROID,
        generate_session_locally: true,
      })
    )
  }
  return innertubePromise
}

function pickProgressiveFormat(formats: YoutubeStreamFormat[], minHeight: number): YoutubeStreamFormat | null {
  const progressive = formats
    .filter((f) => f.has_video && f.has_audio)
    .sort((a, b) => (a.height || 0) - (b.height || 0))

  return (
    progressive.find((f) => (f.height || 0) >= minHeight) ||
    progressive[progressive.length - 1] ||
    null
  )
}

function pickAdaptiveVideoFormat(formats: YoutubeStreamFormat[], minHeight: number): YoutubeStreamFormat | null {
  const videoOnly = formats
    .filter((f) => f.has_video && !f.has_audio)
    .sort((a, b) => (a.height || 0) - (b.height || 0))

  return (
    videoOnly.find((f) => (f.height || 0) >= minHeight) ||
    videoOnly[videoOnly.length - 1] ||
    null
  )
}

async function formatPlaybackUrl(format: YoutubeStreamFormat, player: unknown): Promise<string> {
  if (format.url) return format.url
  if (player && typeof format.decipher === 'function') {
    const deciphered = await format.decipher(player)
    if (deciphered) return deciphered
  }
  throw new Error('Stream format has no playable URL')
}

/**
 * Resolve a direct googlevideo URL in the user's browser via YouTube InnerTube
 * (ANDROID client — URLs are returned without server-side deciphering).
 */
export async function resolveClientYoutubeStream(
  videoId: string,
  quality: StreamPlaybackQuality | string = '360p'
): Promise<ClientResolvedStream> {
  const id = String(videoId || '').trim()
  if (!/^[\w-]{11}$/.test(id)) {
    throw new Error('Invalid YouTube video id')
  }

  const q = String(quality || '360p').trim().toLowerCase()
  const minHeight = HEIGHT_BY_QUALITY[q] || 360

  const yt = await getInnertube()
  const { ClientType } = await import('youtubei.js')
  const info = await yt.getBasicInfo(id, { client: ClientType.ANDROID })

  const status = info.playability_status?.status
  if (status && status !== 'OK') {
    const reason = info.playability_status?.reason || status
    throw new Error(reason)
  }

  const formats = [
    ...(info.streaming_data?.formats || []),
    ...(info.streaming_data?.adaptive_formats || []),
  ] as YoutubeStreamFormat[]

  if (!formats.length) {
    throw new Error('No stream formats returned by YouTube')
  }

  const format = pickProgressiveFormat(formats, minHeight) || pickAdaptiveVideoFormat(formats, minHeight)
  if (!format) {
    throw new Error(`No ${q} stream format available`)
  }

  const playbackUrl = await formatPlaybackUrl(format, yt.session.player)
  const mime = format.mime_type || 'video/mp4'
  const isHls = /\.m3u8(\?|$)/i.test(playbackUrl) || /mpegurl/i.test(mime)

  return {
    playbackUrl,
    mime,
    format: isHls ? 'hls' : 'direct',
    quality: format.quality_label || q,
  }
}
