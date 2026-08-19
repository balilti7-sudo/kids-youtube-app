import { Mic, Square } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useSpeechToText } from '../../hooks/useSpeechToText'

type VoiceMicButtonProps = {
  onResult: (text: string) => void
  className?: string
  ariaLabel?: string
}

export function VoiceMicButton({
  onResult,
  className,
  ariaLabel = 'חיפוש קולי — דברו במקום להקליד',
}: VoiceMicButtonProps) {
  const { supported, listening, toggle } = useSpeechToText({ onResult })

  if (!supported) return null

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition',
        listening
          ? 'bg-red-600 text-white animate-pulse'
          : 'bg-yt-surfaceHover text-yt-text hover:bg-[#3f3f3f]/80',
        className
      )}
      aria-label={listening ? 'עצירת הקלטה' : ariaLabel}
      aria-pressed={listening}
      title={listening ? 'מקשיב… לחצו לעצירה' : 'דברו במקום להקליד'}
    >
      {listening ? (
        <Square className="h-4 w-4 fill-current" aria-hidden />
      ) : (
        <Mic className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
      )}
    </button>
  )
}
