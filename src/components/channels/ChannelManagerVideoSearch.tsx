import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import { playlistVideoPayloadFromSearchResult } from '../../lib/playlistVideoPayload'
import type { YouTubeVideoResult } from '../../types'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
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

  const handleClose = useCallback(() => {
    setOpen(false)
    setInput('')
    setQuery(null)
    setResults([])
    setError(null)
    setLoading(false)
  }, [])

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
          חפשו ב-YouTube והוסיפו סרטונים לפלייליסט (Enter לחיפוש).
        </p>

        <div className={CHANNEL_MANAGER_SEARCH_SHELL_CLASS}>
          <input
            type="search"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void runSearch(input)
              }
            }}
            placeholder="הקלידו שם סרטון…"
            aria-label="חיפוש סרטונים ב-YouTube"
            disabled={loading}
            className={cn(
              CHANNEL_MANAGER_SEARCH_CONTROL_CLASS,
              'cursor-text border-0 text-right placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 disabled:cursor-wait disabled:opacity-80'
            )}
          />
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
      </Modal>
    </>
  )
}
