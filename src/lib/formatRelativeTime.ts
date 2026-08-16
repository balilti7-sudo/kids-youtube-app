import i18n from '../i18n'

/** Map app language codes to BCP 47 locales for Intl.RelativeTimeFormat. */
function resolveRelativeLocale(locale?: string): string {
  const raw = (locale || i18n.language || 'he').trim().toLowerCase()
  const base = raw.split('-')[0] || 'he'
  if (base === 'en') return 'en'
  if (base === 'es') return 'es'
  if (base === 'ru') return 'ru'
  return 'he'
}

function parsePublishedDate(publishedAt: string | Date | null | undefined): Date | null {
  if (!publishedAt) return null
  const date = typeof publishedAt === 'string' ? new Date(publishedAt) : publishedAt
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  return date
}

/**
 * YouTube-style relative publish time ("1 month ago" / "לפני חודש").
 * Uses approximate month=30d and year=365d buckets like the YouTube client.
 */
export function formatRelativePublishedAt(
  publishedAt: string | Date | null | undefined,
  locale?: string
): string {
  const date = parsePublishedDate(publishedAt)
  if (!date) return ''

  const diffMs = date.getTime() - Date.now()
  const diffSec = Math.round(diffMs / 1000)
  const absSec = Math.abs(diffSec)
  const rtf = new Intl.RelativeTimeFormat(resolveRelativeLocale(locale), { numeric: 'always' })

  if (absSec < 60) return rtf.format(diffSec < 0 ? -Math.max(1, absSec) : Math.max(1, absSec), 'second')
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (absSec < 86_400 * 7) return rtf.format(Math.round(diffSec / 86_400), 'day')
  if (absSec < 86_400 * 30) return rtf.format(Math.round(diffSec / (86_400 * 7)), 'week')
  if (absSec < 86_400 * 365) return rtf.format(Math.round(diffSec / (86_400 * 30)), 'month')
  return rtf.format(Math.round(diffSec / (86_400 * 365)), 'year')
}

/** Join YouTube card meta fragments with a middle-dot separator. */
export function joinVideoMetadataParts(
  ...parts: Array<string | null | undefined>
): string | null {
  const filtered = parts.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean)
  return filtered.length > 0 ? filtered.join(' · ') : null
}
