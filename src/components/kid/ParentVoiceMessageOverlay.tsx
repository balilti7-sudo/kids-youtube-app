import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { MessageCircle, Volume2, X } from 'lucide-react'
import { LionMascot } from './LionMascot'
import { useLionProgressionOptional } from '../../contexts/LionProgressionContext'
import type { ParentVoiceMessageState } from '../../lib/parentVoiceMessage'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type Props = {
  message: ParentVoiceMessageState
  onDismiss: () => void
}

export function ParentVoiceMessageOverlay({ message, onDismiss }: Props) {
  const lion = useLionProgressionOptional()
  const outfitId = lion?.activeOutfitId ?? 'cub'
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    void audio.play().catch(() => {
      /* autoplay may be blocked until user interacts — dismiss still works */
    })
    return () => {
      audio.pause()
    }
  }, [message.messageUrl, message.messageAt])

  const overlay = (
    <div
      className="fixed inset-0 z-[100020] flex items-center justify-center bg-zinc-950/90 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-voice-message-overlay-title"
      dir="ltr"
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className={cn(
          'relative w-full max-w-md overflow-hidden rounded-3xl border border-violet-400/30',
          'bg-gradient-to-b from-violet-950/95 via-indigo-950/95 to-zinc-950 px-6 py-7 text-center shadow-2xl'
        )}
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute end-3 top-3 rounded-lg p-1.5 text-violet-200/80 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center justify-center gap-2 text-violet-200/90">
          <MessageCircle className="h-5 w-5" aria-hidden />
          <span className="text-xs font-bold uppercase tracking-widest">Message from parent</span>
        </div>

        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          className="mx-auto mb-4 max-w-[180px]"
        >
          <LionMascot mood="bounce" outfitId={outfitId} />
        </motion.div>

        <h2
          id="parent-voice-message-overlay-title"
          className="mb-4 text-lg font-bold leading-relaxed text-zinc-50"
        >
          Your parent sent you a voice message!
        </h2>

        <div className="mb-5 flex items-center justify-center gap-2 rounded-2xl border border-violet-400/20 bg-black/30 px-4 py-3">
          <Volume2 className="h-5 w-5 shrink-0 text-violet-300" aria-hidden />
          <audio
            ref={audioRef}
            src={message.messageUrl}
            controls
            playsInline
            className="h-10 w-full max-w-[240px]"
          />
        </div>

        <Button type="button" className="min-w-[160px]" onClick={onDismiss}>
          Dismiss
        </Button>
      </motion.div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(overlay, document.body)
}
