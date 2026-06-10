import { useCallback, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import { playlistVideoPayloadFromSearchResult } from '../../lib/playlistVideoPayload'
import type { YouTubeVideoResult } from '../../types'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import {
  CHANNEL_MANAGER_SEARCH_CONTROL_CLASS,
  CHANNEL_MANAGER_SEARCH_SHELL_CLASS,
} from './channelManagerSearchStyles'

type Props = {
  userId: string | null
  childAccessToken?: string | null
  mode?: PlaylistMode
  className?: string
}

/**
 * YouTube video search from channel management — same shell/control styling as "חיפוש ערוץ".
 */
export function ChannelManagerVideoSearch({
  userId,
  childAccessToken = null,
  mode = 'parent',
  className,
}: Props) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAddToPlaylist = Boolean(userId || childAccessToken)

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
      const valid = (data ?? []).filter((video) => playlistVideoPayloadFromSearchResult(video) !== null)
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

  const showResultsPanel = Boolean(query || loading)

  return (
    <section className={cn('w-full', className)} aria-label="חיפוש סרטונים">
      <div className={CHANNEL_MANAGER_SEARCH_SHELL_CLASS}>
        <form onSubmit={handleSubmit} className="relative w-full">
          <input
            type="search"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="חיפוש סרטונים…"
            aria-label="חיפוש סרטונים"
            disabled={loading}
            className={cn(
              CHANNEL_MANAGER_SEARCH_CONTROL_CLASS,
              'border-0 placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 disabled:cursor-wait disabled:opacity-80'
            )}
          />
          {loading ? (
            <span className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2">
              <LoadingSpinner className="h-5 w-5 border-2 border-zinc-300 border-t-transparent" />
            </span>
          ) : null}
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
            <div className={cn(CHANNEL_MANAGER_SEARCH_CONTROL_CLASS, 'flex items-center justify-center gap-2 bg-zinc-900/80 py-3 text-sm font-normal text-zinc-400')}>
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
                const payload = playlistVideoPayloadFromSearchResult(video)
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
                    {canAddToPlaylist ? (
                      <AddToPlaylistButton
                        mode={mode}
                        userId={userId}
                        childAccessToken={childAccessToken}
                        compact
                        video={payload}
                        className="w-full sm:w-auto"
                      />
                    ) : null}
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
