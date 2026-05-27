/** Fisher–Yates shuffle (in-place copy). */
export function shuffleInPlace<T>(items: T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

/** Round-robin across channels, then shuffle tail for endless-discovery variety. */
export function buildDiverseVideoMix<T extends { channelId: string }>(videos: T[]): T[] {
  if (videos.length <= 1) return [...videos]

  const buckets = new Map<string, T[]>()
  for (const video of videos) {
    const bucket = buckets.get(video.channelId) ?? []
    bucket.push(video)
    buckets.set(video.channelId, bucket)
  }
  for (const bucket of buckets.values()) {
    shuffleInPlace(bucket)
  }

  const channelIds = shuffleInPlace(Array.from(buckets.keys()))
  const mixed: T[] = []
  let added = true
  while (added) {
    added = false
    for (const channelId of channelIds) {
      const bucket = buckets.get(channelId)
      if (!bucket?.length) continue
      const next = bucket.shift()
      if (next) {
        mixed.push(next)
        added = true
      }
    }
  }

  return shuffleInPlace(mixed)
}

type FormatTagged = { format: 'short' | 'long' }

/**
 * Recommendation queue: when watching a Short, surface other Shorts first; otherwise diverse long-form mix.
 */
export function buildWatchRecommendationQueue<T extends FormatTagged & { channelId: string }>(
  videos: T[],
  activeIsShort: boolean
): T[] {
  const shorts = videos.filter((v) => v.format === 'short')
  const longForm = videos.filter((v) => v.format === 'long')

  if (activeIsShort) {
    const shortMix = shuffleInPlace([...shorts])
    const longTail = buildDiverseVideoMix(longForm) as T[]
    return [...shortMix, ...longTail]
  }

  const longMix = buildDiverseVideoMix(longForm) as T[]
  const shortTail = shuffleInPlace([...shorts])
  return [...longMix, ...shortTail]
}
