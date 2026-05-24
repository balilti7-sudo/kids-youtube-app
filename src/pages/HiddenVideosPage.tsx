import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeOff, Link as LinkIcon, Lock } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../hooks/useAuth'
import { useDevices } from '../hooks/useDevices'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useLocalParentManagement } from '../hooks/useLocalParentManagement'
import { verifyParentManagementPin } from '../lib/verifyParentManagementPin'
import {
  clearAllHiddenVideosAuthenticated,
  clearAllHiddenVideosLocalParent,
  listHiddenVideosAuthenticated,
  listHiddenVideosLocalParent,
  type HiddenVideoRow,
} from '../lib/hiddenVideos'
import { HideVideoButton } from '../components/channels/HideVideoButton'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ParentalPinModal } from '../components/parental/ParentalPinModal'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'

export function HiddenVideosPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const localParent = useLocalParentManagement()
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [items, setItems] = useState<HiddenVideoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [accessGranted, setAccessGranted] = useState(false)
  const [pinVerified, setPinVerified] = useState(false)
  const [unblockAllOpen, setUnblockAllOpen] = useState(false)
  const [unblockAllBusy, setUnblockAllBusy] = useState(false)
  const verifiedPinRef = useRef<string | null>(null)
  const prevDeviceIdRef = useRef<string | null>(null)

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

  const lockAccess = useCallback(() => {
    setAccessGranted(false)
    setPinVerified(false)
    setItems([])
    setError(null)
    verifiedPinRef.current = null
    setPinOpen(false)
  }, [])

  const loadList = useCallback(
    async (pin: string) => {
      setLoading(true)
      setError(null)

      if (localParent.isActive && localParent.localAccessToken) {
        try {
          const { data, error: listErr } = await listHiddenVideosLocalParent(
            localParent.localAccessToken,
            pin
          )
          if (listErr) {
            setItems([])
            setError(listErr.message)
            setAccessGranted(false)
            setPinVerified(false)
            verifiedPinRef.current = null
            return
          }
          setItems(data)
          verifiedPinRef.current = pin
          setAccessGranted(true)
        } finally {
          setLoading(false)
        }
        return
      }

      if (!deviceId) {
        if (devLoading) return
        setItems([])
        setError('לא נמצא מכשיר. הוסיפו מכשיר בהגדרות.')
        setAccessGranted(false)
        setPinVerified(false)
        verifiedPinRef.current = null
        setLoading(false)
        return
      }

      try {
        const { data, error: listErr } = await listHiddenVideosAuthenticated(deviceId, pin)
        if (listErr) {
          setItems([])
          setError(listErr.message)
          setAccessGranted(false)
          setPinVerified(false)
          verifiedPinRef.current = null
          return
        }
        setItems(data)
        verifiedPinRef.current = pin
        setAccessGranted(true)
      } finally {
        setLoading(false)
      }
    },
    [deviceId, devLoading, localParent.isActive, localParent.localAccessToken]
  )

  const prevLocalActiveRef = useRef<boolean | null>(null)

  useEffect(() => {
    const prev = prevLocalActiveRef.current
    prevLocalActiveRef.current = localParent.isActive
    if (prev !== null && prev !== localParent.isActive) {
      lockAccess()
    }
  }, [localParent.isActive, lockAccess])

  useEffect(() => {
    const prev = prevDeviceIdRef.current
    prevDeviceIdRef.current = deviceId
    if (prev != null && deviceId != null && prev !== deviceId) {
      lockAccess()
    }
  }, [deviceId, lockAccess])

  useEffect(() => {
    const pin = verifiedPinRef.current
    if (!pin || !pinVerified || accessGranted || localParent.isActive) return
    if (!deviceId || devLoading) return
    void loadList(pin)
  }, [pinVerified, accessGranted, localParent.isActive, deviceId, devLoading, loadList])

  const handlePinVerified = useCallback(
    (pin: string) => {
      verifiedPinRef.current = pin
      setPinVerified(true)
      setPinOpen(false)
      setError(null)
      void loadList(pin)
    },
    [loadList]
  )

  const handlePinClose = useCallback(() => {
    setPinOpen(false)
    if (!accessGranted) {
      navigate('/settings', { replace: true })
    }
  }, [accessGranted, navigate])

  const handleUnblockAllConfirm = useCallback(async () => {
    const pin = verifiedPinRef.current
    if (!pin) {
      lockAccess()
      return
    }

    setUnblockAllBusy(true)
    try {
      let result: { deleted: number; error: Error | null }
      if (localParent.isActive && localParent.localAccessToken) {
        result = await clearAllHiddenVideosLocalParent(localParent.localAccessToken, pin)
      } else if (deviceId) {
        result = await clearAllHiddenVideosAuthenticated(deviceId, pin)
      } else {
        toast.error('לא נבחר מכשיר')
        return
      }

      if (result.error) {
        toast.error(result.error.message)
        if (result.error.message.includes('קוד הורה')) lockAccess()
        return
      }

      setItems([])
      setUnblockAllOpen(false)
      toast.success(
        result.deleted > 0 ? `שוחררו ${result.deleted} סרטונים` : 'כל החסימות שוחררו'
      )
    } finally {
      setUnblockAllBusy(false)
    }
  }, [deviceId, localParent.isActive, localParent.localAccessToken, lockAccess])

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

      {!accessGranted && !pinVerified ? (
        <section className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/50 px-6 py-12 text-center dark:border-amber-800/60 dark:bg-amber-950/20">
          <Lock className="h-14 w-14 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="max-w-sm text-base font-semibold text-slate-800 dark:text-zinc-100">
            אזור מוגן — נדרש קוד הורה
          </p>
          <p className="max-w-md text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
            רשימת הסרטונים החסומים ופעולות ההחזרה זמינות רק לאחר אימות קוד ההורה.
          </p>
          {error ? (
            <p className="max-w-md text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <Button type="button" onClick={() => setPinOpen(true)}>
            הזינו קוד הורה
          </Button>
        </section>
      ) : !accessGranted && pinVerified ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 py-16">
          <LoadingSpinner className="h-9 w-9 border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">טוען סרטונים חסומים…</p>
        </div>
      ) : (
        <>
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
            <div className="space-y-3 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <Button type="button" variant="secondary" onClick={() => lockAccess()}>
                נסו שוב עם קוד הורה
              </Button>
            </div>
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
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-600 dark:text-zinc-400">
                  {items.length} סרטונים חסומים
                </p>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setUnblockAllOpen(true)}
                  disabled={unblockAllBusy}
                >
                  שחרור הכל
                </Button>
              </div>
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
            </>
          )}

          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              const pin = verifiedPinRef.current
              if (pin) void loadList(pin)
              else lockAccess()
            }}
          >
            רענן רשימה
          </Button>
        </>
      )}

      <Modal
        open={unblockAllOpen}
        onClose={() => !unblockAllBusy && setUnblockAllOpen(false)}
        title="שחרור כל החסימות"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUnblockAllOpen(false)}
              disabled={unblockAllBusy}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void handleUnblockAllConfirm()}
              disabled={unblockAllBusy}
            >
              {unblockAllBusy ? 'משחרר…' : 'אישור'}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          האם אתה בטוח שברצונך לשחרר את כל החסימות?
        </p>
      </Modal>

      <ParentalPinModal
        open={pinOpen}
        onClose={handlePinClose}
        verifyPin={verifyPin}
        onVerified={handlePinVerified}
        title="אימות הורה — רשימת חסומים"
        description="הזינו קוד הורה כדי לצפות ברשימת הסרטונים החסומים במכשיר הזה."
      />
    </div>
  )
}
