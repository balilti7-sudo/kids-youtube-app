import { normalizeWhitelistHost } from './parentalControlNative'

/** Whether a hostname is on the parent-approved browser whitelist. */
export function isHostWhitelisted(host: string, whitelist: string[]): boolean {
  const normalized = normalizeWhitelistHost(host)
  if (!normalized) return false
  const allowed = whitelist.map(normalizeWhitelistHost).filter(Boolean)
  if (allowed.includes(normalized)) return true
  // Allow subdomains of whitelisted registrable domains (e.g. www.example.com when example.com is listed).
  return allowed.some((entry) => normalized === entry || normalized.endsWith('.' + entry))
}

/** Build a safe https URL for an approved host (path optional, must stay on same host). */
export function buildSafeBrowserUrl(host: string, path = '/'): string | null {
  const normalized = normalizeWhitelistHost(host)
  if (!normalized) return null
  let safePath = path.startsWith('/') ? path : `/${path}`
  if (safePath.includes('://') || safePath.includes('..')) return `https://${normalized}/`
  return `https://${normalized}${safePath}`
}

export function hostFromSafeBrowserUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return normalizeWhitelistHost(parsed.hostname)
  } catch {
    return null
  }
}

/** Validate navigation target before loading it in the in-app browser iframe. */
export function validateSafeBrowserNavigation(url: string, whitelist: string[]): boolean {
  const host = hostFromSafeBrowserUrl(url)
  if (!host) return false
  return isHostWhitelisted(host, whitelist)
}
