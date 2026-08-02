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

async function bodyToData(body: BodyInit | null | undefined): Promise<unknown> {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return await body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  // ReadableStream / FormData / others — best-effort text via Response helper
  try {
    return await new Response(body).text()
  } catch {
    return undefined
  }
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

  const request = input instanceof Request ? input : null
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  const method = (
    init?.method ||
    request?.method ||
    'GET'
  ).toUpperCase()
  const headers = headersToObject(init?.headers ?? request?.headers)
  const data = await bodyToData(init?.body ?? (request ? await request.clone().text() : undefined))

  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data,
    responseType: 'text',
  })
  const bodyText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  // Preserve real HTTP status (including < 200). Only fall back when status is missing.
  const status = typeof res.status === 'number' && res.status > 0 ? res.status : 200
  return new Response(bodyText, {
    status,
    headers: (res.headers as Record<string, string>) || {},
  })
}
