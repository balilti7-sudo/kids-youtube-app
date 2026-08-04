import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Settings2, Smartphone } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useSubscription } from '../../hooks/useSubscription'
import { useDeviceStore } from '../../stores/deviceStore'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { ErrorState } from '../ui/ErrorState'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { AllowShortsDeviceSettings } from './AllowShortsDeviceSettings'
import { DailyTimeLimitDeviceSettings } from './DailyTimeLimitDeviceSettings'
import { DeviceOsControlsSettings } from './DeviceOsControlsSettings'
import { QRCodeDisplay } from '../devices/QRCodeDisplay'
import { toast } from 'sonner'
import type { Device } from '../../types'

function randomSixDigits() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function formatLimitBrief(minutes: number | undefined): string {
  const n = Number(minutes ?? 60)
  if (!Number.isFinite(n) || n < 0) return '60 דק׳'
  if (n === 0) return 'ללא הגבלה'
  if (n < 60) return `${Math.round(n)} דק׳`
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  if (m === 0) return h === 1 ? 'שעה' : `${h} שעות`
  return `${h}ש׳ ${m}ד׳`
}

function ProfileDeviceCard({
  device,
  expanded,
  onToggleExpanded,
  activeManagementDeviceId,
  onManageChannels,
  onShowPairing,
  regenerating,
  onRegeneratePairing,
}: {
  device: Device
  expanded: boolean
  onToggleExpanded: () => void
  activeManagementDeviceId?: string | null
  onManageChannels: (deviceId: string) => void
  onShowPairing: (device: Device) => void
  regenerating: boolean
  onRegeneratePairing: (deviceId: string) => void
}) {
  const limitLabel = formatLimitBrief(device.daily_time_limit_minutes)
  const shortsLabel = device.allow_shorts ? 'Shorts מותר' : 'Shorts חסום'
  const hasPairingCode = Boolean(device.pairing_code?.trim())

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-2.5 ring-1 ring-zinc-800/60">
      <div className="flex flex-row items-center justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-start"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={`profile-settings-${device.id}`}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800/90 text-zinc-400 ring-1 ring-zinc-700/80"
            aria-hidden
          >
            <Smartphone className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-zinc-100 sm:text-base">
              {device.name}
            </span>
            {!expanded ? (
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                {hasPairingCode ? (
                  <span className="text-amber-300/90">ממתין לצימוד · </span>
                ) : null}
                {limitLabel} · {shortsLabel}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200',
              expanded && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
        <Button
          type="button"
          variant="primary"
          className={cn(
            'h-9 shrink-0 justify-center gap-1.5 rounded-lg !px-4 !py-2 text-xs font-semibold sm:text-sm',
            activeManagementDeviceId === device.id &&
              'ring-2 ring-brand-300/80 ring-offset-1 ring-offset-zinc-950'
          )}
          onClick={() => onManageChannels(device.id)}
          aria-label={`ניהול ערוצים עבור ${device.name}`}
          aria-current={activeManagementDeviceId === device.id ? 'true' : undefined}
        >
          <Settings2 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">ניהול ערוצים</span>
        </Button>
      </div>

      {expanded ? (
        <div id={`profile-settings-${device.id}`} className="flex flex-col gap-2">
          <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 px-3 py-2.5 ring-1 ring-sky-500/10">
            <p className="text-sm font-semibold text-zinc-100">חיבור מכשיר הילד</p>
            {hasPairingCode ? (
              <>
                <p className="mt-1 text-xs text-zinc-400">
                  הזינו את הקוד במסך הילד, או הציגו QR מלא:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="!h-9 !px-3 !text-xs font-bold"
                    onClick={() => onShowPairing(device)}
                  >
                    הצגת קוד ו־QR
                  </Button>
                  <p className="self-center font-mono text-lg font-bold tracking-[0.2em] text-sky-200" dir="ltr">
                    {device.pairing_code}
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-zinc-400">
                  הפרופיל כבר חובר, או שהקוד פג. אפשר ליצור קוד חדש לחיבור מחדש.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2 !h-9 !px-3 !text-xs"
                  disabled={regenerating}
                  onClick={() => onRegeneratePairing(device.id)}
                >
                  {regenerating ? 'יוצר…' : 'יצירת קוד צימוד חדש'}
                </Button>
              </>
            )}
          </div>
          <DailyTimeLimitDeviceSettings device={device} />
          <AllowShortsDeviceSettings device={device} />
          <DeviceOsControlsSettings device={device} />
        </div>
      ) : null}
    </li>
  )
}

export function DashboardDevicesSection({
  activeManagementDeviceId,
  onManageChannels,
  openAddProfileSignal = 0,
  showPairingSignal = 0,
}: {
  activeManagementDeviceId?: string | null
  onManageChannels: (deviceId: string) => void
  /** Increment to open the add-profile modal (from setup guide). */
  openAddProfileSignal?: number
  /** Increment to open pairing for the first profile that still has a code. */
  showPairingSignal?: number
}) {
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)
  const regeneratePairingCode = useDeviceStore((s) => s.regeneratePairingCode)

  const [modalOpen, setModalOpen] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [collapseSeeded, setCollapseSeeded] = useState(false)
  const [pairingModalDevice, setPairingModalDevice] = useState<Device | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  useEffect(() => {
    if (loading || collapseSeeded || devices.length === 0) return
    if (devices.length === 1) {
      setExpandedIds(new Set([devices[0].id]))
    } else {
      setExpandedIds(new Set())
    }
    setCollapseSeeded(true)
  }, [loading, devices, collapseSeeded])

  useEffect(() => {
    if (openAddProfileSignal > 0) {
      setDeviceName('פרופיל הילד')
      setModalOpen(true)
    }
  }, [openAddProfileSignal])

  useEffect(() => {
    if (showPairingSignal <= 0) return
    const pending = devices.find((d) => d.pairing_code?.trim())
    if (pending) {
      setPairingModalDevice(pending)
      setExpandedIds((prev) => new Set(prev).add(pending.id))
    } else if (devices[0]) {
      setExpandedIds((prev) => new Set(prev).add(devices[0].id))
      toast.info('אין קוד פעיל', { description: 'פתחו את הפרופיל ולחצו «יצירת קוד צימוד חדש».' })
    }
  }, [showPairingSignal, devices])

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openModal = () => {
    setDeviceName('פרופיל הילד')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
  }

  const handleRegenerate = async (deviceId: string) => {
    setRegeneratingId(deviceId)
    const { data, error: err } = await regeneratePairingCode(deviceId)
    setRegeneratingId(null)
    if (err) {
      toast.error('יצירת קוד נכשלה', { description: err.message })
      return
    }
    await refetch()
    const device = useDeviceStore.getState().devices.find((d) => d.id === deviceId)
    if (device && data) {
      setPairingModalDevice({ ...device, pairing_code: data })
      toast.success('קוד צימוד חדש מוכן')
    }
  }

  const handleAdd = async () => {
    const name = deviceName.trim()
    if (!name) {
      toast.error('נא להזין שם לפרופיל')
      return
    }
    if (!ownerUserId) {
      toast.error('חסר מזהה משתמש לשמירת פרופיל')
      return
    }
    if (atLimit) {
      toast.error(`הגעת למגבלה (${max} פרופילים)`)
      return
    }

    setSaving(true)
    const pairing = randomSixDigits()
    try {
      const { data, error: err } = await addDevice({
        userId: ownerUserId,
        name,
        device_type: 'tablet',
        pairing_code: pairing,
      })
      if (err) {
        console.error('Connection Error:', err)
        toast.error('שמירה נכשלה', { description: err.message })
        return
      }
      if (data) {
        toast.success('הפרופיל נוסף', { description: `קוד הצימוד: ${pairing}` })
        setExpandedIds((prev) => new Set(prev).add(data.id))
        await refetch()
        setModalOpen(false)
        setDeviceName('')
        setPairingModalDevice({ ...data, pairing_code: pairing })
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error('שגיאה', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      id="dashboard-profiles"
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="profiles-section-title"
    >
      <div className="mb-2 flex flex-col gap-1.5">
        <div>
          <h2 id="profiles-section-title" className="text-lg font-bold text-zinc-50">
            פרופילים
          </h2>
          <p className="text-xs text-zinc-500">פרופילים מקושרים: {devices.length} / {max}</p>
        </div>

        <div
          className={cn(
            'rounded-xl border px-3 py-3',
            devices.length === 0
              ? 'border-sky-400/40 bg-sky-950/30 ring-1 ring-sky-400/25'
              : 'border-zinc-700/50 bg-zinc-950/40'
          )}
        >
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {devices.length === 0 ? 'צעד 1 — התחלה' : 'פרופילי ילדים'}
          </p>
          <p className="mb-3 text-[13px] leading-snug text-zinc-400">
            {devices.length === 0
              ? 'צרו פרופיל — מיד יופיע קוד צימוד לחיבור מכשיר הילד.'
              : 'מוסיפים פרופיל כאן; הוא משמש לצימוד מסך הילד ולהגדרת ההרשאות.'}
          </p>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[15px] font-bold text-zinc-900 shadow-md shadow-black/25 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
            onClick={openModal}
            disabled={atLimit || !ownerUserId}
          >
            <Plus className="h-5 w-5 shrink-0" aria-hidden />
            הוספת פרופיל
          </button>
        </div>
      </div>

      {isDevFallback ? (
        <p className="mb-3 rounded-xl border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs leading-relaxed text-amber-100/90">
          <span className="font-semibold text-amber-50">מצב פיתוח:</span> משתמשים ב־user_id דמה (נשמר ב־localStorage).
          אם יש FK ל־<code className="rounded bg-black/30 px-1">profiles</code>, הגדירו ב־.env את{' '}
          <code className="rounded bg-black/30 px-1">VITE_DEV_DEVICE_OWNER_ID</code> עם UUID קיים מ־profiles.
        </p>
      ) : null}
      {atLimit ? (
        <p className="mb-3 text-xs text-amber-400/90">הגעתם למגבלת הפרופילים בתוכנית הנוכחית.</p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 py-5 text-center">
          <Smartphone className="h-10 w-10 text-zinc-600" aria-hidden />
          <p className="text-sm font-medium text-zinc-300">אין פרופילים עדיין</p>
          <p className="max-w-xs text-xs text-zinc-500">לחצו «הוספת פרופיל» למעלה — זה הצעד הראשון לצפייה.</p>
          <Button type="button" onClick={openModal} disabled={!ownerUserId || atLimit}>
            הוספת פרופיל עכשיו
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <ProfileDeviceCard
              key={d.id}
              device={d}
              expanded={expandedIds.has(d.id)}
              onToggleExpanded={() => toggleExpanded(d.id)}
              activeManagementDeviceId={activeManagementDeviceId}
              onManageChannels={onManageChannels}
              onShowPairing={setPairingModalDevice}
              regenerating={regeneratingId === d.id}
              onRegeneratePairing={(id) => void handleRegenerate(id)}
            />
          ))}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="פרופיל חדש"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={saving}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void handleAdd()} disabled={saving}>
              {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
              {saving ? 'שומר…' : 'שמור'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-zinc-400">
          אחרי השמירה יוצג קוד צימוד — הזינו אותו במכשיר הילד כדי להתחיל.
        </p>
        <label className="mb-1 block text-sm font-medium text-zinc-300">שם הפרופיל</label>
        <Input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="למשל: פרופיל הילד"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
        />
      </Modal>

      <Modal
        open={Boolean(pairingModalDevice?.pairing_code)}
        onClose={() => setPairingModalDevice(null)}
        title="חברו את מכשיר הילד"
        bodyClassName="max-h-[75vh] overflow-y-auto"
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="secondary" onClick={() => setPairingModalDevice(null)}>
              סגור
            </Button>
            {pairingModalDevice ? (
              <Button
                type="button"
                onClick={() => {
                  const id = pairingModalDevice.id
                  setPairingModalDevice(null)
                  onManageChannels(id)
                }}
              >
                המשך — הוספת ערוצים
              </Button>
            ) : null}
          </div>
        }
      >
        {pairingModalDevice?.pairing_code ? (
          <>
            <p className="mb-3 text-sm leading-relaxed text-zinc-400">
              זה הצעד החשוב ביותר: במכשיר הילד פתחו את האפליקציה והזינו את הקוד, או סרקו את ה־QR.
            </p>
            <QRCodeDisplay
              code={pairingModalDevice.pairing_code}
              deviceName={pairingModalDevice.name}
            />
          </>
        ) : null}
      </Modal>
    </section>
  )
}
