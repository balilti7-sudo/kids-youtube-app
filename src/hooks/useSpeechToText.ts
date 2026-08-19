import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionResultEvent = {
  results: SpeechRecognitionResultList
}

type SpeechRecognitionResultList = {
  length: number
  [index: number]: SpeechRecognitionResult
}

type SpeechRecognitionResult = {
  isFinal: boolean
  [index: number]: { transcript: string }
}

type SpeechRecognitionErrorEvent = {
  error: string
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function isSpeechToTextSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

export function useSpeechToText(opts?: { lang?: string; onResult?: (text: string) => void }) {
  const lang = opts?.lang ?? 'he-IL'
  const onResultRef = useRef(opts?.onResult)
  onResultRef.current = opts?.onResult

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => isSpeechToTextSupported())

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      recognitionRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      toast.error('המכשיר לא תומך בקלט קולי. נסו להקליד.')
      return
    }

    try {
      recognitionRef.current?.abort()
    } catch {
      /* ignore */
    }

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event) => {
      const chunk = event.results?.[0]?.[0]?.transcript?.trim()
      if (chunk) onResultRef.current?.(chunk)
    }

    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast.error('יש לאשר גישה למיקרופון בהגדרות המכשיר.')
        return
      }
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast.error('לא הצלחנו לזהות דיבור. נסו שוב.')
      }
    }

    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      setListening(false)
      toast.error('לא ניתן להפעיל את המיקרופון כרגע.')
    }
  }, [lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, start, stop, toggle }
}
