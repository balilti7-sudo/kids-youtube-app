import type { StreamPlaybackQuality } from './streamApi'

export type ClientResolvedStream = {
  playbackUrl: string
  mime: string
  format: 'direct' | 'hls'
  quality: string
}

/**
 * Resolve a stream URL via the media bridge (InnerTube on the server).
 * The browser never calls youtube.com directly — avoids CORS / "Failed to fetch".
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
  const { buildMediaBridgeApiUrl } = await import('./streamApi')
  const url = buildMediaBridgeApiUrl(`/api/youtube/resolve/${encodeURIComponent(id)}`, {
    quality: q,
  })

  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Media bridge unreachable for InnerTube resolve (${msg})`)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  if (!res.ok) {
    const detail =
      typeof body.detail === 'string'
        ? body.detail
        : typeof body.error === 'string'
          ? body.error
          : `InnerTube resolve HTTP ${res.status}`
    throw new Error(detail)
  }

  const playbackUrl = typeof body.playbackUrl === 'string' ? body.playbackUrl.trim() : ''
  if (!playbackUrl) {
    throw new Error('Bridge returned no playbackUrl')
  }

  const mime = typeof body.mime === 'string' ? body.mime : 'video/mp4'
  const format = body.format === 'hls' ? 'hls' : 'direct'

  return {
    playbackUrl,
    mime,
    format,
    quality: typeof body.quality === 'string' ? body.quality : q,
  }
}
