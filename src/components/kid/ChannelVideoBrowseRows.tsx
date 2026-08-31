import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ListMusic } from 'lucide-react'
import { YoutubeShortCard } from '../youtube/YoutubeShortCard'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { ChannelContentTabs, type ChannelContentTab } from '../youtube/ChannelContentTabs'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'
import type { WatchableVideoBase } from '../../lib/videoFormatClassification'
import { isLiveStreamVideo, isVideoShortOrSuspected, partitionVideosForBrowse, toWatchableVideo } from '../../lib/videoFormatClassification'
import { usePortraitVideoThumbnailIds } from '../../hooks/usePortraitVideoThumbnailIds'
import { useNearBottomLoadMore } from '../../hooks/useNearBottomLoadMore'
import { useChannelYoutubePlaylists } from '../../hooks/useChannelYoutubePlaylists'
import { formatLikeCountLabel, formatViewCountLabel } from '../../lib/formatYoutubeCount'
import {
  formatRelativePublishedAt,
  formatVideoDurationClock,
  joinVideoMetadataParts,
} from '../../lib/formatRelativeTime'
import { fetchVideoDetailsBatch } from '../../lib/youtube'
import type { UserPlaylist } from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { PlaylistTabVideoSearch } from '../playlists/PlaylistTabVideoSearch'

type Props = {
  videos: WatchableVideoBase[]
  activeVideoId?: string | null
  allowShorts?: boolean
  hideThumbnails?: boolean
  /** Channel name shown under each title (YouTube related-rail style). */
  channelName?: string | null
  /**
   * `sidebar` — compact YouTube “Up next” rows (watch page).
   * `grid` — full channel feed tiles.
   */
  variant?: 'grid' | 'sidebar'
  onSelectVideo: (video: WatchableVideoBase, playAs?: 'short' | 'long') => void
  renderAction?: (video: WatchableVideoBase) => ReactNode
  /** Infinite scroll / load-more (YouTube channel pagination). */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  loadMoreLabel?: string
  loadingMoreLabel?: string
  /** YouTube channel id — used to load official creator playlists on the Playlists tab. */
  youtubeChannelId?: string | null
  /** Optional SafeTube playlist add UI on the Playlists tab. */
  playlistAddVideos?: {
    userId: string | null
    childAccessToken?: string | null
    mode?: PlaylistMode
    initialPlaylists?: UserPlaylist[]
  }
  /** Controlled tab (shared with watch layout so tabs stay visible while playing). */
  tab?: ChannelContentTab
  onTabChange?: (tab: ChannelContentTab) => void
  /** Parent already renders ChannelContentTabs above the player. */
  hideTabs?: boolean
}

function videoMetadata(video: WatchableVideoBase): string | null {
  const views = formatViewCountLabel(video.viewCount)
  const likes = formatLikeCountLabel(video.likeCount)
  const relative = formatRelativePublishedAt(video.publishedAt)
  return joinVideoMetadataParts(
    video.liveBroadcastContent === 'live' ? 'בשידור חי' : null,
    views,
    likes ? `${likes} לייקים` : null,
    relative
  )
}

function VideoBrowseCard({
  video,
  active,
  hideThumbnail,
  channelName,
  layout,
  onSelect,
}: {
  video: WatchableVideoBase
  active: boolean
  hideThumbnail?: boolean
  channelName?: string | null
  layout: 'grid' | 'row'
  onSelect: () => void
}) {
  return (
    <YoutubeVideoCard
      layout={layout}
      title={video.title}
      thumbnail={video.thumbnail_url}
      channelName={channelName}
      metadata={videoMetadata(video)}
      durationLabel={formatVideoDurationClock(video.durationSeconds)}
      active={active}
      hideThumbnail={hideThumbnail}
      onClick={onSelect}
    />
  )
}

export function ChannelVideoBrowseRows({
  videos,
  activeVideoId,
  allowShorts = true,
  hideThumbnails = false,
  channelName = null,
  variant = 'grid',
  onSelectVideo,
  renderAction: _renderAction,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadMoreLabel,
  loadingMoreLabel,
  youtubeChannelId = null,
  playlistAddVideos,
  tab: tabProp,
  onTabChange,
  hideTabs = false,
}: Props) {
  const { t } = useTranslation()
  const cardLayout = variant === 'sidebar' ? 'row' : 'grid'
  const listClassName = variant === 'sidebar' ? 'flex flex-col gap-1' : 'yt-video-grid'
  const resolvedLoadMoreLabel = loadMoreLabel ?? t('channels.loadOlderVideos')
  const resolvedLoadingMoreLabel = loadingMoreLabel ?? t('channels.loadingOlderVideos')
  const portraitThumbnailIds = usePortraitVideoThumbnailIds(videos)

  const [internalTab, setInternalTab] = useState<ChannelContentTab>('home')
  const tab = tabProp ?? internalTab
  const setTab = onTabChange ?? setInternalTab

  // Fill missing durations so every sidebar/grid thumbnail can show a YouTube-style clock.
  const [durationOverrides, setDurationOverrides] = useState<Record<string, number>>({})
  const requestedDurationIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const missing = videos
      .filter((v) => {
        if (v.durationSeconds != null && v.durationSeconds > 0) return false
        if (durationOverrides[v.youtube_video_id] != null) return false
        return !requestedDurationIdsRef.current.has(v.youtube_video_id)
      })
      .map((v) => v.youtube_video_id)
    if (missing.length === 0) return

    for (const id of missing) requestedDurationIdsRef.current.add(id)

    let cancelled = false
    void fetchVideoDetailsBatch(missing).then((details) => {
      if (cancelled) return
      setDurationOverrides((prev) => {
        let changed = false
        const next = { ...prev }
        for (const id of missing) {
          const sec = details.get(id)?.durationSeconds
          if (sec != null && sec > 0 && next[id] !== sec) {
            next[id] = sec
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
    return () => {
      cancelled = true
    }
  }, [videos])

  const videosWithDuration = useMemo(
    () =>
      videos.map((v) => {
        const override = durationOverrides[v.youtube_video_id]
        if (v.durationSeconds != null && v.durationSeconds > 0) return v
        if (override == null) return v
        return { ...v, durationSeconds: override }
      }),
    [videos, durationOverrides]
  )

  const { longForm, shorts } = useMemo(
    () => partitionVideosForBrowse(videosWithDuration, portraitThumbnailIds),
    [videosWithDuration, portraitThumbnailIds]
  )
  const liveStreams = useMemo(
    () =>
      videosWithDuration.filter(
        (v) => isLiveStreamVideo(v) && !isVideoShortOrSuspected(v) && !portraitThumbnailIds.has(v.youtube_video_id)
      ),
    [videosWithDuration, portraitThumbnailIds]
  )

  const channelPlaylists = useChannelYoutubePlaylists(
    youtubeChannelId,
    tab === 'playlists' && Boolean(youtubeChannelId)
  )
  const { clearSelectedPlaylist, setSelectedPlaylistId, selectedPlaylistId } = channelPlaylists

  useEffect(() => {
    if (tab !== 'playlists') {
      clearSelectedPlaylist()
    }
  }, [tab, clearSelectedPlaylist])

  // When Shorts/Videos look empty because the first page is mostly the other format,
  // keep paging until something shows (or the channel has no more).
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore
  useEffect(() => {
    if (!hasMore || loadingMore) return
    const loadMore = onLoadMoreRef.current
    if (!loadMore) return
    const needMoreForShorts = tab === 'shorts' && allowShorts && shorts.length === 0
    const needMoreForVideos = tab === 'videos' && longForm.length === 0 && videosWithDuration.length > 0
    const needMoreForHome = tab === 'home' && videosWithDuration.length === 0
    if (needMoreForShorts || needMoreForVideos || needMoreForHome) {
      loadMore()
    }
  }, [
    tab,
    allowShorts,
    shorts.length,
    longForm.length,
    videosWithDuration.length,
    hasMore,
    loadingMore,
  ])

  const selectedPlaylist = useMemo(
    () =>
      channelPlaylists.playlists.find((pl) => pl.playlistId === selectedPlaylistId) ?? null,
    [channelPlaylists.playlists, selectedPlaylistId]
  )

  const playlistBrowseVideos = useMemo(
    () =>
      channelPlaylists.playlistVideos.map((row) =>
        toWatchableVideo({
          youtube_video_id: row.videoId,
          title: row.title,
          thumbnail_url: row.thumbnail || null,
          publishedAt: row.publishedAt ?? null,
        })
      ),
    [channelPlaylists.playlistVideos]
  )

  const sentinelRef = useNearBottomLoadMore({
    enabled: Boolean(hasMore && onLoadMore && tab !== 'playlists'),
    loading: loadingMore,
    onLoadMore: () => onLoadMore?.(),
  })

  const emptyLabel = (label: string) => (
    <p className="rounded-2xl border border-dashed border-yt-border px-3 py-8 text-center text-sm text-yt-textMuted xs:px-4 xs:py-10">
      {label}
    </p>
  )

  const loadMoreFooter =
    hasMore && onLoadMore ? (
      <div className="mt-4 flex flex-col items-center gap-2">
        <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 rounded-full px-5"
          disabled={loadingMore}
          onClick={() => onLoadMore()}
        >
          {loadingMore ? (
            <>
              <LoadingSpinner className="h-4 w-4 border-2 border-yt-red border-t-transparent" />
              {resolvedLoadingMoreLabel}
            </>
          ) : (
            resolvedLoadMoreLabel
          )}
        </Button>
      </div>
    ) : null

  const playlistsPanel = () => {
    const addVideosBlock = playlistAddVideos ? (
      <PlaylistTabVideoSearch
        userId={playlistAddVideos.userId}
        childAccessToken={playlistAddVideos.childAccessToken}
        mode={playlistAddVideos.mode}
        initialPlaylists={playlistAddVideos.initialPlaylists}
        className="mb-4"
        defaultExpanded={false}
      />
    ) : null

    if (!youtubeChannelId) {
      return (
        <>
          {addVideosBlock}
          {emptyLabel(t('channels.missingChannelId'))}
        </>
      )
    }

    if (selectedPlaylistId && selectedPlaylist) {
      return (
        <div className="flex flex-col gap-3">
          {addVideosBlock}
          <button
            type="button"
            onClick={clearSelectedPlaylist}
            className="inline-flex min-h-10 items-center gap-2 self-start rounded-full bg-yt-surfaceHover px-3 py-1.5 text-sm font-semibold text-yt-text transition hover:bg-[#3f3f3f]/80"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            {t('channels.backToPlaylists')}
          </button>
          <h2 className="px-0.5 text-base font-black text-yt-text">{selectedPlaylist.title}</h2>
          {channelPlaylists.playlistVideosLoading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-yt-textMuted">
              <LoadingSpinner className="h-6 w-6 border-2 border-sky-400 border-t-transparent" />
              {t('common.loading')}
            </div>
          ) : channelPlaylists.playlistVideosError ? (
            emptyLabel(channelPlaylists.playlistVideosError)
          ) : playlistBrowseVideos.length === 0 ? (
            emptyLabel(t('channels.emptyPlaylist'))
          ) : (
            <div className={listClassName}>
              {playlistBrowseVideos.map((video) => (
                <VideoBrowseCard
                  key={video.youtube_video_id}
                  video={video}
                  active={activeVideoId === video.youtube_video_id}
                  hideThumbnail={hideThumbnails}
                  channelName={channelName}
                  layout={cardLayout}
                  onSelect={() => onSelectVideo(video)}
                />
              ))}
            </div>
          )}
        </div>
      )
    }

    if (channelPlaylists.loading) {
      return (
        <>
          {addVideosBlock}
          <div className="flex min-h-32 items-center justify-center gap-2 text-yt-textMuted">
            <LoadingSpinner className="h-6 w-6 border-2 border-sky-400 border-t-transparent" />
            {t('channels.loadingPlaylists')}
          </div>
        </>
      )
    }

    if (channelPlaylists.error) {
      return (
        <>
          {addVideosBlock}
          {emptyLabel(channelPlaylists.error)}
        </>
      )
    }

    if (channelPlaylists.playlists.length === 0) {
      return (
        <>
          {addVideosBlock}
          {emptyLabel(t('channels.noPlaylistsPublic'))}
        </>
      )
    }

    return (
      <>
        {addVideosBlock}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {channelPlaylists.playlists.map((pl) => (
          <li key={pl.playlistId}>
            <button
              type="button"
              onClick={() => setSelectedPlaylistId(pl.playlistId)}
              className="flex w-full items-center gap-3 rounded-xl bg-yt-surfaceHover p-2 text-start transition hover:bg-[#3f3f3f]/80"
            >
              <span className="relative flex h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-yt-surface">
                {pl.thumbnail && !hideThumbnails ? (
                  <img src={pl.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-yt-textMuted">
                    <ListMusic className="h-7 w-7" aria-hidden />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-bold text-yt-text">{pl.title}</span>
                <span className="mt-0.5 block text-xs text-yt-textMuted">
                  {pl.itemCount != null
                    ? t('channels.playlistVideosCount', { count: pl.itemCount })
                    : t('channels.youtubePlaylist')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      </>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 px-0.5 pb-2 xs:px-1 sm:px-0">
      {hideTabs ? null : (
        <div className="-mx-0.5 bg-yt-bg/95 px-0.5 xs:-mx-1 xs:px-1 sm:mx-0 sm:px-0">
          <ChannelContentTabs
            value={tab}
            onChange={setTab}
            allowShorts={allowShorts}
            appearance={variant === 'sidebar' ? 'pills' : 'underline'}
          />
        </div>
      )}

      {tab === 'home' ? (
        <>
          {videosWithDuration.length === 0 ? (
            emptyLabel(hasMore ? t('channels.noLongVideosLoadMore') : t('channels.emptyCache'))
          ) : (
            <div className="flex flex-col gap-5">
              <section className="flex flex-col gap-3">
                <h2 className="px-0.5 text-base font-black text-yt-text">{t('channels.forYou')}</h2>
                {longForm.length === 0 ? (
                  emptyLabel(
                    shorts.length > 0 && allowShorts
                      ? t('channels.noLongVideosTryShorts')
                      : t('channels.noLongVideos')
                  )
                ) : (
                  <div className={listClassName}>
                    {longForm.map((video) => (
                      <VideoBrowseCard
                        key={video.youtube_video_id}
                        video={video}
                        active={activeVideoId === video.youtube_video_id}
                        hideThumbnail={hideThumbnails}
                        channelName={channelName}
                        layout={cardLayout}
                        onSelect={() => onSelectVideo(video, 'long')}
                      />
                    ))}
                  </div>
                )}
              </section>
              {allowShorts && shorts.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h2 className="px-0.5 text-base font-black text-yt-text">Shorts</h2>
                  <div className="yt-shorts-grid">
                    {shorts.slice(0, 24).map((video) => (
                      <YoutubeShortCard
                        key={video.youtube_video_id}
                        title={video.title}
                        thumbnail={video.thumbnail_url}
                        hideThumbnail={hideThumbnails}
                        active={activeVideoId === video.youtube_video_id}
                        onClick={() => onSelectVideo(video, 'short')}
                        durationLabel={formatVideoDurationClock(video.durationSeconds)}
                        className="!w-full max-w-none"
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
          {loadMoreFooter}
        </>
      ) : null}

      {tab === 'videos' ? (
        <>
          {longForm.length === 0
            ? emptyLabel(
                shorts.length > 0 && allowShorts
                  ? t('channels.noLongVideosTryShorts')
                  : hasMore
                    ? t('channels.noLongVideosLoadMore')
                    : t('channels.noLongVideos')
              )
            : (
              <div className={listClassName}>
                {longForm.map((video) => (
                  <VideoBrowseCard
                    key={video.youtube_video_id}
                    video={video}
                    active={activeVideoId === video.youtube_video_id}
                    hideThumbnail={hideThumbnails}
                    channelName={channelName}
                    layout={cardLayout}
                    onSelect={() => onSelectVideo(video, 'long')}
                  />
                ))}
              </div>
            )}
          {loadMoreFooter}
        </>
      ) : null}

      {tab === 'shorts' ? (
        <>
          {!allowShorts ? (
            emptyLabel(t('channels.shortsDisabled'))
          ) : shorts.length === 0 ? (
            loadingMore ? (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-yt-textMuted">
                <LoadingSpinner className="h-5 w-5 border-2 border-yt-red border-t-transparent" />
                {resolvedLoadingMoreLabel}
              </div>
            ) : (
              emptyLabel(hasMore ? t('channels.noShortsLoadMore') : t('channels.noShorts'))
            )
          ) : (
            <div className="yt-shorts-grid">
              {shorts.map((video) => (
                <YoutubeShortCard
                  key={video.youtube_video_id}
                  title={video.title}
                  thumbnail={video.thumbnail_url}
                  hideThumbnail={hideThumbnails}
                  active={activeVideoId === video.youtube_video_id}
                  onClick={() => onSelectVideo(video, 'short')}
                  durationLabel={formatVideoDurationClock(video.durationSeconds)}
                  className="!w-full max-w-none"
                />
              ))}
            </div>
          )}
          {allowShorts ? loadMoreFooter : null}
        </>
      ) : null}

      {tab === 'live' ? (
        <>
          {liveStreams.length === 0
            ? emptyLabel(hasMore ? t('channels.noLiveLoadMore') : t('channels.noLive'))
            : (
              <div className={listClassName}>
                {liveStreams.map((video) => (
                  <VideoBrowseCard
                    key={video.youtube_video_id}
                    video={video}
                    active={activeVideoId === video.youtube_video_id}
                    hideThumbnail={hideThumbnails}
                    channelName={channelName}
                    layout={cardLayout}
                    onSelect={() => onSelectVideo(video, 'long')}
                  />
                ))}
              </div>
            )}
          {loadMoreFooter}
        </>
      ) : null}

      {tab === 'playlists' ? playlistsPanel() : null}
    </div>
  )
}
