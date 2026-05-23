import { useCallback, useEffect, useState } from 'react'
import { EyeOff, Link as LinkIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDevices } from '../hooks/useDevices'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useLocalParentManagement } from '../hooks/useLocalParentManagement'
import { verifyParentManagementPin } from '../lib/verifyParentManagementPin'
import {
  listHiddenVideosForDevice,
  listHiddenVideosLocalParent,
  type HiddenVideoRow,
} from '../lib/hiddenVideos'
import { HideVideoButton } from '../components/channels/HideVideoButton'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { Button } from '../components/ui/Button'

export function HiddenVideosPage() {
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [items, setItems] = useState<HiddenVideoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinOpen, setPinOpen] = useState(false)

  useEffect(() => {
    if (!deviceId && devices[0]?.id) setDeviceId(devices[0].id)
  }, [devices, deviceId])

  const verifyPin = useCallback(
    (pin: string) =>
      verifyParentManagementPin(
        {
          userId: user?.id,
          profile,
          localParent: { isActive: localParent.isActive, pin: localParent.pin },
        },
        pin
      ),
    [user?.id, profile, localParent.isActive, localParent.pin]
  )

  const loadList = useCallback(
    async (pin?: string) => {
      if (localParent.isActive && localParent.localAccessToken) {
        if (!pin) {
          setPinOpen(true)
          return
        }
        setLoading(true)
        setError(null)
        const { data, error: listErr } = await listHiddenVideosLocalParent(
          localParent.localAccessToken,
          pin
        )
        setLoading(false)
        if (listErr) {
          setError(listErr.message)
          setItems([])
          return
        }
        setItems(data)
        return
      }

      if (!deviceId) {
        setItems([])
        return
      }
      setLoading(true)
      setError(null)
      const { data, error: listErr } = await listHiddenVideosForDevice(deviceId)
      setLoading(false)
      if (listErr) {
        setError(listErr.message)
        setItems([])
        return
      }
      setItems(data)
    },
    [deviceId, localParent.isActive, localParent.localAccessToken]
  )

  useEffect(() => {
    if (localParent.isActive && localParent.localAccessToken) {
      setPinOpen(true)
      return
    }
    if (deviceId) void loadList()
  }, [deviceId, localParent.isActive, localParent.localAccessToken, loadList])

  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null

  return (
    <div className="mx-auto max-w-3xl px-3 pb-28 pt-4 sm:px-4">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-zinc-50">
          <EyeOff className="h-7 w-7 text-amber-600" aria-hidden />
          סרטונים חסומים
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400">
          סרטונים שהוסתרו מהילד לא מופיעים בערוצים. כאן אפשר להחזיר אותם לערוץ — נדרש קוד הורה.
        </p>
      </header>

      {devices.length > 1 ? (
        <select
          className="mb-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={deviceId ?? ''}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : selectedDevice ? (
        <p className="mb-4 text-sm text-slate-600 dark:text-zinc-400">
          מכשיר: <strong>{selectedDevice.name}</strong>
        </p>
      ) : null}

      {devLoading || loading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-12 text-center dark:border-zinc-700">
          <p className="text-sm text-slate-600 dark:text-zinc-400">אין סרטונים חסומים למכשיר הזה.</p>
          <Link
            to="/channels"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 dark:text-brand-400"
          >
            <LinkIcon className="h-4 w-4" aria-hidden />
            לניהול ערוצים
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((v) => (
            <li
              key={v.youtube_video_id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="flex min-w-0 flex-1 gap-3">
                {v.thumbnail_url ? (
                  <img
                    src={v.thumbnail_url}
                    alt=""
                    className="h-16 w-28 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500 dark:bg-zinc-800">
                    וידאו
                  </div>
                )}
                <div className="min-w-0">
                  <p className="line-clamp-2 font-semibold text-slate-900 dark:text-zinc-100">{v.title}</p>
                  {v.channel_name ? (
                    <p className="mt-0.5 text-xs text-slate-500">{v.channel_name}</p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-slate-400" dir="ltr">
                    {v.youtube_video_id}
                  </p>
                </div>
              </div>
              <HideVideoButton
                deviceId={deviceId}
                localAccessToken={localParent.localAccessToken}
                verifyPin={verifyPin}
                action="unhide"
                compact
                video={{
                  youtube_video_id: v.youtube_video_id,
                  title: v.title,
                  thumbnail_url: v.thumbnail_url,
                  youtube_channel_id: v.youtube_channel_id,
                  channel_name: v.channel_name,
                }}
                onSuccess={() => {
                  setItems((prev) => prev.filter((x) => x.youtube_video_id !== v.youtube_video_id))
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        verifyPin={verifyPin}
        onVerified={(pin) => {
          setPinOpen(false)
          void loadList(pin)
        }}
        title="אימות הורה — רשימת חסומים"
        description="הזינו קוד הורה כדי לצפות ברשימת הסרטונים החסומים במכשיר הזה."
      />

      {!localParent.isActive && items.length > 0 ? (
        <Button type="button" variant="secondary" className="mt-4" onClick={() => void loadList()}>
          רענן רשימה
        </Button>
      ) : null}
    </div>
  )
}
