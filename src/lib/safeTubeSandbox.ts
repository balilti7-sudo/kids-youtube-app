/**
 * SafeTube sandbox — block navigation that would leave the app for YouTube / external sites.
 * Playback still uses the YouTube embed iframe on Android; this guards the app shell only.
 */

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw, typeof window !== 'undefined' ? window.location.href : 'https://localhost/')
  } catch {
    return null
  }
}

function isYoutubeHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'youtu.be' || h.endsWith('.youtube.com') || h === 'youtube.com'
}

/** True when the URL would open YouTube watch/channel UI outside our embed player. */
export function isBlockedExternalNavigation(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false

  if (/^intent:/i.test(trimmed) || /^vnd\.youtube:/i.test(trimmed)) return true

  const url = parseUrl(trimmed)
  if (!url) return false

  const protocol = url.protocol.replace(':', '').toLowerCase()
  if (protocol !== 'http' && protocol !== 'https') {
    return protocol !== 'capacitor' && protocol !== 'file'
  }

  const host = url.hostname.toLowerCase()
  if (!isYoutubeHost(host)) return false

  const path = url.pathname.toLowerCase()
  // Sub-resource loads for the embed player are not top-level navigation targets.
  if (path.startsWith('/embed/') || path.startsWith('/iframe_api')) return false

  return true
}

/** Allow only in-app routes and non-YouTube external links opened deliberately by parents. */
export function isSafeInAppHref(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('#')) return true
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true
  if (/^mailto:/i.test(trimmed) || /^tel:/i.test(trimmed)) return true

  const url = parseUrl(trimmed)
  if (!url) return true

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  if (origin && url.origin === origin) return true

  return !isBlockedExternalNavigation(trimmed)
}

declare global {
  interface Window {
    __safetubeSandboxInstalled?: boolean
  }
}

/** Install once at boot — blocks `<a href>` and `window.open` to YouTube watch/channel pages. */
export function installSafeTubeSandboxGuards(): void {
  if (typeof window === 'undefined' || window.__safetubeSandboxInstalled) return
  window.__safetubeSandboxInstalled = true

  const originalOpen = window.open.bind(window)
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = typeof url === 'string' ? url : url?.toString?.() ?? ''
    if (href && isBlockedExternalNavigation(href)) {
      console.warn('[SafeTube] blocked window.open →', href)
      return null
    }
    return originalOpen(url, target, features)
  }) as typeof window.open

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href || isSafeInAppHref(href)) return
      event.preventDefault()
      event.stopPropagation()
      console.warn('[SafeTube] blocked link →', href)
    },
    true
  )
}
