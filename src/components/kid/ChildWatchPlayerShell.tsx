import { memo } from 'react'
import type { VideoFormat } from '../../lib/videoFormatClassification'
import { CleanPlayer } from '../player/CleanPlayer'

export type ChildWatchPlayerShellProps = {
  videoId: string
  title: string
  channelTitle?: string
  posterUrl?: string | null
  format: VideoFormat
  onPreviousTrack?: () => void
  onNextTrack?: () => void
  hasNextTrack?: boolean
}

function ChildWatchPlayerShellInner({
  videoId,
  title,
  channelTitle,
  posterUrl,
  format,
  onPreviousTrack,
  onNextTrack,
  hasNextTrack,
}: ChildWatchPlayerShellProps) {
  const isShort = format === 'short'

  return (
    <div
      className={
        isShort
          ? 'relative mx-auto w-full max-w-[min(100%,420px)] overflow-hidden bg-black [margin-inline:calc(50%-50vw)] sm:mx-0 sm:max-w-[420px]'
          : 'relative w-screen max-w-[100vw] overflow-hidden bg-black [margin-inline:calc(50%-50vw)] sm:mx-0 sm:w-full sm:max-w-full'
      }
    >
      <div className={`relative w-full ${isShort ? 'pt-[177.78%]' : 'pt-[56.25%]'}`}>
        <div className="absolute inset-0 min-h-0">
          <CleanPlayer
            videoId={videoId}
            title={title}
            channelTitle={channelTitle}
            posterUrl={posterUrl}
            onPreviousTrack={onPreviousTrack}
            onNextTrack={onNextTrack}
            hasNextTrack={hasNextTrack}
            className="h-full w-full"
          />
        </div>
      </div>
    </div>
  )
}

function propsAreEqual(prev: ChildWatchPlayerShellProps, next: ChildWatchPlayerShellProps) {
  return (
    prev.videoId === next.videoId &&
    prev.title === next.title &&
    prev.channelTitle === next.channelTitle &&
    prev.posterUrl === next.posterUrl &&
    prev.format === next.format &&
    prev.hasNextTrack === next.hasNextTrack &&
    prev.onPreviousTrack === next.onPreviousTrack &&
    prev.onNextTrack === next.onNextTrack
  )
}

/** Memoized watch player shell — avoids re-init when sidebar/recommendations update. */
export const ChildWatchPlayerShell = memo(ChildWatchPlayerShellInner, propsAreEqual)
