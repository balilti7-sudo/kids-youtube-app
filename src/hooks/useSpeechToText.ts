import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition'
import { toast } from 'sonner'
import i18n from '../i18n'

type SpeechRecognitionCtor = new () => WebSpeechRecognitionInstance

type WebSpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: WebSpeechRecognitionResultEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type WebSpeechRecognitionResultEvent = {
  results: {
    length: number
    [index: number]: { isFinal: boolean; [index: number]: { transcript: string } }
  }
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

function getWebSpeechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** Native Android/iOS always get a mic path; web needs the Speech API. */
export function isSpeechToTextSupported(): boolean {
  if (isNativePlatform()) return true
  return getWebSpeechCtor() !== null
}

export function useSpeechToText(opts?: { lang?: string; onResult?: (text: string) => void }) {
  const lang = opts?.lang ?? 'he-IL'
  const onResultRef = useRef(opts?.onResult)
  onResultRef.current = opts?.onResult

  const webRecognitionRef = useRef<WebSpeechRecognitionInstance | null>(null)
  const nativeBusyRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => isSpeechToTextSupported())

  useEffect(() => {
    return () => {
      try {
        webRecognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
      webRecognitionRef.current = null
      if (nativeBusyRef.current) {
        void SpeechRecognition.stop().catch(() => undefined)
        nativeBusyRef.current = false
      }
    }
  }, [])

  const stop = useCallback(() => {
    try {
      webRecognitionRef.current?.stop()
    } catch {
      /* ignore */
    }
    if (nativeBusyRef.current) {
      void SpeechRecognition.stop().catch(() => undefined)
      nativeBusyRef.current = false
    }
    setListening(false)
  }, [])

  const startWeb = useCallback(() => {
    const Ctor = getWebSpeechCtor()
    if (!Ctor) {
      toast.error(i18n.t('voice.unsupported'))
      return
    }

    try {
      webRecognitionRef.current?.abort()
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
        toast.error(i18n.t('voice.permissionDeniedDevice'))
        return
      }
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast.error(i18n.t('voice.recognizeFailed'))
      }
    }

    recognition.onend = () => setListening(false)

    webRecognitionRef.current = recognition
    setListening(true)
    try {
      recognition.start()
    } catch {
      setListening(false)
      toast.error(i18n.t('voice.micUnavailable'))
    }
  }, [lang])

  const startNative = useCallback(async () => {
    if (nativeBusyRef.current) return

    try {
      const permission = await SpeechRecognition.requestPermissions()
      if (permission.speechRecognition !== 'granted') {
        const again = await SpeechRecognition.checkPermissions()
        if (again.speechRecognition !== 'granted') {
          toast.error(i18n.t('voice.permissionDenied'))
          return
        }
      }

      const { available } = await SpeechRecognition.available()
      if (!available) {
        toast.error(i18n.t('voice.speechUnavailable'))
        return
      }

      nativeBusyRef.current = true
      setListening(true)

      // System popup is the most reliable path on Android WebView devices.
      const result = await SpeechRecognition.start({
        language: lang,
        maxResults: 3,
        partialResults: false,
        popup: true,
        prompt: i18n.t('voice.speakNow'),
      })

      const matches = result.matches ?? []
      const text = matches.map((m) => String(m).trim()).find(Boolean)
      if (text) {
        onResultRef.current?.(text)
      } else {
        toast.message(i18n.t('voice.noSpeech'))
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!/cancel|abort|user/i.test(message)) {
        toast.error(i18n.t('voice.recognizeFailed'))
      }
    } finally {
      nativeBusyRef.current = false
      setListening(false)
    }
  }, [lang])

  const start = useCallback(() => {
    if (isNativePlatform()) {
      void startNative()
      return
    }
    startWeb()
  }, [startNative, startWeb])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, start, stop, toggle }
}
