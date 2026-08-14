import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { SafeTubeLogo } from '../branding/SafeTubeLogo'
import { SplashScreen } from '../branding/SplashScreen'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  isTesterGateRequired,
  resolveTesterGateStatus,
  submitTesterAccessCode,
  type TesterGateStatus,
} from '../../lib/testerGate'

type Props = {
  children: ReactNode
}

export function TesterAccessGate({ children }: Props) {
  const required = isTesterGateRequired()
  const [status, setStatus] = useState<TesterGateStatus>(() =>
    required ? { state: 'loading' } : { state: 'open' }
  )
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    if (!isTesterGateRequired()) {
      setStatus({ state: 'open' })
      return
    }
    setStatus((prev) => (prev.state === 'open' ? prev : { state: 'loading' }))
    const next = await resolveTesterGateStatus()
    setStatus(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!required || !Capacitor.isNativePlatform()) return
    let handle: { remove: () => Promise<void> } | null = null
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh()
    }).then((h) => {
      handle = h
    })
    return () => {
      void handle?.remove()
    }
  }, [required, refresh])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const next = await submitTesterAccessCode(code)
      setStatus(next)
      if (next.state === 'open') setCode('')
    } finally {
      setSubmitting(false)
    }
  }

  if (!required || status.state === 'open') {
    return <>{children}</>
  }

  if (status.state === 'loading') {
    return <SplashScreen />
  }

  const canEnterCode = status.state === 'locked' && status.reason === 'need_code'
  const banner =
    status.state === 'error'
      ? status.message
      : status.state === 'locked'
        ? status.message
        : 'נדרש קוד גישה'

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-yt-bg px-4 py-8 text-yt-text">
      <div className="mx-auto w-full max-w-md">
        <section className="rounded-2xl bg-black px-4 py-6 text-center" aria-label="SafeTube">
          <SafeTubeLogo size="md" />
          <p className="mt-3 text-sm text-zinc-300">גישת בודקים — SafeTube</p>
        </section>

        <div className="app-floating-surface mt-4 p-5">
          <h1 className="text-lg font-bold text-yt-text">כניסת בודקים</h1>
          <p className="mt-2 text-sm leading-relaxed text-yt-textMuted">{banner}</p>

          {canEnterCode ? (
            <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
              <label className="text-sm font-semibold text-yt-text" htmlFor="tester-access-code">
                קוד גישה
              </label>
              <Input
                id="tester-access-code"
                type="password"
                inputMode="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="הזינו את הקוד מהצוות"
                className="h-12 rounded-xl"
                autoFocus
              />
              <Button type="submit" className="min-h-12 rounded-xl font-bold" disabled={submitting || !code.trim()}>
                {submitting ? 'בודק…' : 'כניסה'}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="mt-4 min-h-12 w-full rounded-xl font-bold"
              onClick={() => void refresh()}
            >
              רענון סטטוס
            </Button>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-yt-textMuted">
            הקוד נשלט מרחוק ב-Firebase Remote Config. כיבוי{' '}
            <code className="rounded bg-yt-surfaceHover px-1">tester_access_enabled</code> נועל את
            האפליקציה לכל הבודקים בלי APK חדש.
          </p>
        </div>
      </div>
    </div>
  )
}
