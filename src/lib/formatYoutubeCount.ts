/** Format public YouTube counters the way the official UI does (he-IL friendly). */

export function formatCompactCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return ''
  const abs = Math.floor(n)
  if (abs < 1000) return String(abs)
  if (abs < 1_000_000) {
    const k = abs / 1000
    const rounded = k >= 100 ? Math.round(k) : Math.round(k * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(/\.0$/, '')}K`
  }
  if (abs < 1_000_000_000) {
    const m = abs / 1_000_000
    const rounded = m >= 100 ? Math.round(m) : Math.round(m * 10) / 10
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(/\.0$/, '')}M`
  }
  const b = abs / 1_000_000_000
  const rounded = Math.round(b * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1).replace(/\.0$/, '')}B`
}

export function formatViewCountLabel(n: number | null | undefined): string {
  const compact = formatCompactCount(n)
  if (!compact) return ''
  return `${compact} צפיות`
}

export function formatLikeCountLabel(n: number | null | undefined): string {
  const compact = formatCompactCount(n)
  return compact || ''
}
