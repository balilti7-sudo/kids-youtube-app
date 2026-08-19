/**
 * Capacitor-aware fetch: on native platforms routes through CapacitorHttp (no WebView CORS).
 * On the plain web, uses the browser's fetch unchanged.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'

/** Fetch forbids a body for these statuses (throws if body is non-null). */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

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
  try {
    return await new Response(body).text()
  } catch {
    return undefined
  }
}

function normalizeResponseBody(data: unknown): string {
  if (data == null) return ''
  if (typeof data === 'string') return data
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

/**
 * Cloudflare edge statuses meaning "the request never reached the origin server"
 * (Supabase and the Render bridge both sit behind Cloudflare). Safe to retry for
 * any method — no side effects could have happened. 502/504 are retried for
 * GET/HEAD only (the origin may have started processing the request).
 */
const RETRY_ANY_METHOD_STATUSES = new Set([522, 523])
const RETRY_IDEMPOTENT_STATUSES = new Set([502, 504])
const TRANSIENT_MAX_RETRIES = 2
const TRANSIENT_RETRY_DELAY_MS = 900

function isTransientEdgeStatus(status: number, method: string): boolean {
  if (RETRY_ANY_METHOD_STATUSES.has(status)) return true
  if (RETRY_IDEMPOTENT_STATUSES.has(status) && (method === 'GET' || method === 'HEAD')) return true
  return false
}

function isTransientConnectionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return (
    msg.includes('failed to connect') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('unable to resolve host') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('connection reset') ||
    msg.includes('socket')
  )
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type HttpRequestOptions = {
  url: string
  method: string
  headers: Record<string, string>
  data: unknown
}

async function capacitorHttpRequestWithRetries(
  opts: HttpRequestOptions,
  method: string
): Promise<Awaited<ReturnType<typeof CapacitorHttp.request>>> {
  let lastError: unknown

  for (let attempt = 0; attempt <= TRANSIENT_MAX_RETRIES; attempt++) {
    try {
      let res = await CapacitorHttp.request({
        url: opts.url,
        method: opts.method,
        headers: opts.headers,
        data: opts.data,
        responseType: 'text',
      })

      for (
        let edgeAttempt = 0;
        edgeAttempt < TRANSIENT_MAX_RETRIES &&
        typeof res.status === 'number' &&
        isTransientEdgeStatus(res.status, method);
        edgeAttempt++
      ) {
        console.warn(
          `[capacitorAwareFetch] transient ${res.status} from edge — retry ${edgeAttempt + 1}/${TRANSIENT_MAX_RETRIES}`,
          opts.url
        )
        await sleep(TRANSIENT_RETRY_DELAY_MS * (edgeAttempt + 1))
        res = await CapacitorHttp.request({
          url: opts.url,
          method: opts.method,
          headers: opts.headers,
          data: opts.data,
          responseType: 'text',
        })
      }

      return res
    } catch (err) {
      lastError = err
      if (attempt < TRANSIENT_MAX_RETRIES && isTransientConnectionError(err)) {
        console.warn(
          `[capacitorAwareFetch] connection error — retry ${attempt + 1}/${TRANSIENT_MAX_RETRIES}`,
          opts.url,
          err
        )
        await sleep(TRANSIENT_RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      throw err
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function webFetchWithRetries(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  let lastError: unknown

  for (let attempt = 0; attempt <= TRANSIENT_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(input, init)
      if (
        attempt < TRANSIENT_MAX_RETRIES &&
        isTransientEdgeStatus(res.status, method)
      ) {
        console.warn(`[capacitorAwareFetch] web transient ${res.status} — retry ${attempt + 1}`)
        await sleep(TRANSIENT_RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < TRANSIENT_MAX_RETRIES && isTransientConnectionError(err)) {
        console.warn(`[capacitorAwareFetch] web connection error — retry ${attempt + 1}`)
        await sleep(TRANSIENT_RETRY_DELAY_MS * (attempt + 1))
        continue
      }
      throw err
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
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
    return webFetchWithRetries(input, init)
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

  const res = await capacitorHttpRequestWithRetries({ url, method, headers, data }, method)

  const status = typeof res.status === 'number' && res.status > 0 ? res.status : 200
  const responseHeaders = (res.headers as Record<string, string>) || {}

  if (NULL_BODY_STATUSES.has(status)) {
    return new Response(null, {
      status,
      headers: responseHeaders,
    })
  }

  const bodyText = normalizeResponseBody(res.data)
  return new Response(bodyText, {
    status,
    headers: responseHeaders,
  })
}
