/**
 * On-device YouTube stream resolution.
 *
 * The whole point of the device architecture: resolve (InnerTube) and playback happen on
 * the child's device, from its residential IP. YouTube's stream URL is bound to that IP,
 * and the `<video>` element fetches the bytes directly from googlevideo — no media bridge,
 * no proxy, no server bandwidth, and (crucially) no datacenter bot check.
 *
 * Each platform wrapper installs a `window.safetube` bridge:
 *   - Electron: the main process (Node) runs the resolver and answers over IPC.
 *   - Capacitor: the WebView runs the shared resolver using the native HTTP plugin.
 * The web build has no bridge, so callers fall back to the remote Media Bridge.
 */

export interface DeviceResolvedStream {
  videoId: string
  /** Direct googlevideo URL, IP-bound to THIS device — played straight by `<video>`. */
  playbackUrl: string
  mime: string
  format: 'direct' | 'hls'
  quality: string
}

export interface SafetubeNativeBridge {
  readonly platform: 'electron' | 'capacitor'
  resolve(
    videoId: string,
    quality: string,
    opts?: { forceRefresh?: boolean }
  ): Promise<DeviceResolvedStream>
}

declare global {
  interface Window {
    safetube?: SafetubeNativeBridge
  }
}

/** True when running inside a platform wrapper that can resolve on-device. */
export function isDeviceResolveAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.safetube?.resolve === 'function'
}

/** Which wrapper we're in, or `null` for a plain web browser. */
export function deviceResolvePlatform(): SafetubeNativeBridge['platform'] | null {
  return typeof window !== 'undefined' ? window.safetube?.platform ?? null : null
}

const VIDEO_ID_RE = /^[\w-]{11}$/

export async function resolveOnDevice(
  videoId: string,
  quality: string,
  opts?: { forceRefresh?: boolean }
): Promise<DeviceResolvedStream> {
  const id = String(videoId || '').trim()
  if (!VIDEO_ID_RE.test(id)) throw new Error('Invalid YouTube video id')
  if (!window.safetube?.resolve) throw new Error('On-device resolver is not available')

  const resolved = await window.safetube.resolve(
    id,
    String(quality || '360p').trim().toLowerCase(),
    opts
  )
  if (!resolved?.playbackUrl) throw new Error('On-device resolver returned no playbackUrl')
  return resolved
}
