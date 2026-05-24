import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import type { YouTubeVideoResult } from '../../types'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { RtlSearchInput } from '../search/RtlSearchInput'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'

export function ParentSingleVideoSearchSection() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const userId = ownerUserId ?? user?.id ?? null

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      setResults([])
      setError(null)
      return
    }
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), 400)
    return () => window.clearTimeout(timer)
  }, [query])

  const runSearch = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    const { data, error: searchErr } = await searchYouTubeVideos(q)
    setLoading(false)
    if (searchErr) {
      setError(searchErr.message)
      setResults([])
      return
    }
    setResults(data ?? [])
  }, [])

  useEffect(() => {
    if (!debouncedQuery) return
    void runSearch(debouncedQuery)
  }, [debouncedQuery, runSearch])

  if (!userId) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
        <p className="text-sm text-slate-600 dark:text-zinc-400">התחברו כדי לחפש ולהוסיף סרטונים לפלייליסטים.</p>
      </section>
    )
  }

  return (
    <section
      className="rounded-2xl border border-yt-border bg-yt-surface/80 p-4 shadow-sm sm:p-5"
      aria-label="חיפוש והוספת סרטונים בודדים"
    >
      <header className="mb-4 text-right">
        <h2 className="text-base font-bold text-yt-text sm:text-lg">חיפוש והוספת סרטונים בודדים</h2>
        <p className="mt-1 text-xs text-yt-textMuted sm:text-sm">
          חפשו ב-YouTube והוסיפו סרטונים לפלייליסט של הילד — בלי לפתוח חיפוש כללי במצב ילד.
        </p>
      </header>

      <RtlSearchInput
        id="parent-single-video-search"
        value={query}
        onChange={setQuery}
        placeholder="חפשו סרטון ב-YouTube…"
        aria-label="חיפוש סרטונים ב-YouTube"
      />

      <div className="mt-4" aria-live="polite">
        {!query.trim() ? (
          <p className="text-sm text-yt-textMuted">הקלידו מילות חיפוש כדי למצוא סרטונים.</p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-yt-textMuted">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            מחפש ב-YouTube…
          </div>
        ) : error ? (
          <p className="text-sm text-yt-red">{error}</p>
        ) : results.length === 0 && debouncedQuery ? (
          <p className="text-sm text-yt-textMuted">
            לא נמצאו סרטונים עבור &quot;{debouncedQuery}&quot;
          </p>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((video) => (
              <article key={video.videoId} className="flex flex-col">
                <YoutubeVideoCard
                  layout="grid"
                  title={video.title}
                  thumbnail={video.thumbnail}
                  channelName={video.channelTitle}
                  actionSlot={
                    <AddToPlaylistButton
                      mode="parent"
                      userId={userId}
                      childAccessToken={null}
                      video={{
                        youtube_video_id: video.videoId,
                        title: video.title,
                        thumbnail_url: video.thumbnail,
                        channel_name: video.channelTitle || null,
                      }}
                    />
                  }
                />
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
