import { useCallback, useState, type FormEvent } from 'react'
import { Loader2, Search, Video } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import type { PlaylistVideoPayload } from '../../lib/playlists'
import type { YouTubeVideoResult } from '../../types'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'

type Props = {
  userId: string | null
  className?: string
}

/** Matches the full-width "חיפוש ערוץ" control in ChannelManager header. */
const CHANNEL_SEARCH_SHELL_CLASS =
  'rounded-2xl border border-zinc-700/80 bg-zinc-950/70 p-3 shadow-inner ring-1 ring-zinc-800/80'

const CHANNEL_SEARCH_CONTROL_CLASS =
  'min-h-[52px] w-full rounded-2xl bg-zinc-800 text-base font-black tracking-tight text-zinc-50 shadow-lg shadow-black/25 ring-1 ring-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400'

function isValidYoutubeVideoId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[\w-]{11}$/.test(value.trim())
}

function toPlaylistVideoPayload(video: YouTubeVideoResult): PlaylistVideoPayload | null {
  if (!isValidYoutubeVideoId(video.videoId)) return null
  const youtube_video_id = video.videoId.trim()
  return {
    youtube_video_id,
    title: video.title?.trim() || youtube_video_id,
    thumbnail_url: video.thumbnail?.trim() || null,
    channel_name: video.channelTitle?.trim() || null,
  }
}

/**
 * Search YouTube from channel management and add results to a parent playlist.
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
      const valid = (data ?? []).filter((video) => toPlaylistVideoPayload(video) !== null)
      setResults(valid)
      if (valid.length === 0 && (data?.length ?? 0) > 0) {
        setError('לא נמצאו מזהי סרטון תקינים בתוצאות החיפוש')
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
    <section className={cn('w-full', className)} aria-labelledby="channel-manager-video-search-title">
      <div className="mb-2 flex items-start gap-2">
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
            חפשו ב-YouTube והוסיפו סרטונים בודדים לפלייליסט.
          </p>
        </div>
      </div>

      <div className={CHANNEL_SEARCH_SHELL_CLASS}>
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              type="search"
              dir="auto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="חפשו סרטון ב-YouTube…"
              aria-label="חיפוש סרטונים"
              className={cn(
                CHANNEL_SEARCH_CONTROL_CLASS,
                'py-3 pe-4 ps-12 text-right placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 hover:bg-zinc-700'
              )}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className={cn(
              CHANNEL_SEARCH_CONTROL_CLASS,
              'flex shrink-0 items-center justify-center gap-2 px-6 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[7.5rem]'
            )}
          >
            {loading ? (
              <LoadingSpinner className="h-5 w-5 border-2 border-zinc-300 border-t-transparent" />
            ) : (
              <Search className="h-5 w-5" aria-hidden />
            )}
            חפש
          </button>
        </form>
      </div>

      {showResultsPanel ? (
        <div
          className="mt-2 rounded-2xl border border-zinc-700/80 bg-zinc-950/70 p-3 shadow-inner ring-1 ring-zinc-800/80"
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
            <div className="flex min-h-[52px] items-center justify-center gap-2 py-4 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              מחפש ב-YouTube…
            </div>
          ) : error ? (
            <p className="py-2 text-sm text-red-300">{error}</p>
          ) : results.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">לא נמצאו סרטונים.</p>
          ) : (
            <ul className="premium-scrollbar max-h-80 space-y-2 overflow-y-auto">
              {results.map((video) => {
                const payload = toPlaylistVideoPayload(video)
                if (!payload) return null
                return (
                  <li
                    key={payload.youtube_video_id}
                    className="flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-zinc-900/80 p-2.5 sm:flex-row sm:items-center"
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
                    <AddToPlaylistButton
                      mode="parent"
                      userId={userId}
                      childAccessToken={null}
                      video={payload}
                      className="w-full sm:w-auto"
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
