import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { SafeBrowserFrame } from '../components/browser/SafeBrowserFrame'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { getChildDeviceState, getSavedChildAccessToken, type ChildDeviceState } from '../lib/childDevice'
import { buildSafeBrowserUrl, isHostWhitelisted } from '../lib/safeBrowserNavigation'
import { normalizeWhitelistHost } from '../lib/parentalControlNative'
import { policyFromDeviceFields, syncParentalControlPolicy } from '../lib/syncParentalControlPolicy'
import { PageBackBar } from '../components/layout/PageBackBar'

export function SafeBrowserPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedHost = normalizeWhitelistHost(params.get('host') ?? '')

  const [loading, setLoading] = useState(true)
  const [device, setDevice] = useState<ChildDeviceState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeHost, setActiveHost] = useState<string | null>(requestedHost || null)

  const whitelist = useMemo(
    () => (Array.isArray(device?.browser_whitelist) ? device!.browser_whitelist : []),
    [device]
  )

  useEffect(() => {
    let cancelled = false
    const token = getSavedChildAccessToken()
    if (!token) {
      setError(t('safeBrowser.noKidSession'))
      setLoading(false)
      return
    }

    void (async () => {
      const res = await getChildDeviceState(token)
      if (cancelled) return
      if (res.error && !res.data) {
        setError(res.error.message)
        setLoading(false)
        return
      }
      if (!res.data) {
        setError(t('safeBrowser.noKidSession'))
        setLoading(false)
        return
      }
      setDevice(res.data)
      void syncParentalControlPolicy(policyFromDeviceFields(res.data))

      if (requestedHost && isHostWhitelisted(requestedHost, res.data.browser_whitelist ?? [])) {
        setActiveHost(requestedHost)
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [requestedHost, t])

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950">
        <LoadingSpinner />
      </div>
    )
  }

  if (error || !device) {
    return (
      <div className="flex min-h-dvh flex-col bg-zinc-950 px-4 py-6 text-zinc-100">
        <PageBackBar fallback="/kid" />
        <p className="mt-6 text-center text-zinc-300">{error ?? t('safeBrowser.noKidSession')}</p>
      </div>
    )
  }

  if (!device.browser_filter_enabled) {
    return (
      <div className="flex min-h-dvh flex-col bg-zinc-950 px-4 py-6 text-zinc-100">
        <PageBackBar fallback="/kid" />
        <p className="mt-6 text-center text-zinc-300">{t('safeBrowser.filterDisabled')}</p>
      </div>
    )
  }

  if (activeHost && isHostWhitelisted(activeHost, whitelist)) {
    return (
      <div className="flex min-h-dvh flex-col bg-zinc-950">
        <SafeBrowserFrame host={activeHost} whitelist={whitelist} onClose={() => navigate('/kid')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <div className="px-4 pt-2">
        <PageBackBar fallback="/kid" flush />
      </div>
      <div className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-300">
            <Globe className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">{t('safeBrowser.title')}</h1>
            <p className="text-sm text-zinc-400">{t('safeBrowser.subtitle')}</p>
          </div>
        </div>

        {whitelist.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            {t('safeBrowser.emptyList')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {whitelist.map((host) => (
              <li key={host}>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-auto w-full justify-start gap-3 px-4 py-3.5 text-start"
                  onClick={() => {
                    const url = buildSafeBrowserUrl(host)
                    if (url) setActiveHost(host)
                  }}
                >
                  <Globe className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
                  <span className="truncate font-medium" dir="ltr">
                    {host}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
