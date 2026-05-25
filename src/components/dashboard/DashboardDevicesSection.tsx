import { useState } from 'react'
import { Plus, Smartphone, Trash2 } from 'lucide-react'
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

export function DashboardDevicesSection() {
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)
  const removeDevice = useDeviceStore((s) => s.removeDevice)

  const [modalOpen, setModalOpen] = useState(false)
  const [deviceName, setDeviceName] = useState('')
  const [saving, setSaving] = useState(false)

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  const openModal = () => {
    setDeviceName('פרופיל הילד')
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
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
        toast.success('הפרופיל נוסף', { description: 'הפרופיל זמין בהגדרות ובמסך הילד.' })
        await refetch()
        setModalOpen(false)
        setDeviceName('')
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
    toast.success('הפרופיל הוסר')
    await refetch()
  }

  return (
    <section
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

        <div className="rounded-2xl border border-zinc-700/90 bg-zinc-950/70 p-3 ring-1 ring-zinc-800/80">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">פרופילי ילדים</p>
          <p className="mb-3 text-[13px] leading-snug text-zinc-400">
            מוסיפים פרופיל כאן; הוא משמש לצימוד מסך הילד ולהגדרת ההרשאות.
          </p>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              className="w-full justify-center py-3 text-[15px] font-bold shadow-md shadow-black/20"
              onClick={openModal}
              disabled={atLimit || !ownerUserId}
            >
              <Plus className="h-5 w-5" />
              צור פרופיל חדש
            </Button>
          </div>
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
        <div className="flex flex-col gap-1">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/40 py-5 text-center">
          <Smartphone className="h-10 w-10 text-zinc-600" aria-hidden />
          <p className="text-sm font-medium text-zinc-300">אין פרופילים עדיין</p>
          <p className="max-w-xs text-xs text-zinc-500">צרו פרופיל חדש והמשיכו בהגדרת מסך הילד.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3 py-3 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-100">{d.name}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="danger"
                  className="!px-3 !py-2 text-xs"
                  onClick={() => void handleDelete(d.id)}
                  aria-label={`מחק פרופיל ${d.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                  מחק
                </Button>
              </div>
            </li>
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
        <p className="mb-3 text-sm text-zinc-400">שם ידידותי לפרופיל (למשל: פרופיל הילד).</p>
        <label className="mb-1 block text-sm font-medium text-zinc-300">שם הפרופיל</label>
        <Input
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          placeholder="למשל: פרופיל הילד"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
        />
      </Modal>
    </section>
  )
}
