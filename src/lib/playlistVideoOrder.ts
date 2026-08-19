/** Move one item within an array (returns new array). */
export function movePlaylistVideo<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items
  if (fromIndex >= items.length || toIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item!)
  return next
}

export function playlistVideoIds(items: { youtube_video_id: string }[]): string[] {
  return items.map((v) => v.youtube_video_id)
}
