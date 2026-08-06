/**
 * Network security helpers — prefer HTTPS for remote origins; allow http only for localhost.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]'])

export function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  return LOCAL_HOSTS.has(h) || h.endsWith('.local')
}

/** True when the URL is https, or http to a local development host. */
export function isAllowedAppUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && isLocalHostname(u.hostname)) return true
    return false
  } catch {
    return false
  }
}

/**
 * Upgrade remote http:// URLs to https://. Localhost left unchanged.
 * Use when constructing Media Bridge / API base URLs in production.
 */
export function enforceHttpsUrl(urlString: string): string {
  try {
    const u = new URL(urlString)
    if (u.protocol === 'http:' && !isLocalHostname(u.hostname)) {
      u.protocol = 'https:'
      return u.toString().replace(/\/$/, '')
    }
    return urlString.replace(/\/$/, '')
  } catch {
    return urlString
  }
}
