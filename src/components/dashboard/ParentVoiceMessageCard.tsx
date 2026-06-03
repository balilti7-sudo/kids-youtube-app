import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import { uploadParentVoiceMessage } from '../../lib/parentVoiceMessage'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

type RecordingPhase = 'idle' | 'recording' | 'uploading'

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ParentVoiceMessageCard({ className }: { className?: string }) {
  const { user } = useAuth()
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const tickRef = useRef<number | null>(null)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      if (tickRef.current != null) window.clearInterval(tickRef.current)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop()
      }
      stopTracks()
    }
  }, [stopTracks])

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    setPhase('uploading')

    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })

    if (tickRef.current != null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }

    stopTracks()
    recorderRef.current = null

    const mimeType = recorder.mimeType || pickRecorderMimeType() || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })
    chunksRef.current = []

    if (!user?.id) {
      toast.error('יש להתחבר כהורה לפני שליחת הודעה')
      setPhase('idle')
      setElapsedSeconds(0)
      return
    }

    if (!blob.size) {
      toast.error('ההקלטה ריקה — נסו שוב')
      setPhase('idle')
      setElapsedSeconds(0)
      return
    }

    const { data, error } = await uploadParentVoiceMessage(user.id, blob)
    setPhase('idle')
    setElapsedSeconds(0)

    if (error || !data) {
      toast.error('שליחת ההודעה נכשלה', { description: error?.message })
      return
    }

    setLastSentAt(data.messageAt)
    toast.success('הודעת הקול נשלחה לילד')
  }, [stopTracks, user?.id])

  const startRecording = async () => {
    if (!user?.id) {
      toast.error('יש להתחבר כהורה לפני הקלטה')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('הדפדפן לא תומך בהקלטת קול')
      return
    }
    if (phase !== 'idle') return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = pickRecorderMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      })

      recorder.start(250)
      setPhase('recording')
      setElapsedSeconds(0)
      tickRef.current = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1)
      }, 1000)
    } catch (e) {
      stopTracks()
      const message = e instanceof Error ? e.message : 'Microphone access denied'
      toast.error('לא ניתן להקליט', { description: message })
      setPhase('idle')
    }
  }

  const recorderSupported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)

  return (
    <section
      className={cn(
        'rounded-2xl border border-violet-700/50 bg-gradient-to-br from-violet-950/80 via-zinc-900/80 to-indigo-950/70 p-4 ring-1 ring-violet-800/40 sm:p-5',
        className
      )}
      aria-labelledby="parent-voice-message-title"
    >
      <div className="mb-3 flex items-center gap-2">
        <Volume2 className="h-5 w-5 text-violet-300" aria-hidden />
        <h2 id="parent-voice-message-title" className="text-base font-bold text-zinc-50">
          הודעת קול לילד
        </h2>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        הקליטו הודעה קצרה — היא תופיע מיד על מסך הילד עם השמעה אוטומטית.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {phase === 'recording' ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className="gap-2 border-red-500/40 bg-red-950/40 text-red-100 hover:bg-red-900/50"
              onClick={() => void stopRecording()}
            >
              <Square className="h-4 w-4 fill-current" aria-hidden />
              Stop Recording
            </Button>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-200">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" aria-hidden />
              {formatElapsed(elapsedSeconds)}
            </span>
          </>
        ) : (
          <Button
            type="button"
            className="gap-2"
            disabled={!recorderSupported || phase === 'uploading'}
            onClick={() => void startRecording()}
          >
            <Mic className="h-4 w-4" aria-hidden />
            {phase === 'uploading' ? 'שולח…' : 'Record Message'}
          </Button>
        )}
      </div>

      {!recorderSupported ? (
        <p className="mt-3 text-xs text-amber-200/90">הדפדפן הנוכחי לא תומך בהקלטת קול.</p>
      ) : null}

      {lastSentAt ? (
        <p className="mt-3 text-xs text-zinc-500">
          הודעה אחרונה נשלחה: {new Date(lastSentAt).toLocaleString('he-IL')}
        </p>
      ) : null}
    </section>
  )
}
