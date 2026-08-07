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

export function ChannelVideoBrowseRows({
  videos,
  activeVideoId,
  allowShorts = false,
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
    <p className="rounded-2xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
      {label}
    </p>
  )

  return (
    <div className="flex flex-col gap-4 px-1 pb-2 sm:px-0">
      <ChannelContentTabs value={tab} onChange={setTab} showShortsTab={allowShorts} />

      {tab === 'home' ? (
        <div className="flex flex-col gap-5">
          {longForm.length > 0 ? (
            <section aria-label="סרטונים">
              <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">סרטונים</h2>
              <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
                {longForm.map((video) => (
                  <div
                    key={video.youtube_video_id}
                    className="w-[min(82vw,280px)] shrink-0 [scroll-snap-align:start] sm:w-[280px]"
                  >
                    <YoutubeVideoCard
                      title={video.title}
                      thumbnail={video.thumbnail_url}
                      metadata={videoMetadata(video)}
                      active={activeVideoId === video.youtube_video_id}
                      onClick={() => onSelectVideo(video)}
                      actionSlot={renderAction?.(video)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {allowShorts && shorts.length > 0 ? (
            <section aria-label="סרטונים קצרים">
              <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">Shorts</h2>
              <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
                {shorts.map((video) => (
                  <div key={video.youtube_video_id} className="[scroll-snap-align:start]">
                    <YoutubeShortCard
                      title={video.title}
                      thumbnail={video.thumbnail_url}
                      active={activeVideoId === video.youtube_video_id}
                      onClick={() => onSelectVideo(video)}
                      actionSlot={renderAction?.(video)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {liveStreams.length > 0 ? (
            <section aria-label="שידורים חיים">
              <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">שידורים חיים</h2>
              <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
                {liveStreams.map((video) => (
                  <div
                    key={video.youtube_video_id}
                    className="w-[min(82vw,280px)] shrink-0 [scroll-snap-align:start] sm:w-[280px]"
                  >
                    <YoutubeVideoCard
                      title={video.title}
                      thumbnail={video.thumbnail_url}
                      metadata={videoMetadata(video)}
                      active={activeVideoId === video.youtube_video_id}
                      onClick={() => onSelectVideo(video)}
                      actionSlot={renderAction?.(video)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {longForm.length === 0 && !(allowShorts && shorts.length > 0) && liveStreams.length === 0
            ? emptyLabel('אין תוכן להצגה בערוץ הזה.')
            : null}
        </div>
      ) : null}

      {tab === 'videos' ? (
        longForm.length === 0 ? (
          emptyLabel('אין סרטונים ארוכים בערוץ הזה.')
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {longForm.map((video) => (
              <YoutubeVideoCard
                key={video.youtube_video_id}
                title={video.title}
                thumbnail={video.thumbnail_url}
                metadata={videoMetadata(video)}
                active={activeVideoId === video.youtube_video_id}
                onClick={() => onSelectVideo(video)}
                actionSlot={renderAction?.(video)}
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'shorts' ? (
        !allowShorts || shorts.length === 0 ? (
          emptyLabel(allowShorts ? 'אין Shorts בערוץ הזה.' : 'Shorts כבויים בפרופיל זה.')
        ) : (
          <div className="flex flex-wrap gap-3">
            {shorts.map((video) => (
              <YoutubeShortCard
                key={video.youtube_video_id}
                title={video.title}
                thumbnail={video.thumbnail_url}
                active={activeVideoId === video.youtube_video_id}
                onClick={() => onSelectVideo(video)}
                actionSlot={renderAction?.(video)}
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'live' ? (
        liveStreams.length === 0 ? (
          emptyLabel('אין שידורים חיים זמינים כרגע.')
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liveStreams.map((video) => (
              <YoutubeVideoCard
                key={video.youtube_video_id}
                title={video.title}
                thumbnail={video.thumbnail_url}
                metadata={videoMetadata(video)}
                active={activeVideoId === video.youtube_video_id}
                onClick={() => onSelectVideo(video)}
                actionSlot={renderAction?.(video)}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}
