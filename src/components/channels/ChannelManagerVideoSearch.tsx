import { useCallback, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import { playlistVideoPayloadFromSearchResult } from '../../lib/playlistVideoPayload'
import type { YouTubeVideoResult } from '../../types'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'
import {
  CHANNEL_MANAGER_SEARCH_INPUT_CLASS,
  CHANNEL_MANAGER_SEARCH_SHELL_CLASS,
  CHANNEL_MANAGER_SEARCH_CONTROL_CLASS,
  CHANNEL_MANAGER_SEARCH_SUBMIT_CLASS,
} from './channelManagerSearchStyles'

type Props = {
  userId: string | null
  childAccessToken?: string | null
  mode?: PlaylistMode
  className?: string
}

function filterValidSearchResults(data: YouTubeVideoResult[] | null | undefined): YouTubeVideoResult[] {
  return (data ?? []).filter((video) => playlistVideoPayloadFromSearchResult(video) !== null)
}

/**
 * Same outer control as "חיפוש ערוץ" — tap opens a modal to search YouTube and add to playlists.
 */
export function ChannelManagerVideoSearch({
  userId,
  childAccessToken = null,
  mode = 'parent',
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAddToPlaylist = Boolean(userId || childAccessToken)

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setLoadingMore(false)
    setError(null)
    setResults([])
    setContinuation(null)
    setHasMore(false)

    try {
      const { data, error: searchError, continuation: nextContinuation, hasMore: more } =
        await searchYouTubeVideos(q)
      if (searchError) {
        setError(searchError.message)
        setResults([])
        return
      }
      const valid = filterValidSearchResults(data)
      setResults(valid)
      setContinuation(nextContinuation)
      setHasMore(more)
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

  const loadMore = useCallback(async () => {
    const q = query?.trim()
    if (!q || !continuation || loadingMore || loading) return
    setLoadingMore(true)
    setError(null)

    try {
      const { data, error: searchError, continuation: nextContinuation, hasMore: more } =
        await searchYouTubeVideos(q, { continuation })
      if (searchError) {
        setError(searchError.message)
        return
      }
      const valid = filterValidSearchResults(data)
      setResults((prev) => {
        const seen = new Set(prev.map((v) => v.videoId))
        const next = valid.filter((v) => !seen.has(v.videoId))
        return [...prev, ...next]
      })
      setContinuation(nextContinuation)
      setHasMore(more)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'טעינת תוצאות נוספות נכשלה')
    } finally {
      setLoadingMore(false)
    }
  }, [query, continuation, loadingMore, loading])

  const handleClose = useCallback(() => {
    setOpen(false)
    setInput('')
    setQuery(null)
    setResults([])
    setContinuation(null)
    setHasMore(false)
    setError(null)
    setLoading(false)
    setLoadingMore(false)
  }, [])

  const submitSearch = useCallback(() => {
    void runSearch(input)
  }, [input, runSearch])

  return (
    <>
      <div className={cn('w-full', className)}>
        <div className={CHANNEL_MANAGER_SEARCH_SHELL_CLASS}>
          <Button
            type="button"
            className={CHANNEL_MANAGER_SEARCH_CONTROL_CLASS}
            onClick={() => setOpen(true)}
          >
            חיפוש סרטונים
          </Button>
        </div>
      </div>

      <Modal
        open={open}
        onClose={handleClose}
        title="חיפוש סרטונים"
        bodyClassName="max-h-[70vh] overflow-y-auto"
        footer={
          <Button type="button" variant="secondary" onClick={handleClose}>
            סגור
          </Button>
        }
      >
        <p className="mb-3 text-sm text-zinc-400">
          חפשו ב-YouTube והוסיפו סרטונים לפלייליסט (Enter או כפתור החיפוש).
        </p>

        <div className={CHANNEL_MANAGER_SEARCH_SHELL_CLASS}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="search"
              dir="auto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitSearch()
                }
              }}
              placeholder="הקלידו שם סרטון…"
              aria-label="חיפוש סרטונים ב-YouTube"
              disabled={loading}
              className={CHANNEL_MANAGER_SEARCH_INPUT_CLASS}
            />
            <button
              type="button"
              className={CHANNEL_MANAGER_SEARCH_SUBMIT_CLASS}
              onClick={submitSearch}
              disabled={loading || !input.trim()}
              aria-label="חפש סרטונים"
              title="חפש"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Search className="h-5 w-5" aria-hidden />
              )}
              <span>חפש</span>
            </button>
          </div>
        </div>

        {query || loading ? (
          <div className="mt-3 rounded-2xl border border-zinc-700/80 bg-zinc-950/70 p-3 ring-1 ring-zinc-800/80" aria-live="polite">
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
              <>
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
                {hasMore ? (
                  <div className="mt-3 flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                    >
                      {loadingMore ? (
                        <span className="inline-flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          טוען…
                        </span>
                      ) : (
                        'טען עוד'
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
