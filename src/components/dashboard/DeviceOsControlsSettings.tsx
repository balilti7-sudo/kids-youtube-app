import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Globe, ShieldOff, Plus, Trash2, Accessibility, Youtube } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useDeviceStore } from '../../stores/deviceStore'
import type { Device } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  getParentalControlStatus,
  isParentalControlNativeAvailable,
  normalizeWhitelistHost,
  openParentalControlAccessibilitySettings,
} from '../../lib/parentalControlNative'

type Props = {
  device: Device
  className?: string
}

function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  icon,
  accentCheckedClass = 'checked:bg-rose-500',
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  icon: ReactNode
  accentCheckedClass?: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-rose-300" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm font-semibold text-zinc-100">{label}</span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={checked}
            className={cn(
              'h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-700 transition disabled:opacity-50',
              accentCheckedClass
            )}
            style={{
              backgroundImage: checked
                ? 'radial-gradient(circle at 1.35rem center, white 0.55rem, transparent 0.56rem)'
                : 'radial-gradient(circle at 0.35rem center, white 0.55rem, transparent 0.56rem)',
            }}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{description}</p>
      </div>
    </div>
  )
}

/**
 * Dual parental controls for a child device:
 * 1) OS-level YouTube app + youtube.com block (`block_youtube_app`)
 * 2) Strict browser whitelist (`browser_filter_enabled` / `browser_whitelist`
 *    — product aliases: block_browser_enabled / allowed_urls)
 *
 * Persists via Supabase RPCs; syncs to Android Accessibility prefs via
 * `syncParentalControlPolicy` inside `deviceStore.updateDeviceSettings`.
 */
export function DeviceOsControlsSettings({ device, className }: Props) {
  const { t } = useTranslation()
  const updateDeviceSettings = useDeviceStore((s) => s.updateDeviceSettings)
  const [blockYoutube, setBlockYoutube] = useState(Boolean(device.block_youtube_app))
  const [browserFilter, setBrowserFilter] = useState(Boolean(device.browser_filter_enabled))
  const [whitelist, setWhitelist] = useState<string[]>(
    Array.isArray(device.browser_whitelist) ? device.browser_whitelist : []
  )
  const [draftSite, setDraftSite] = useState('')
  const [saving, setSaving] = useState(false)
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false)
  const native = useMemo(() => isParentalControlNativeAvailable(), [])

  useEffect(() => {
    setBlockYoutube(Boolean(device.block_youtube_app))
    setBrowserFilter(Boolean(device.browser_filter_enabled))
    setWhitelist(Array.isArray(device.browser_whitelist) ? device.browser_whitelist : [])
  }, [device.id, device.block_youtube_app, device.browser_filter_enabled, device.browser_whitelist])

  useEffect(() => {
    if (!native) return
    void getParentalControlStatus().then((s) => setAccessibilityEnabled(s.accessibilityEnabled))
  }, [native, blockYoutube, browserFilter])

  const persist = async (updates: {
    blockYoutubeApp?: boolean
    browserFilterEnabled?: boolean
    browserWhitelist?: string[]
  }) => {
    setSaving(true)
    const { error } = await updateDeviceSettings(device.id, updates)
    setSaving(false)
    if (error) {
      toast.error(t('parentalOs.saveFailed'), { description: error.message })
      setBlockYoutube(Boolean(device.block_youtube_app))
      setBrowserFilter(Boolean(device.browser_filter_enabled))
      setWhitelist(Array.isArray(device.browser_whitelist) ? device.browser_whitelist : [])
      return false
    }
    return true
  }

  const addSite = async () => {
    const host = normalizeWhitelistHost(draftSite)
    if (!host) {
      toast.error(t('parentalOs.invalidHost'), { description: t('parentalOs.invalidHostHint') })
      return
    }
    if (whitelist.includes(host)) {
      toast.message(t('parentalOs.alreadyListed'))
      setDraftSite('')
      return
    }
    const next = [...whitelist, host]
    setWhitelist(next)
    setDraftSite('')
    const ok = await persist({ browserWhitelist: next })
    if (ok) toast.success(t('parentalOs.siteAdded', { host }))
  }

  const removeSite = async (host: string) => {
    const next = whitelist.filter((h) => h !== host)
    setWhitelist(next)
    const ok = await persist({ browserWhitelist: next })
    if (ok) toast.success(t('parentalOs.siteRemoved', { host }))
  }

  const needsAccessibility = (blockYoutube || browserFilter) && native && !accessibilityEnabled

  return (
    <div
      className={cn(
        'rounded-xl border border-rose-500/25 bg-rose-950/20 px-3 py-3 ring-1 ring-rose-500/10',
        className
      )}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-rose-200/90">
        {t('parentalOs.sectionTitle')}
      </p>

      <div className="flex flex-col gap-4">
        <SwitchRow
          icon={<Youtube className="h-4 w-4" />}
          label={t('parentalOs.youtubeBlockLabel')}
          description={
            blockYoutube ? t('parentalOs.youtubeBlockHintOn') : t('parentalOs.youtubeBlockHintOff')
          }
          checked={blockYoutube}
          disabled={saving}
          onChange={(next) => {
            setBlockYoutube(next)
            void persist({ blockYoutubeApp: next }).then((ok) => {
              if (ok) {
                toast.success(next ? t('parentalOs.youtubeBlockedToast') : t('parentalOs.youtubeUnblockedToast'))
              }
            })
          }}
        />

        <SwitchRow
          icon={<ShieldOff className="h-4 w-4" />}
          label={t('parentalOs.browserBlockLabel')}
          description={
            browserFilter ? t('parentalOs.browserBlockHintOn') : t('parentalOs.browserBlockHintOff')
          }
          checked={browserFilter}
          disabled={saving}
          accentCheckedClass="checked:bg-amber-500"
          onChange={(next) => {
            setBrowserFilter(next)
            void persist({ browserFilterEnabled: next }).then((ok) => {
              if (ok) {
                toast.success(
                  next ? t('parentalOs.browserBlockedToast') : t('parentalOs.browserUnblockedToast')
                )
              }
            })
          }}
        />

        {browserFilter ? (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2.5">
            <div className="mb-2 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
              <p className="text-xs font-semibold text-zinc-200">{t('parentalOs.allowedSites')}</p>
            </div>
            <div className="mb-2 flex gap-2">
              <Input
                value={draftSite}
                onChange={(e) => setDraftSite(e.target.value)}
                placeholder={t('parentalOs.sitePlaceholder')}
                className="!bg-zinc-900"
                aria-label={t('parentalOs.sitePlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addSite()
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="!px-3"
                disabled={saving}
                onClick={() => void addSite()}
                aria-label={t('parentalOs.addSite')}
              >
                <Plus className="h-4 w-4" />
                <span className="ms-1 hidden sm:inline">{t('parentalOs.addSite')}</span>
              </Button>
            </div>
            {whitelist.length === 0 ? (
              <p className="text-xs text-amber-200/90">{t('parentalOs.emptyWhitelist')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5" aria-label={t('parentalOs.allowedSites')}>
                {whitelist.map((host) => (
                  <li
                    key={host}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-900/90 py-1 pe-1 ps-2.5 text-sm text-zinc-100 ring-1 ring-zinc-700/80"
                  >
                    <span className="truncate" dir="ltr">
                      {host}
                    </span>
                    <button
                      type="button"
                      className="rounded-full p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-rose-300"
                      aria-label={t('parentalOs.removeSite', { host })}
                      disabled={saving}
                      onClick={() => void removeSite(host)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {needsAccessibility ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Accessibility className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-50">{t('parentalOs.a11yTitle')}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/85">{t('parentalOs.a11yBody')}</p>
                <Button
                  type="button"
                  className="mt-2 !py-2 text-xs"
                  onClick={() => void openParentalControlAccessibilitySettings()}
                >
                  {t('parentalOs.openA11ySettings')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {!native ? <p className="text-xs text-zinc-500">{t('parentalOs.webOnlyNote')}</p> : null}
      </div>
    </div>
  )
}
