import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { YoutubeShortCard } from '../youtube/YoutubeShortCard'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { YoutubeLikeButton } from '../youtube/YoutubeLikeButton'
import { ChannelContentTabs, type ChannelContentTab } from '../youtube/ChannelContentTabs'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { Button } from '../ui/Button'
import type { WatchableVideoBase } from '../../lib/videoFormatClassification'
import { isLiveStreamVideo, isVideoShortOrSuspected, partitionVideosForBrowse } from '../../lib/videoFormatClassification'
import { usePortraitVideoThumbnailIds } from '../../hooks/usePortraitVideoThumbnailIds'
import { useNearBottomLoadMore } from '../../hooks/useNearBottomLoadMore'
import { formatLikeCountLabel, formatViewCountLabel } from '../../lib/formatYoutubeCount'
import { formatRelativePublishedAt, joinVideoMetadataParts } from '../../lib/formatRelativeTime'
import { ListMusic } from 'lucide-react'
import type { UserPlaylist } from '../../lib/playlists'

type Props = {
  videos: WatchableVideoBase[]
  activeVideoId?: string | null
  allowShorts?: boolean
  hideThumbnails?: boolean
  onSelectVideo: (video: WatchableVideoBase) => void
  renderAction?: (video: WatchableVideoBase) => ReactNode
  /** Infinite scroll / load-more (YouTube channel pagination). */
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  loadMoreLabel?: string
  loadingMoreLabel?: string
  playlists?: UserPlaylist[]
  playlistVideos?: WatchableVideoBase[]
  onSelectPlaylist?: (playlistId: string) => void
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

function VideoGridCard({
  video,
  active,
  hideThumbnail,
  onSelect,
  action,
}: {
  video: WatchableVideoBase
  active: boolean
  hideThumbnail?: boolean
  onSelect: () => void
  action?: ReactNode
}) {
  return (
    <YoutubeVideoCard
      title={video.title}
      thumbnail={video.thumbnail_url}
      metadata={videoMetadata(video)}
      active={active}
      hideThumbnail={hideThumbnail}
      onClick={onSelect}
      actionSlot={
        <div className="flex items-center gap-1.5">
          <YoutubeLikeButton videoId={video.youtube_video_id} likeCount={video.likeCount} compact />
          {action}
        </div>
      }
    />
  )
}

export function ChannelVideoBrowseRows({
  videos,
  activeVideoId,
  allowShorts = false,
  hideThumbnails = false,
  onSelectVideo,
  renderAction,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadMoreLabel = 'טען עוד סרטונים',
  loadingMoreLabel = 'טוען עוד…',
  playlists = [],
  playlistVideos = [],
  onSelectPlaylist,
}: Props) {
  const portraitThumbnailIds = usePortraitVideoThumbnailIds(videos)
  const { longForm, shorts } = useMemo(
    () => partitionVideosForBrowse(videos, portraitThumbnailIds),
    [videos, portraitThumbnailIds]
  )
  const liveStreams = useMemo(
    () =>
      videos.filter(
        (v) => isLiveStreamVideo(v) && !isVideoShortOrSuspected(v) && !portraitThumbnailIds.has(v.youtube_video_id)
      ),
    [videos, portraitThumbnailIds]
  )

  const [tab, setTab] = useState<ChannelContentTab>('home')

  useEffect(() => {
    if (tab === 'shorts' && !allowShorts) setTab('home')
  }, [allowShorts, tab])

  const sentinelRef = useNearBottomLoadMore({
    enabled: Boolean(hasMore && onLoadMore),
    loading: loadingMore,
    onLoadMore: () => onLoadMore?.(),
  })

  const emptyLabel = (label: string) => (
    <p className="rounded-2xl border border-dashed border-yt-border px-3 py-8 text-center text-sm text-yt-textMuted xs:px-4 xs:py-10">
      {label}
    </p>
  )

  const homeShelfMobile = (items: WatchableVideoBase[], aria: string, title: string) => (
    <section aria-label={aria}>
      <h2 className="mb-3 px-0.5 text-base font-black text-yt-text">{title}</h2>
      <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory] md:hidden">
        {items.map((video) => (
          <div
            key={video.youtube_video_id}
            className="w-[min(78vw,260px)] shrink-0 [scroll-snap-align:start] xs:w-[min(82vw,280px)]"
          >
            <VideoGridCard
              video={video}
              active={activeVideoId === video.youtube_video_id}
              hideThumbnail={hideThumbnails}
              onSelect={() => onSelectVideo(video)}
              action={renderAction?.(video)}
            />
          </div>
        ))}
      </div>
      <div className="yt-channel-home-grid hidden md:grid">
        {items.map((video) => (
          <VideoGridCard
            key={video.youtube_video_id}
            video={video}
            active={activeVideoId === video.youtube_video_id}
            hideThumbnail={hideThumbnails}
            onSelect={() => onSelectVideo(video)}
            action={renderAction?.(video)}
          />
        ))}
      </div>
    </section>
  )

  const shortsShelf = (items: WatchableVideoBase[]) => (
    <section aria-label="סרטונים קצרים">
      <h2 className="mb-3 px-0.5 text-base font-black text-yt-text">שורטים</h2>
      <div className="premium-scrollbar flex gap-2 overflow-x-auto pb-2 pe-1 xs:gap-3 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory] md:hidden">
        {items.map((video) => (
          <div key={video.youtube_video_id} className="[scroll-snap-align:start]">
            <YoutubeShortCard
              title={video.title}
              thumbnail={video.thumbnail_url}
              hideThumbnail={hideThumbnails}
              active={activeVideoId === video.youtube_video_id}
              onClick={() => onSelectVideo(video)}
              actionSlot={
                <div className="flex items-center gap-1.5">
                  <YoutubeLikeButton videoId={video.youtube_video_id} likeCount={video.likeCount} compact />
                  {renderAction?.(video)}
                </div>
              }
            />
          </div>
        ))}
      </div>
      <div className="yt-shorts-grid hidden md:grid">
        {items.map((video) => (
          <YoutubeShortCard
            key={video.youtube_video_id}
            title={video.title}
            thumbnail={video.thumbnail_url}
            hideThumbnail={hideThumbnails}
            active={activeVideoId === video.youtube_video_id}
            onClick={() => onSelectVideo(video)}
            actionSlot={
              <div className="flex items-center gap-1.5">
                <YoutubeLikeButton videoId={video.youtube_video_id} likeCount={video.likeCount} compact />
                {renderAction?.(video)}
              </div>
            }
            className="!w-full"
          />
        ))}
      </div>
    </section>
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
              {loadingMoreLabel}
            </>
          ) : (
            loadMoreLabel
          )}
        </Button>
      </div>
    ) : null

  return (
    <div className="flex min-w-0 flex-col gap-4 px-0.5 pb-2 xs:px-1 sm:px-0">
      <ChannelContentTabs value={tab} onChange={setTab} />

      {tab === 'home' ? (
        <div className="flex flex-col gap-5">
          {longForm.length > 0 ? homeShelfMobile(longForm, 'סרטונים', 'סרטונים') : null}
          {allowShorts && shorts.length > 0 ? shortsShelf(shorts) : null}
          {liveStreams.length > 0 ? homeShelfMobile(liveStreams, 'שידורים חיים', 'שידורים חיים') : null}
          {longForm.length === 0 && !(allowShorts && shorts.length > 0) && liveStreams.length === 0
            ? emptyLabel(
                hasMore
                  ? 'טוען את סרטוני הערוץ… גלול למטה או לחץ על טען עוד.'
                  : 'אין תוכן להצגה בערוץ הזה.'
              )
            : null}
          {loadMoreFooter}
        </div>
      ) : null}

      {tab === 'videos' ? (
        <>
          {longForm.length === 0
            ? emptyLabel(
                hasMore
                  ? 'עדיין אין סרטונים ארוכים ברשימה שנטענה — טען עוד כדי להמשיך.'
                  : 'אין סרטונים ארוכים בערוץ הזה.'
              )
            : (
              <div className="yt-video-grid">
                {longForm.map((video) => (
                  <VideoGridCard
                    key={video.youtube_video_id}
                    video={video}
                    active={activeVideoId === video.youtube_video_id}
                    hideThumbnail={hideThumbnails}
                    onSelect={() => onSelectVideo(video)}
                    action={renderAction?.(video)}
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
            emptyLabel('שורטים כבויים בפרופיל זה.')
          ) : shorts.length === 0 ? (
            emptyLabel(
              hasMore
                ? 'עדיין אין שורטים ברשימה שנטענה — טען עוד כדי להמשיך.'
                : 'אין שורטים בערוץ הזה.'
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
                  onClick={() => onSelectVideo(video)}
                  actionSlot={
                    <div className="flex items-center gap-1.5">
                      <YoutubeLikeButton videoId={video.youtube_video_id} likeCount={video.likeCount} compact />
                      {renderAction?.(video)}
                    </div>
                  }
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
            ? emptyLabel(
                hasMore
                  ? 'עדיין אין שידורים חיים ברשימה שנטענה — טען עוד כדי להמשיך.'
                  : 'אין שידורים חיים זמינים כרגע.'
              )
            : (
              <div className="yt-video-grid">
                {liveStreams.map((video) => (
                  <VideoGridCard
                    key={video.youtube_video_id}
                    video={video}
                    active={activeVideoId === video.youtube_video_id}
                    hideThumbnail={hideThumbnails}
                    onSelect={() => onSelectVideo(video)}
                    action={renderAction?.(video)}
                  />
                ))}
              </div>
            )}
          {loadMoreFooter}
        </>
      ) : null}

      {tab === 'playlists' ? (
        playlists.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {playlists.map((pl) => (
              <li key={pl.id}>
                <button
                  type="button"
                  onClick={() => onSelectPlaylist?.(pl.id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-yt-surfaceHover px-3 py-3 text-start transition hover:bg-[#3f3f3f]/80"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-yt-surface text-yt-text">
                    <ListMusic className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-yt-text">{pl.name}</span>
                    <span className="mt-0.5 block text-xs text-yt-textMuted">
                      {pl.video_count} סרטונים
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : playlistVideos.length > 0 ? (
          <div className="yt-video-grid">
            {playlistVideos.map((video) => (
              <VideoGridCard
                key={video.youtube_video_id}
                video={video}
                active={activeVideoId === video.youtube_video_id}
                hideThumbnail={hideThumbnails}
                onSelect={() => onSelectVideo(video)}
                action={renderAction?.(video)}
              />
            ))}
          </div>
        ) : (
          emptyLabel('אין עדיין פלייליסטים. שמרו סרטונים עם «שמירה».')
        )
      ) : null}
    </div>
  )
}
