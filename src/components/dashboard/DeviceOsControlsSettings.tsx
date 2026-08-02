import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Globe, ShieldOff, Plus, Trash2, Accessibility } from 'lucide-react'
import { toast } from 'sonner'
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
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  icon: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
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
            className="h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-zinc-700 transition checked:bg-rose-500 disabled:opacity-50"
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

export function DeviceOsControlsSettings({ device, className }: Props) {
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
      toast.error('שמירה נכשלה', { description: error.message })
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
      toast.error('כתובת לא תקינה', { description: 'הזינו דומיין כמו wikipedia.org' })
      return
    }
    if (whitelist.includes(host)) {
      toast.message('האתר כבר ברשימה')
      setDraftSite('')
      return
    }
    const next = [...whitelist, host]
    setWhitelist(next)
    setDraftSite('')
    const ok = await persist({ browserWhitelist: next })
    if (ok) toast.success(`נוסף: ${host}`)
  }

  const removeSite = async (host: string) => {
    const next = whitelist.filter((h) => h !== host)
    setWhitelist(next)
    const ok = await persist({ browserWhitelist: next })
    if (ok) toast.success(`הוסר: ${host}`)
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
        חסימות מערכת (יוטיוב ודפדפן)
      </p>

      <div className="flex flex-col gap-4">
        <SwitchRow
          icon={<ShieldOff className="h-4 w-4" />}
          label="חסימת אפליקציית YouTube"
          description={
            blockYoutube
              ? 'פתיחת YouTube תיחסם (מסך לבן + חזרה למסך הבית). לא ניתן להסיר את האייקון בלי הרשאות מערכת — החסימה מונעת שימוש.'
              : 'כבוי: הילד יכול לפתוח את אפליקציית YouTube במכשיר.'
          }
          checked={blockYoutube}
          disabled={saving}
          onChange={(next) => {
            setBlockYoutube(next)
            void persist({ blockYoutubeApp: next }).then((ok) => {
              if (ok) toast.success(next ? 'YouTube ייחסם במכשיר' : 'חסימת YouTube בוטלה')
            })
          }}
        />

        <SwitchRow
          icon={<Globe className="h-4 w-4" />}
          label="סינון אתרים בדפדפן (רשימה לבנה)"
          description={
            browserFilter
              ? 'כל האתרים חסומים חוץ מאלה שברשימה למטה. ברירת מחדל: חסימה מלאה.'
              : 'כבוי: אין סינון אתרים ברמת הדפדפן.'
          }
          checked={browserFilter}
          disabled={saving}
          onChange={(next) => {
            setBrowserFilter(next)
            void persist({ browserFilterEnabled: next }).then((ok) => {
              if (ok) {
                toast.success(next ? 'סינון דפדפן הופעל' : 'סינון דפדפן כובה')
              }
            })
          }}
        />

        {browserFilter ? (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/50 p-2.5">
            <p className="mb-2 text-xs font-semibold text-zinc-200">אתרים מותרים</p>
            <div className="mb-2 flex gap-2">
              <Input
                value={draftSite}
                onChange={(e) => setDraftSite(e.target.value)}
                placeholder="למשל: wikipedia.org"
                className="!bg-zinc-900"
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
                aria-label="הוסף אתר"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {whitelist.length === 0 ? (
              <p className="text-xs text-amber-200/90">הרשימה ריקה — כל האתרים חסומים כרגע.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {whitelist.map((host) => (
                  <li
                    key={host}
                    className="flex items-center justify-between gap-2 rounded-md bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-100"
                  >
                    <span className="truncate" dir="ltr">
                      {host}
                    </span>
                    <button
                      type="button"
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-300"
                      aria-label={`הסר ${host}`}
                      disabled={saving}
                      onClick={() => void removeSite(host)}
                    >
                      <Trash2 className="h-4 w-4" />
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
                <p className="text-sm font-semibold text-amber-50">נדרשת הרשאת נגישות</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/85">
                  כדי לחסום את YouTube והדפדפן במכשיר, הפעילו את שירות SafeTube תחת הגדרות → נגישות.
                </p>
                <Button
                  type="button"
                  className="mt-2 !py-2 text-xs"
                  onClick={() => void openParentalControlAccessibilitySettings()}
                >
                  פתיחת הגדרות נגישות
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {!native ? (
          <p className="text-xs text-zinc-500">
            החסימות ברמת המערכת פועלות באפליקציית Android של SafeTube במכשיר הילד (לא בדפדפן).
          </p>
        ) : null}
      </div>
    </div>
  )
}
