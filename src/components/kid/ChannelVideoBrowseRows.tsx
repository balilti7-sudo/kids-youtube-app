import { useMemo, type ReactNode } from 'react'
import { YoutubeShortCard } from '../youtube/YoutubeShortCard'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import type { WatchableVideoBase } from '../../lib/videoFormatClassification'
import { partitionVideosForBrowse } from '../../lib/videoFormatClassification'
import { usePortraitVideoThumbnailIds } from '../../hooks/usePortraitVideoThumbnailIds'

type Props = {
  videos: WatchableVideoBase[]
  activeVideoId?: string | null
  allowShorts?: boolean
  onSelectVideo: (video: WatchableVideoBase) => void
  renderAction?: (video: WatchableVideoBase) => ReactNode
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
  const showShorts = allowShorts && shorts.length > 0

  return (
    <div className="flex flex-col gap-5 px-1 pb-2 sm:px-0">
      {longForm.length > 0 ? (
        <section aria-label="סרטונים">
          <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">סרטונים</h2>
          <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
            {longForm.map((video) => (
              <div key={video.youtube_video_id} className="w-[min(82vw,280px)] shrink-0 [scroll-snap-align:start] sm:w-[280px]">
                <YoutubeVideoCard
                  title={video.title}
                  thumbnail={video.thumbnail_url}
                  prefetchVideoId={video.youtube_video_id}
                  active={activeVideoId === video.youtube_video_id}
                  onClick={() => onSelectVideo(video)}
                  actionSlot={renderAction?.(video)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showShorts ? (
        <section aria-label="סרטונים קצרים">
          <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">סרטונים קצרים (Shorts)</h2>
          <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
            {shorts.map((video) => (
              <div key={video.youtube_video_id} className="[scroll-snap-align:start]">
                <YoutubeShortCard
                  title={video.title}
                  thumbnail={video.thumbnail_url}
                  prefetchVideoId={video.youtube_video_id}
                  active={activeVideoId === video.youtube_video_id}
                  onClick={() => onSelectVideo(video)}
                  actionSlot={renderAction?.(video)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
