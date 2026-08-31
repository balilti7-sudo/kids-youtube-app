import { Mic, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
  ariaLabel,
}: VoiceMicButtonProps) {
  const { t } = useTranslation()
  const { supported, listening, toggle } = useSpeechToText({ onResult })
  const idleLabel = ariaLabel ?? t('voice.searchAria')

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
      aria-label={listening ? t('voice.stopListening') : idleLabel}
      aria-pressed={listening}
      title={listening ? t('voice.listeningHint') : t('voice.tapToSpeak')}
    >
      {listening ? (
        <Square className="h-4 w-4 fill-current" aria-hidden />
      ) : (
        <Mic className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
      )}
    </button>
  )
}
