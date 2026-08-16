import { memo } from 'react'
import type { VideoFormat } from '../../lib/videoFormatClassification'
import { useVerticalSwipeNav } from '../../hooks/useVerticalSwipeNav'
import { CleanPlayer } from '../player/CleanPlayer'
import { cn } from '../../lib/utils'

export type ChildWatchPlayerShellProps = {
  videoId: string
  title: string
  channelTitle?: string
  posterUrl?: string | null
  format: VideoFormat
  blankVideoFrame?: boolean
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
  blankVideoFrame = false,
  onPreviousTrack,
  onNextTrack,
  hasNextTrack,
}: ChildWatchPlayerShellProps) {
  const isShort = format === 'short'
  const { containerRef, handlers, dragOffsetY, swiping } = useVerticalSwipeNav({
    enabled: isShort && Boolean(onNextTrack || onPreviousTrack),
    onSwipeUp: onNextTrack,
    onSwipeDown: onPreviousTrack,
  })

  return (
    <div
      ref={containerRef}
      {...(isShort ? handlers : {})}
      className={cn(
        'relative overflow-hidden bg-black',
        // touch-pan-y only for Shorts — on long-form it delays/drops taps on <video controls>.
        isShort ? 'touch-pan-y' : 'touch-manipulation',
        isShort
          ? 'mx-auto w-full max-w-[min(100%,420px)] [margin-inline:calc(50%-50vw)] sm:mx-0 sm:max-w-[420px]'
          : 'w-screen max-w-[100vw] [margin-inline:calc(50%-50vw)] sm:mx-0 sm:w-full sm:max-w-full'
      )}
      style={
        isShort && dragOffsetY
          ? {
              transform: `translate3d(0, ${dragOffsetY}px, 0)`,
              transition: swiping ? 'none' : 'transform 180ms ease-out',
            }
          : isShort
            ? { transition: 'transform 180ms ease-out' }
            : undefined
      }
      aria-roledescription={isShort ? 'shorts player' : undefined}
      data-shorts-swipe={isShort ? 'true' : undefined}
    >
      <div className={cn('relative w-full', isShort ? 'pt-[177.78%]' : 'pt-[56.25%]')}>
        <div className="absolute inset-0 min-h-0">
          <CleanPlayer
            videoId={videoId}
            title={title}
            channelTitle={channelTitle}
            posterUrl={blankVideoFrame ? null : posterUrl}
            blankVideoFrame={blankVideoFrame}
            onPreviousTrack={onPreviousTrack}
            onNextTrack={onNextTrack}
            hasNextTrack={hasNextTrack}
            className="h-full w-full"
          />
        </div>
      </div>
      {isShort ? (
        <span className="sr-only">החליקו למעלה או למטה למעבר בין Shorts</span>
      ) : null}
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
    prev.blankVideoFrame === next.blankVideoFrame &&
    prev.hasNextTrack === next.hasNextTrack &&
    prev.onPreviousTrack === next.onPreviousTrack &&
    prev.onNextTrack === next.onNextTrack
  )
}

/** Memoized watch player shell — avoids re-init when sidebar/recommendations update. */
export const ChildWatchPlayerShell = memo(ChildWatchPlayerShellInner, propsAreEqual)
