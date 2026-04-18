import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, QrCode, Smartphone, Trash2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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
import { toast } from 'sonner'

function randomSixDigits() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** קישור מלא ל־SPA: תמיד `/kid?code=######` (אין התחברות הורה בצימוד) */
function kidModePairUrl(origin: string, pairingCode: string) {
  const base = origin.replace(/\/$/, '')
  const code = String(pairingCode).trim()
  const params = new URLSearchParams({ code })
  return `${base}/kid?${params.toString()}`
}

export function DashboardDevicesSection() {
  /** כתובת האתר ל־QR — בפרודקשן כדאי להגדיר VITE_APP_URL אם הדומיין שונה מ־origin הנוכחי */
  const appOrigin = useMemo(() => {
    const fromEnv = import.meta.env.VITE_APP_URL as string | undefined
    if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
    if (typeof window !== 'undefined') return window.location.origin
    return 'https://kids-youtube-app.vercel.app'
  }, [])

  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)
  const removeDevice = useDeviceStore((s) => s.removeDevice)

  const [modalOpen, setModalOpen] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrDeviceId, setQrDeviceId] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [saving, setSaving] = useState(false)

  const devicesWithPairingCode = useMemo(
    () => devices.filter((d) => d.pairing_code && String(d.pairing_code).trim()),
    [devices]
  )
  const selectedForQr = devices.find((d) => d.id === qrDeviceId) ?? null
  const pairUrl =
    selectedForQr?.pairing_code != null && String(selectedForQr.pairing_code).trim()
      ? kidModePairUrl(appOrigin, String(selectedForQr.pairing_code).trim())
      : null

  useEffect(() => {
    if (!qrModalOpen) return
    if (!qrDeviceId || !devicesWithPairingCode.some((d) => d.id === qrDeviceId)) {
      setQrDeviceId(devicesWithPairingCode[0]?.id ?? null)
    }
  }, [qrModalOpen, qrDeviceId, devicesWithPairingCode])

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  const openModal = () => {
    setDeviceName("טאבלט הבן")
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
  }

  const handleAdd = async () => {
    const name = deviceName.trim()
    if (!name) {
      toast.error('נא להזין שם למכשיר')
      return
    }
    if (!ownerUserId) {
      toast.error('חסר מזהה משתמש לשמירת מכשיר')
      return
    }
    if (atLimit) {
      toast.error(`הגעת למגבלה (${max} מכשירים)`)
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
        toast.success('המכשיר נוסף', {
          description: 'על מסך הילד: הזינו את קוד הצימוד או סריקת QR. QR נוח גם מטלפון נוסף של ההורה.',
        })
        await refetch()
        setModalOpen(false)
        setDeviceName('')
        setQrDeviceId(data.id)
        setQrModalOpen(true)
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error('שגיאה', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error: err } = await removeDevice(id)
    if (err) {
      console.error('Connection Error:', err)
      toast.error('מחיקה נכשלה', { description: err.message })
      return
    }
    toast.success('המכשיר הוסר')
    await refetch()
  }

  return (
    <section
      className="rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5"
      aria-labelledby="devices-section-title"
    >
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <h2 id="devices-section-title" className="text-lg font-bold text-zinc-50">
            מכשירים
          </h2>
          <p className="text-xs text-zinc-500">מכשירים מקושרים: {devices.length} / {max}</p>
        </div>

        <div className="rounded-2xl border border-zinc-700/90 bg-zinc-950/70 p-3 ring-1 ring-zinc-800/80">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">חיבור לילד</p>
          <p className="mb-3 text-[13px] leading-snug text-zinc-400">
            יוצרים מכשיר, ואז על <strong className="font-semibold text-zinc-300">מסך הילד</strong> מזינים את קוד הצימוד (או סריקה). QR למטה — בעיקר לטלפון נוסף של ההורה.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full justify-center py-3 text-[15px] font-bold shadow-md shadow-black/20"
              onClick={openModal}
              disabled={atLimit || !ownerUserId}
            >
              <Plus className="h-5 w-5" />
              צור מכשיר חדש
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center border border-zinc-600/80 bg-zinc-900/80 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
              onClick={() => {
                setQrDeviceId(devicesWithPairingCode[0]?.id ?? null)
                setQrModalOpen(true)
              }}
              disabled={devicesWithPairingCode.length === 0}
            >
              <QrCode className="h-4 w-4" />
              הצג QR (מכשיר נוסף)
            </Button>
          </div>
          {devicesWithPairingCode.length === 0 && devices.length > 0 ? (
            <p className="mt-2 text-center text-[11px] text-zinc-500">
              כל המכשירים כבר הוצמדו — אין QR פעיל. צרו מכשיר חדש אם צריך להעביר עוד טאבלט.
            </p>
          ) : devicesWithPairingCode.length === 0 && devices.length === 0 ? (
            <p className="mt-2 text-center text-[11px] text-zinc-500">אחרי &quot;צור מכשיר&quot; יופיע כאן גם QR.</p>
          ) : null}
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
        <p className="mb-3 text-xs text-amber-400/90">הגעתם למגבלת המכשירים בתוכנית הנוכחית.</p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 py-8 text-center">
          <Smartphone className="h-10 w-10 text-zinc-600" aria-hidden />
          <p className="text-sm font-medium text-zinc-300">אין מכשירים עדיין</p>
          <p className="max-w-xs text-xs text-zinc-500">
            צרו מכשיר כאן, ואז על <strong className="font-semibold text-zinc-400">מסך הילד</strong> הזינו את קוד הצימוד (או סריקה אופציונלית). QR מיועד בעיקר לטלפון נוסף של ההורה.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-3 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-100">{d.name}</p>
                <p className="text-xs text-zinc-500">
                  {d.pairing_code ? (
                    <span dir="ltr">קוד: {d.pairing_code}</span>
                  ) : (
                    'ללא קוד חיבור'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    d.is_online
                      ? 'bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-800/80'
                      : 'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700'
                  }`}
                >
                  {d.is_online ? 'מקוון' : 'לא מקוון'}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  className="!px-3 !py-2 text-xs"
                  onClick={() => void handleDelete(d.id)}
                  aria-label={`מחק ${d.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                  מחק
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-center">
        <Link
          to="/devices"
          className="text-sm font-medium text-brand-400 underline-offset-2 hover:text-brand-300 hover:underline"
        >
          קוד חיבור וניהול מתקדם
        </Link>
      </p>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="מכשיר חדש"
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
        <p className="mb-3 text-sm text-zinc-400">שם ידידותי למכשיר (למשל: טאבלט הבן).</p>
        <label className="mb-1 block text-sm font-medium text-zinc-300">שם המכשיר</label>
        <Input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="למשל: טאבלט הבן"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
        />
      </Modal>

      <Modal
        open={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        title="QR לצפייה ממכשיר נוסף (אופציונלי)"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setQrModalOpen(false)}>
              סגור
            </Button>
            <Button
              type="button"
              disabled={!pairUrl}
              onClick={() => {
                if (!pairUrl) return
                void navigator.clipboard.writeText(pairUrl)
                toast.success('הקישור עם קוד החיבור הועתק')
              }}
            >
              העתק קישור
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-center">
          <p className="text-sm leading-relaxed text-zinc-300">
            <strong className="text-zinc-200">הגדרה ראשית:</strong> על מסך הילד הזינו את קוד הצימוד או התחברו שם כהורה. QR כאן נוח כשההורה רוצה לפתוח את מצב הילד <strong className="text-zinc-200">מטלפון אחר</strong> לצפייה — לא חובה להתקנה על הטאבלט.
          </p>
          {devicesWithPairingCode.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-600 bg-zinc-950/50 px-3 py-4 text-sm text-zinc-400">
              אין כרגע מכשיר עם קוד חיבור פתוח (או שכל המכשירים כבר מחוברים). הוסיפו מכשיר חדש כדי לקבל QR.
              <Button type="button" className="mt-3 w-full" onClick={() => { setQrModalOpen(false); openModal() }}>
                צור מכשיר חדש
              </Button>
            </div>
          ) : (
            <>
              <label className="block text-right text-xs font-medium text-zinc-400">מכשיר לחיבור</label>
              <select
                className="w-full rounded-xl border border-zinc-600 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100"
                value={qrDeviceId ?? ''}
                onChange={(e) => setQrDeviceId(e.target.value || null)}
              >
                {devicesWithPairingCode.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · קוד {d.pairing_code}
                  </option>
                ))}
              </select>
              {pairUrl ? (
                <>
                  <div className="mx-auto rounded-2xl bg-white p-3">
                    <QRCodeSVG value={pairUrl} size={220} />
                  </div>
                  <p className="break-all text-xs text-zinc-500" dir="ltr">
                    {pairUrl}
                  </p>
                </>
              ) : null}
            </>
          )}
        </div>
      </Modal>
    </section>
  )
}
