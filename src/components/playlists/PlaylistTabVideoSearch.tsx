import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { ChevronUp, Loader2, Play, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchYouTubeVideos } from '../../lib/youtube'
import { buildYoutubePrivacyEmbedUrl } from '../../lib/youtubeEmbedUrl'
import { playlistVideoPayloadFromSearchResult } from '../../lib/playlistVideoPayload'
import type { YouTubeVideoResult } from '../../types'
import type { PlaylistVideoPayload, UserPlaylist } from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { useVideoMultiSelect } from '../../hooks/useVideoMultiSelect'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { AddToPlaylistButton } from './AddToPlaylistButton'
import { AddToPlaylistModal } from './AddToPlaylistModal'
import {
  PlaylistMultiSelectToolbar,
  PlaylistSelectCheckbox,
} from './PlaylistMultiSelectToolbar'
import { VoiceMicButton } from '../search/VoiceMicButton'

type Props = {
  userId: string | null
  childAccessToken?: string | null
  mode?: PlaylistMode
  initialPlaylists?: UserPlaylist[]
  className?: string
  /** Open search UI immediately — no extra tap. */
  defaultExpanded?: boolean
  /**
   * Hint which playlist folder to pre-check in the picker.
   * Never auto-adds — user always chooses folder(s) in the modal.
   */
  preferredPlaylistId?: string | null
  preferredPlaylistName?: string | null
  /** @deprecated use preferredPlaylistId — kept so callers keep compiling */
  targetPlaylistId?: string | null
  targetPlaylistName?: string | null
}

function filterValidSearchResults(data: YouTubeVideoResult[] | null | undefined): YouTubeVideoResult[] {
  return (data ?? []).filter((video) => playlistVideoPayloadFromSearchResult(video) !== null)
}

/**
 * YouTube video search for SafeTube playlists — preview, multi-select, pick folder before add.
 */
export function PlaylistTabVideoSearch({
  userId,
  childAccessToken = null,
  mode = 'kid',
  initialPlaylists,
  className,
  defaultExpanded = false,
  preferredPlaylistId = null,
  preferredPlaylistName = null,
  targetPlaylistId = null,
  targetPlaylistName = null,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [continuation, setContinuation] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null)
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const multiSelect = useVideoMultiSelect()
  const { exitSelectionMode, selectMany, enterSelectionMode, clear, toggle, isSelected, selectionMode, selectedCount, selectedVideos } =
    multiSelect

  const canAdd = Boolean(userId || childAccessToken)
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined
  const hintPlaylistId = preferredPlaylistId ?? targetPlaylistId
  const hintPlaylistName = preferredPlaylistName ?? targetPlaylistName

  const resultPayloads = useMemo(() => {
    const list: PlaylistVideoPayload[] = []
    for (const video of results) {
      const payload = playlistVideoPayloadFromSearchResult(video)
      if (payload) list.push(payload)
    }
    return list
  }, [results])

  const previewVideo = useMemo(
    () => results.find((v) => v.videoId === previewVideoId) ?? null,
    [results, previewVideoId]
  )

  const previewSrc = useMemo(() => {
    if (!previewVideoId) return ''
    return buildYoutubePrivacyEmbedUrl(previewVideoId, {
      origin,
      autoplay: true,
      host:
        Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
          ? 'youtube'
          : 'nocookie',
    })
  }, [previewVideoId, origin])

  useEffect(() => {
    if (!expanded) return
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 120)
    return () => window.clearTimeout(timer)
  }, [expanded])

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (!q) return
      setExpanded(true)
      setQuery(q)
      setLoading(true)
      setLoadingMore(false)
      setError(null)
      setResults([])
      setContinuation(null)
      setHasMore(false)
      setPreviewVideoId(null)
      exitSelectionMode()
      setBulkPlaylistOpen(false)

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
        if (valid.length > 0) {
          setPreviewVideoId(valid[0]!.videoId)
        }
        if (valid.length === 0 && (data?.length ?? 0) > 0) {
          setError(t('playlists.searchFailed'))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('playlists.searchFailed'))
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [t, exitSelectionMode]
  )

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
      setError(e instanceof Error ? e.message : t('playlists.searchFailed'))
    } finally {
      setLoadingMore(false)
    }
  }, [query, continuation, loadingMore, loading, t])

  const collapseSearch = useCallback(() => {
    setExpanded(false)
    setPreviewVideoId(null)
    exitSelectionMode()
    setBulkPlaylistOpen(false)
  }, [exitSelectionMode])

  if (!canAdd) return null

  return (
    <section
      className={cn('rounded-2xl border border-yt-border bg-yt-surface/80 p-3', className)}
      aria-label={t('playlists.searchVideos')}
    >
      {!expanded ? (
        <Button
          type="button"
          className="min-h-12 w-full justify-center gap-2 rounded-xl text-sm font-bold"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
        >
          <Search className="h-5 w-5" aria-hidden />
          {t('playlists.searchVideos')}
          {hintPlaylistName ? (
            <span className="font-medium text-white/80">· {hintPlaylistName}</span>
          ) : null}
        </Button>
      ) : (
        <>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-yt-text">
              {t('playlists.searchVideos')}
              {hintPlaylistName ? (
                <span className="ms-1.5 font-medium text-yt-textMuted">→ {hintPlaylistName}</span>
              ) : null}
            </h3>
            <Button
              type="button"
              variant="secondary"
              className="!min-h-9 shrink-0 rounded-full !px-3 text-xs font-bold"
              onClick={collapseSearch}
              aria-expanded
            >
              <ChevronUp className="h-4 w-4" aria-hidden />
              {t('common.close')}
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <input
              ref={searchInputRef}
              type="search"
              dir="auto"
              enterKeyHint="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runSearch(input)
                }
              }}
              placeholder={t('playlists.searchPlaceholder')}
              aria-label={t('playlists.searchVideos')}
              className="min-h-12 flex-1 rounded-xl border border-yt-border bg-yt-surfaceHover px-3 text-base text-yt-text placeholder:text-yt-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            />
            <VoiceMicButton
              onResult={(spoken) => {
                setInput(spoken)
                void runSearch(spoken)
              }}
              className="h-12 w-12 shrink-0 self-end bg-yt-surfaceHover text-yt-text hover:bg-yt-surface sm:self-auto"
              ariaLabel={t('voice.searchAria')}
            />
            <button
              type="button"
              className="inline-flex min-h-12 min-w-[5.5rem] items-center justify-center gap-2 rounded-xl bg-yt-red px-5 text-base font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
              onClick={() => void runSearch(input)}
              disabled={loading || !input.trim()}
              aria-busy={loading}
              aria-label={t('common.search')}
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Search className="h-5 w-5" aria-hidden />
              )}
              <span>{t('common.search')}</span>
            </button>
          </div>

          {previewSrc ? (
            <div
              className="mt-3 overflow-hidden rounded-xl border border-yt-border bg-black"
              role="region"
              aria-label={t('common.show')}
            >
              {previewVideo?.title ? (
                <p className="line-clamp-2 border-b border-yt-border/60 bg-yt-surface/90 px-3 py-2 text-sm font-semibold text-yt-text">
                  {previewVideo.title}
                </p>
              ) : null}
              <div className="aspect-video w-full">
                <iframe
                  key={previewSrc}
                  title={previewVideo?.title ?? t('common.show')}
                  src={previewSrc}
                  className="h-full w-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          ) : null}

          {query || loading ? (
            <div className="mt-3 rounded-xl border border-yt-border/80 bg-yt-surfaceHover/40 p-2.5" aria-live="polite">
              {query ? (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-yt-textMuted">
                    תוצאות: <span className="text-yt-text">&quot;{query}&quot;</span>
                    {!loading && !error ? <span className="ms-2">({results.length})</span> : null}
                  </p>
                  {!loading && results.length > 0 ? (
                    <PlaylistMultiSelectToolbar
                      compact
                      itemNoun="שירים"
                      enterLabel="בחירה מרובה"
                      addButtonLabel="הוסף נבחרים לפלייליסט"
                      selectionMode={selectionMode}
                      selectedCount={selectedCount}
                      totalVisible={resultPayloads.length}
                      onEnterSelectionMode={enterSelectionMode}
                      onExitSelectionMode={exitSelectionMode}
                      onClearSelection={clear}
                      onSelectAllVisible={() => selectMany(resultPayloads)}
                      onAddToPlaylist={() => setBulkPlaylistOpen(true)}
                    />
                  ) : null}
                </div>
              ) : null}

              {loading ? (
                <div className="flex min-h-[52px] items-center justify-center gap-2 py-4 text-sm text-yt-textMuted">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  מחפש…
                </div>
              ) : error ? (
                <p className="py-2 text-sm text-red-300" role="alert">
                  {error}
                </p>
              ) : results.length === 0 ? (
                <p className="py-2 text-sm text-yt-textMuted">לא נמצאו סרטונים.</p>
              ) : (
                <ul className="premium-scrollbar max-h-[min(24rem,55svh)] space-y-2 overflow-y-auto" role="list">
                  {results.map((video) => {
                    const payload = playlistVideoPayloadFromSearchResult(video)
                    if (!payload) return null
                    const isPreview = previewVideoId === payload.youtube_video_id
                    const selected = isSelected(payload.youtube_video_id)
                    return (
                      <li
                        key={payload.youtube_video_id}
                        className={cn(
                          'flex flex-col gap-2 rounded-xl border p-2.5 sm:flex-row sm:items-center',
                          selectionMode && selected
                            ? 'border-brand-500/50 bg-brand-500/10 ring-1 ring-brand-500/25'
                            : isPreview
                              ? 'border-sky-400/50 bg-sky-500/10 ring-1 ring-sky-400/30'
                              : 'border-yt-border bg-yt-surface'
                        )}
                      >
                        {selectionMode ? (
                          <PlaylistSelectCheckbox
                            checked={selected}
                            onChange={() => toggle(payload)}
                            label={selected ? `הסר את ${video.title} מהבחירה` : `בחר את ${video.title}`}
                          />
                        ) : null}
                        <button
                          type="button"
                          className="flex min-h-12 min-w-0 flex-1 gap-3 text-right"
                          aria-pressed={selectionMode ? selected : isPreview}
                          aria-label={video.title}
                          onClick={() => {
                            if (selectionMode) {
                              toggle(payload)
                              return
                            }
                            setPreviewVideoId(payload.youtube_video_id)
                          }}
                        >
                          {video.thumbnail ? (
                            <span className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-yt-surfaceHover">
                              <img
                                src={video.thumbnail}
                                alt=""
                                className="h-full w-full object-cover"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                              {isPreview && !selectionMode ? (
                                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                                  <Play className="h-6 w-6 fill-current" aria-hidden />
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-yt-surfaceHover text-yt-textMuted">
                              <Play className="h-6 w-6" aria-hidden />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 text-right">
                            <span className="line-clamp-2 block text-sm font-semibold leading-snug text-yt-text">
                              {video.title}
                            </span>
                            {video.channelTitle ? (
                              <span className="mt-0.5 block truncate text-xs text-yt-textMuted">
                                {video.channelTitle}
                              </span>
                            ) : null}
                          </span>
                        </button>

                        {!selectionMode ? (
                          <AddToPlaylistButton
                            mode={mode}
                            userId={userId}
                            childAccessToken={childAccessToken}
                            initialPlaylists={initialPlaylists}
                            preferredPlaylistId={hintPlaylistId}
                            compact={false}
                            video={payload}
                            className="w-full shrink-0 justify-center sm:w-auto"
                          />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}

              {hasMore && results.length > 0 ? (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11 w-full rounded-full text-sm font-bold"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    aria-busy={loadingMore}
                  >
                    {loadingMore ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {t('common.loading')}
                      </span>
                    ) : (
                      t('playlists.loadMore')
                    )}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <AddToPlaylistModal
            open={bulkPlaylistOpen}
            onClose={() => setBulkPlaylistOpen(false)}
            mode={mode}
            userId={userId}
            childAccessToken={childAccessToken}
            initialPlaylists={initialPlaylists}
            preferredPlaylistId={hintPlaylistId}
            videos={selectedVideos}
            onSuccess={() => {
              exitSelectionMode()
              setBulkPlaylistOpen(false)
            }}
          />
        </>
      )}
    </section>
  )
}
