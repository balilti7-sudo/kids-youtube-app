import type { ReactNode } from 'react'
import { YoutubeShortCard } from '../youtube/YoutubeShortCard'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import type { WatchableVideoBase } from '../../lib/videoFormatClassification'
import { partitionVideosByFormat } from '../../lib/videoFormatClassification'

type Props = {
  videos: WatchableVideoBase[]
  activeVideoId?: string | null
  onSelectVideo: (videoId: string) => void
  renderAction?: (video: WatchableVideoBase) => ReactNode
}

export function ChannelVideoBrowseRows({ videos, activeVideoId, onSelectVideo, renderAction }: Props) {
  const { longForm, shorts } = partitionVideosByFormat(videos)

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
                  active={activeVideoId === video.youtube_video_id}
                  onClick={() => onSelectVideo(video.youtube_video_id)}
                  actionSlot={renderAction?.(video)}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {shorts.length > 0 ? (
        <section aria-label="סרטונים קצרים">
          <h2 className="mb-3 px-0.5 text-base font-black text-zinc-50">סרטונים קצרים (Shorts)</h2>
          <div className="premium-scrollbar flex gap-3 overflow-x-auto pb-2 pe-1 [-webkit-overflow-scrolling:touch] [scroll-snap-type:x_mandatory]">
            {shorts.map((video) => (
              <div key={video.youtube_video_id} className="[scroll-snap-align:start]">
                <YoutubeShortCard
                  title={video.title}
                  thumbnail={video.thumbnail_url}
                  active={activeVideoId === video.youtube_video_id}
                  onClick={() => onSelectVideo(video.youtube_video_id)}
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
