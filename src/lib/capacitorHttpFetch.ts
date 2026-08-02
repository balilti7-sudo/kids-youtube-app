/**
 * Capacitor-aware fetch: on native platforms routes through CapacitorHttp (no WebView CORS).
 * On the plain web, uses the browser's fetch unchanged.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) h.forEach((v, k) => { out[k] = v })
  else if (Array.isArray(h)) for (const [k, v] of h) out[k] = String(v)
  else for (const k of Object.keys(h)) out[k] = String((h as Record<string, unknown>)[k])
  return out
}

/**
 * Drop-in replacement for `fetch` that bypasses WebView CORS on Capacitor Android/iOS.
 * Returns a real `Response` so callers can use `.json()`, `.text()`, etc.
 */
export async function capacitorAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!Capacitor.isNativePlatform()) {
    return fetch(input, init)
  }

  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
  const headers = headersToObject(
    init?.headers || (input instanceof Request ? input.headers : undefined)
  )
  let data: unknown = init?.body
  if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data)
  else if (ArrayBuffer.isView(data)) data = new TextDecoder().decode(data as Uint8Array)

  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    responseType: 'text',
  })
  const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  const status = res.status && res.status >= 200 ? res.status : 200
  return new Response(bodyText, {
    status,
    headers: (res.headers as Record<string, string>) || {},
  })
}
