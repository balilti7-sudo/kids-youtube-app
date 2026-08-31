import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { APP_VERSION } from '../lib/appVersion'

/**
 * Version shown in Settings / About.
 * On Android/iOS prefer CapApp.getInfo().version (APK versionName) so the UI
 * never lags behind a Gradle bump that happened after the web bundle was built.
 */
export function useDisplayedAppVersion(): string {
  const [version, setVersion] = useState(APP_VERSION)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setVersion(APP_VERSION)
      return
    }
    let cancelled = false
    void App.getInfo()
      .then((info) => {
        if (cancelled) return
        const native = (info.version || '').trim()
        setVersion(native || APP_VERSION)
      })
      .catch(() => {
        if (!cancelled) setVersion(APP_VERSION)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return version
}
