import { cn } from '../../lib/utils'

type YoutubeEmbedBrandingShieldProps = {
  className?: string
}

/**
 * Blocks clicks and hides the official YouTube watermark in the embed control bar.
 * The iframe still loads from youtube.com (required for Android playback); overlays stay in SafeTube UI.
 */
export function YoutubeEmbedBrandingShield({ className }: YoutubeEmbedBrandingShieldProps) {
  return (
    <>
      {/* Bottom-left YouTube logo watermark */}
      <div
        className={cn(
          'pointer-events-auto absolute bottom-[46px] start-0 z-[11] h-11 w-[92px] bg-black',
          className
        )}
        aria-hidden
      />
      {/* Bottom-right "Watch on YouTube" / share chrome (when shown by the embed) */}
      <div
        className={cn(
          'pointer-events-auto absolute bottom-[46px] end-0 z-[11] h-11 w-[132px] bg-black',
          className
        )}
        aria-hidden
      />
    </>
  )
}
