/**
 * In-WebView YouTube resolver for the Capacitor (Android/iOS) build.
 *
 * Runs entirely on the device: InnerTube (youtubei.js) + a BotGuard PO Token (bgutils-js),
 * with all outbound calls going through Capacitor's native HTTP so they are NOT subject to
 * WebView CORS. The resulting googlevideo URL is bound to the device's own residential IP,
 * so `<video>` plays it directly — no Media Bridge, no proxy, no server bandwidth, no
 * datacenter bot check.
 *
 * Mirrors server/youtube-innertube.cjs + server/youtube-po-token.cjs, adapted for the WebView:
 *   - fetch → CapacitorHttp (bypasses CORS)
 *   - BotGuard runs against the real `window` (no jsdom needed)
 *   - ANDROID client first, so stream URLs come pre-deciphered (no JS interpreter required)
 */
import { CapacitorHttp } from '@capacitor/core'
import type { DeviceResolvedStream } from './index'

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const PO_TOKEN_TTL_MS = 55 * 60 * 1000
const RESOLVE_TTL_MS = 3.5 * 60 * 60 * 1000

const HEIGHT_BY_QUALITY: Record<string, number> = {
  '240p': 240, '360p': 360, '480p': 480, '720p': 720, '1080p': 1080,
}
const CLIENT_ORDER = ['ANDROID', 'IOS', 'WEB'] as const

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) h.forEach((v, k) => { out[k] = v })
  else if (Array.isArray(h)) for (const [k, v] of h) out[k] = String(v)
  else for (const k of Object.keys(h)) out[k] = String((h as Record<string, unknown>)[k])
  return out
}

/** fetch() shim that routes through native HTTP (no CORS) and returns a real Response. */
async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
  const headers = headersToObject(
    init?.headers || (input instanceof Request ? input.headers : undefined)
  )
  let data: unknown = init?.body
  if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data)
  else if (ArrayBuffer.isView(data)) data = new TextDecoder().decode(data as Uint8Array)

  const res = await CapacitorHttp.request({ url, method, headers, data, responseType: 'text' })
  const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  const status = res.status && res.status >= 200 ? res.status : 200
  return new Response(bodyText, { status, headers: (res.headers as Record<string, string>) || {} })
}

type PoTokenSession = {
  visitorData: string
  sessionPoToken: string
  mintContentBoundToken: (id: string) => Promise<string>
  createdAt: number
}

let poSessionPromise: Promise<PoTokenSession> | null = null
let poSessionAt = 0

async function createPoTokenSession(): Promise<PoTokenSession> {
  const { BG } = await import('bgutils-js')
  const { Innertube } = await import('youtubei.js')

  const bare = await Innertube.create({ retrieve_player: false, fetch: nativeFetch })
  const visitorData = bare.session.context.client.visitorData
  if (!visitorData) throw new Error('PO Token: no visitorData from InnerTube')

  const bgConfig = {
    fetch: nativeFetch as unknown as typeof fetch,
    globalObj: globalThis,
    identifier: visitorData,
    requestKey: REQUEST_KEY,
  }

  const challenge = await BG.Challenge.create(bgConfig)
  if (!challenge) throw new Error('PO Token: no BotGuard challenge')

  const interpreterJs =
    challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
  if (!interpreterJs) throw new Error('PO Token: challenge missing interpreter')
  // eslint-disable-next-line no-new-func
  new Function(interpreterJs)()

  const botguard = await BG.BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObj: globalThis,
  })
  // bgutils fills this with signal functions; its exact type isn't re-exported cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webPoSignalOutput: any[] = []
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput })

  const itRes = await nativeFetch(
    'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    }
  )
  const [integrityToken] = (await itRes.json()) as [string]
  if (!integrityToken) throw new Error('PO Token: GenerateIT returned no token')

  const minter = await BG.WebPoMinter.create({ integrityToken }, webPoSignalOutput)
  const sessionPoToken = await minter.mintAsWebsafeString(visitorData)

  return {
    visitorData,
    sessionPoToken,
    mintContentBoundToken: (id: string) => minter.mintAsWebsafeString(id),
    createdAt: Date.now(),
  }
}

async function getPoTokenSession(): Promise<PoTokenSession> {
  if (!poSessionPromise || Date.now() - poSessionAt > PO_TOKEN_TTL_MS) {
    poSessionAt = Date.now()
    poSessionPromise = createPoTokenSession().catch((err) => {
      poSessionPromise = null
      throw err
    })
  }
  return poSessionPromise
}

const resolveCache = new Map<string, { data: DeviceResolvedStream; expiresAt: number }>()

/** Pre-build the BotGuard/InnerTube session so the first video isn't slow. */
export async function warmupWebviewResolver(): Promise<void> {
  try {
    await getPoTokenSession()
  } catch {
    /* best-effort */
  }
}

export async function resolveWebviewStream(
  videoId: string,
  quality = '360p'
): Promise<DeviceResolvedStream> {
  const id = String(videoId || '').trim()
  if (!/^[\w-]{11}$/.test(id)) throw new Error('Invalid YouTube video id')
  const q = String(quality || '360p').trim().toLowerCase()
  const minHeight = HEIGHT_BY_QUALITY[q] || 360

  const cacheKey = `${id}:${q}`
  const cached = resolveCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  if (cached) resolveCache.delete(cacheKey)

  const { Innertube, ClientType } = await import('youtubei.js')
  const po = await getPoTokenSession().catch(() => null)

  let lastErr: unknown = null
  for (const clientName of CLIENT_ORDER) {
    try {
      const yt = await Innertube.create({
        client_type: ClientType[clientName as keyof typeof ClientType] ?? ClientType.ANDROID,
        retrieve_player: false,
        fetch: nativeFetch,
        ...(po ? { visitor_data: po.visitorData, po_token: po.sessionPoToken } : {}),
      })

      const options: Record<string, unknown> = {
        client: ClientType[clientName as keyof typeof ClientType] ?? ClientType.ANDROID,
      }
      if (po) {
        try {
          options.po_token = await po.mintContentBoundToken(id)
        } catch {
          /* fall back to session token already set on create */
        }
      }

      const info = await yt.getBasicInfo(id, options)
      const status = info.playability_status?.status
      if (status && status !== 'OK') {
        throw new Error(info.playability_status?.reason || status)
      }

      const formats = [
        ...(info.streaming_data?.formats || []),
        ...(info.streaming_data?.adaptive_formats || []),
      ]
      const progressive = formats
        .filter((f) => f.has_video && f.has_audio)
        .sort((a, b) => (a.height || 0) - (b.height || 0))
      const chosen =
        progressive.find((f) => (f.height || 0) >= minHeight) ||
        progressive[progressive.length - 1] ||
        null
      if (!chosen) throw new Error(`No ${q} progressive format available`)

      let playbackUrl: string | undefined = chosen.url
      if (!playbackUrl && typeof chosen.decipher === 'function') {
        playbackUrl = await chosen.decipher(yt.session.player)
      }
      if (!playbackUrl) throw new Error('Stream format has no playable URL')

      const mime = chosen.mime_type || 'video/mp4'
      const isHls = /\.m3u8(\?|$)/i.test(playbackUrl) || /mpegurl/i.test(mime)
      if (!isHls && po?.sessionPoToken && !/[?&]pot=/i.test(playbackUrl)) {
        playbackUrl += `${playbackUrl.includes('?') ? '&' : '?'}pot=${encodeURIComponent(po.sessionPoToken)}`
      }

      const data: DeviceResolvedStream = {
        videoId: id,
        playbackUrl,
        mime,
        format: isHls ? 'hls' : 'direct',
        quality: chosen.quality_label || q,
      }
      resolveCache.set(cacheKey, { data, expiresAt: Date.now() + RESOLVE_TTL_MS })
      return data
    } catch (err) {
      lastErr = err
      console.warn(`[webviewResolver] ${clientName} failed for ${id}:`, err instanceof Error ? err.message : err)
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('On-device resolve failed')
}
