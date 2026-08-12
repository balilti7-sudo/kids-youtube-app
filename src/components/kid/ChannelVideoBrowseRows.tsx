import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { YoutubeShortCard } from '../youtube/YoutubeShortCard'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { ChannelContentTabs, type ChannelContentTab } from '../youtube/ChannelContentTabs'
import type { WatchableVideoBase } from '../../lib/videoFormatClassification'
import { isLiveStreamVideo, isVideoShortOrSuspected, partitionVideosForBrowse } from '../../lib/videoFormatClassification'
import { usePortraitVideoThumbnailIds } from '../../hooks/usePortraitVideoThumbnailIds'
import { formatViewCountLabel } from '../../lib/formatYoutubeCount'

type Props = {
  videos: WatchableVideoBase[]
  activeVideoId?: string | null
  allowShorts?: boolean
  hideThumbnails?: boolean
  onSelectVideo: (video: WatchableVideoBase) => void
  renderAction?: (video: WatchableVideoBase) => ReactNode
}

function videoMetadata(video: WatchableVideoBase): string | null {
  const views = formatViewCountLabel(video.viewCount)
  if (video.liveBroadcastContent === 'live') {
    return views ? `בשידור חי · ${views}` : 'בשידור חי'
  }
  return views || null
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
      actionSlot={action}
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

  const emptyLabel = (label: string) => (
    <p className="rounded-2xl border border-dashed border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500 xs:px-4 xs:py-10">
      {label}
    </p>
  )

  const homeShelfMobile = (items: WatchableVideoBase[], aria: string, title: string) => (
    <section aria-label={aria}>
      <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">{title}</h2>
      {/* Phone: horizontal shelf · Tablet+: multi-column grid (YouTube channel home) */}
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
      <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">Shorts</h2>
      <div className="premium-scrollbar flex gap-2 overflow-x-auto pb-2 pe-1 xs:gap-3 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory] md:hidden">
        {items.map((video) => (
          <div key={video.youtube_video_id} className="[scroll-snap-align:start]">
            <YoutubeShortCard
              title={video.title}
              thumbnail={video.thumbnail_url}
              hideThumbnail={hideThumbnails}
              active={activeVideoId === video.youtube_video_id}
              onClick={() => onSelectVideo(video)}
              actionSlot={renderAction?.(video)}
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
            actionSlot={renderAction?.(video)}
            className="!w-full"
          />
        ))}
      </div>
    </section>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4 px-0.5 pb-2 xs:px-1 sm:px-0">
      <ChannelContentTabs value={tab} onChange={setTab} showShortsTab={allowShorts} />

      {tab === 'home' ? (
        <div className="flex flex-col gap-5">
          {longForm.length > 0 ? homeShelfMobile(longForm, 'סרטונים', 'סרטונים') : null}
          {allowShorts && shorts.length > 0 ? shortsShelf(shorts) : null}
          {liveStreams.length > 0 ? homeShelfMobile(liveStreams, 'שידורים חיים', 'שידורים חיים') : null}
          {longForm.length === 0 && !(allowShorts && shorts.length > 0) && liveStreams.length === 0
            ? emptyLabel('אין תוכן להצגה בערוץ הזה.')
            : null}
        </div>
      ) : null}

      {tab === 'videos' ? (
        longForm.length === 0 ? (
          emptyLabel('אין סרטונים ארוכים בערוץ הזה.')
        ) : (
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
        )
      ) : null}

      {tab === 'shorts' ? (
        !allowShorts || shorts.length === 0 ? (
          emptyLabel(allowShorts ? 'אין Shorts בערוץ הזה.' : 'Shorts כבויים בפרופיל זה.')
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
                actionSlot={renderAction?.(video)}
                className="!w-full max-w-none"
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'live' ? (
        liveStreams.length === 0 ? (
          emptyLabel('אין שידורים חיים זמינים כרגע.')
        ) : (
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
        )
      ) : null}
    </div>
  )
}
