/** Client-side title filter for approved channel video lists (instant, no API). */
export function filterVideosByTitle<T extends { title: string }>(videos: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return videos
  return videos.filter((v) => v.title.toLowerCase().includes(q))
}

/** Alias for channel browse UIs — filters the in-memory list by title substring. */
export function filterChannelVideos<T extends { title: string }>(videos: T[], searchTerm: string): T[] {
  return filterVideosByTitle(videos, searchTerm)
}
