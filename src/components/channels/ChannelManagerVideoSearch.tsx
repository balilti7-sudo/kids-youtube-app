import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, Search, Video } from 'lucide-react'
import { normalizeYouTubeVideoSearchResults, searchYouTubeVideos } from '../../lib/youtube'
import type { YouTubeVideoResult } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { AddToActivePlaylistButton } from '../playlists/AddToActivePlaylistButton'

type Props = {
  userId: string | null
  className?: string
}

/**
 * Search YouTube from channel management and add results to the parent's active playlist.
 */
export function ChannelManagerVideoSearch({ userId, className }: Props) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setError(null)
    setResults([])

    try {
      const { data, error: searchError } = await searchYouTubeVideos(q)
      if (searchError) {
        setError(searchError.message)
        setResults([])
        return
      }
      const normalized = normalizeYouTubeVideoSearchResults(data ?? [])
      setResults(normalized)
      if (normalized.length === 0) {
        setError(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'חיפוש נכשל')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      void runSearch(input)
    },
    [input, runSearch]
  )

  if (!userId) {
    return null
  }

  const showResultsPanel = Boolean(query || loading)

  return (
    <section
      className={cn(
        'rounded-xl border border-zinc-700/80 bg-zinc-950/60 p-3 ring-1 ring-zinc-800/80',
        className
      )}
      aria-labelledby="channel-manager-video-search-title"
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25"
          aria-hidden
        >
          <Video className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 text-right">
          <h2 id="channel-manager-video-search-title" className="text-sm font-bold text-zinc-50">
            חיפוש סרטונים
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            חפשו ב-YouTube והוסיפו סרטונים בודדים לפלייליסט הפעיל. פתחו פלייליסט בלשונית &quot;פלייליסטים&quot; לפני
            ההוספה.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <input
            type="search"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="חפשו סרטון ב-YouTube…"
            aria-label="חיפוש סרטונים"
            className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2 pe-3 ps-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
        </div>
        <Button
          type="submit"
          className="h-10 shrink-0 justify-center gap-2 rounded-xl !px-4"
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <LoadingSpinner className="h-4 w-4 border-2 border-white border-t-transparent" />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          חפש
        </Button>
      </form>

      {showResultsPanel ? (
        <div
          className="mt-3 rounded-xl border border-zinc-800/90 bg-zinc-900/80 p-3 ring-1 ring-zinc-800/50"
          aria-live="polite"
          aria-label="תוצאות חיפוש סרטונים"
        >
          {query ? (
            <p className="mb-2 text-xs font-medium text-zinc-400">
              תוצאות עבור: <span className="text-zinc-100">&quot;{query}&quot;</span>
              {!loading && !error ? (
                <span className="ms-2 text-zinc-500">({results.length})</span>
              ) : null}
            </p>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              מחפש ב-YouTube…
            </div>
          ) : error ? (
            <p className="py-2 text-sm text-red-300">{error}</p>
          ) : results.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">לא נמצאו סרטונים.</p>
          ) : (
            <ul className="premium-scrollbar max-h-80 space-y-2 overflow-y-auto">
              {results.map((video, index) => (
                <li
                  key={video.videoId || `search-result-${index}`}
                  className="flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-zinc-950/80 p-2.5 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 gap-2.5">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt=""
                        className="h-14 w-24 shrink-0 rounded-lg bg-zinc-800 object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-14 w-24 shrink-0 rounded-lg bg-zinc-800" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1 text-right">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">
                        {video.title}
                      </p>
                      {video.channelTitle ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{video.channelTitle}</p>
                      ) : null}
                    </div>
                  </div>
                  <AddToActivePlaylistButton
                    userId={userId}
                    compact
                    className="w-full sm:w-auto"
                    video={{
                      youtube_video_id: video.videoId,
                      title: video.title,
                      thumbnail_url: video.thumbnail,
                      channel_name: video.channelTitle || null,
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
