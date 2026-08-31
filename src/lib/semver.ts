/** Semver helpers for force-update comparisons (major.minor.patch). */

export function parseSemver(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null
  const m = String(raw)
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Negative if a < b, 0 if equal, positive if a > b. Null parts sort as older. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function isVersionOlder(current: string, target: string): boolean {
  return compareSemver(current, target) < 0
}
