import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useSubscription } from '../../hooks/useSubscription'
import { useDeviceStore } from '../../stores/deviceStore'
import { QRCodeDisplay } from './QRCodeDisplay'
import { DeviceList } from './DeviceList'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { toast } from 'sonner'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ErrorState } from '../ui/ErrorState'

function randomSixDigits() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function DeviceLinkingScreen() {
  const { user, profile } = useAuth()
  const { ownerUserId, isDevFallback } = useDeviceOwnerId()
  const { devices, loading, error, refetch } = useDevices(ownerUserId)
  const { subscription } = useSubscription(ownerUserId)
  const addDevice = useDeviceStore((s) => s.addDevice)
  const removeDevice = useDeviceStore((s) => s.removeDevice)

  const [name, setName] = useState('מכשיר חדש')
  const [code, setCode] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const max = subscription?.max_devices ?? 3
  const atLimit = devices.length >= max

  const generate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('חסר שם מכשיר', {
        description: 'הזינו שם למכשיר (למשל: האייפד של יואב) ונסו שוב.',
      })
      return
    }

    if (!ownerUserId) {
      toast.error('חסר מזהה משתמש לשמירת מכשיר')
      return
    }

    if (atLimit) {
      toast.error('הגעתם למגבלת המכשירים', { description: `מקסימום ${max} מכשירים בתוכנית הנוכחית.` })
      return
    }

    if (profile && user && profile.id !== user.id) {
      console.error('Connection Error: profile.id !== user.id', { profileId: profile.id, authId: user.id })
    }

    setCreating(true)
    const pairing = randomSixDigits()
    try {
      const { data, error: err } = await addDevice({
        userId: ownerUserId,
        name: trimmedName,
        device_type: 'tablet',
        pairing_code: pairing,
      })

      if (err) {
        console.error('Connection Error:', err)
        toast.error('שמירת המכשיר נכשלה', {
          description: err.message,
          duration: 12_000,
        })
        return
      }

      if (data) {
        setCode(pairing)
        toast.success('המכשיר נשמר ב-Supabase', {
          description: `קוד החיבור: ${pairing}`,
        })
        await refetch()
      }
    } catch (e) {
      console.error('Connection Error:', e)
      toast.error('שגיאה בלתי צפויה', {
        description: e instanceof Error ? e.message : String(e),
        duration: 12_000,
      })
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error: err } = await removeDevice(id)
    if (err) {
      console.error('Connection Error:', err)
      toast.error('מחיקת המכשיר נכשלה', { description: err.message, duration: 10_000 })
      return
    }
    toast.success('המכשיר הוסר')
    await refetch()
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 pb-4">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">חיבור מכשיר</h1>
        <p className="text-sm text-slate-600 dark:text-zinc-400">
          מכשירים: {devices.length} / {max}
        </p>
      </header>

      {isDevFallback ? (
        <div
          className="rounded-2xl border border-amber-800/50 bg-amber-950/40 px-4 py-3 text-xs leading-relaxed text-amber-100/90 shadow-sm"
          role="status"
        >
          <p className="font-semibold text-amber-50">מצב פיתוח</p>
          <p className="mt-1">
            נעשה שימוש ב־user_id דמה (localStorage). אם INSERT נכשל בגלל FK ל־profiles, הוסיפו ל־.env את{' '}
            <code className="rounded bg-black/30 px-1" dir="ltr">
              VITE_DEV_DEVICE_OWNER_ID
            </code>{' '}
            עם UUID קיים.
          </p>
        </div>
      ) : null}

      {error ? <ErrorState message={error} onRetry={() => refetch?.()} /> : null}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 dark:bg-zinc-900 dark:ring-zinc-800">
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-zinc-300">שם המכשיר</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mb-3" />
        <Button
          type="button"
          className="w-full"
          onClick={() => void generate()}
          disabled={creating || loading || atLimit || !ownerUserId}
        >
          {creating ? (
            <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" />
          ) : null}
          {creating ? 'שומר ב-Supabase…' : 'צור קוד חיבור ושמור מכשיר'}
        </Button>
      </div>

      {code ? <QRCodeDisplay code={code} /> : null}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-zinc-200">מכשירים מקושרים</h2>
        {loading ? (
          <LoadingSpinner className="mx-auto border-brand-500 border-t-transparent" />
        ) : (
          <DeviceList devices={devices} onDelete={(id) => void handleDelete(id)} />
        )}
      </div>
    </div>
  )
}
