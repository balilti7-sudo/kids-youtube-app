import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tv } from 'lucide-react'
import { useChannels } from '../hooks/useChannels'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

export function ChannelsPage() {
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devicesLoading } = useDevices(ownerUserId)
  const requestedDeviceId = searchParams.get('device')
  const [deviceId, setDeviceId] = useState<string | null>(null)

  useEffect(() => {
    if (devices.length === 0) return
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      setDeviceId(requestedDeviceId)
      return
    }
    setDeviceId((current) => (current && devices.some((d) => d.id === current) ? current : devices[0].id))
  }, [devices, requestedDeviceId])

  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const { whitelist, loading } = useChannels(deviceId ?? undefined, ownerUserId)

  const visibleChannels = useMemo(() => whitelist.filter((c) => c.youtube_channel_id), [whitelist])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 pb-4">
      <header className="rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/95 to-zinc-950 p-4 shadow-2xl shadow-black/15 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25">
            <Tv className="h-7 w-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-zinc-50">ערוצים</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {selectedDevice ? `הערוצים המאושרים של ${selectedDevice.name}` : 'כל הערוצים המאושרים לצפייה.'}
            </p>
          </div>
        </div>
      </header>

      {devicesLoading || loading ? (
        <div className="flex min-h-48 items-center justify-center gap-3 rounded-3xl border border-zinc-800 bg-zinc-950/60 text-zinc-300">
          <LoadingSpinner className="h-8 w-8 border-2 border-sky-400 border-t-transparent" />
          טוען ערוצים…
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-zinc-600" aria-hidden />
          <p className="font-semibold text-zinc-300">אין עדיין פרופיל ילד מחובר</p>
        </div>
      ) : visibleChannels.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/60 px-4 py-12 text-center">
          <Tv className="mx-auto mb-3 h-12 w-12 text-zinc-600" aria-hidden />
          <p className="font-semibold text-zinc-300">אין עדיין ערוצים מאושרים</p>
          <p className="mt-1 text-sm text-zinc-500">ההורה יכול להוסיף ערוצים מתוך בקרת הורים.</p>
        </div>
      ) : (
        <section aria-label="ערוצים מאושרים" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleChannels.map((channel) => (
            <article
              key={channel.id}
              className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="aspect-square bg-zinc-900">
                {channel.channel_thumbnail ? (
                  <img
                    src={channel.channel_thumbnail}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">
                    <Tv className="h-12 w-12" aria-hidden />
                  </div>
                )}
              </div>
              <div className="p-3 text-right">
                <h2 className="line-clamp-2 text-sm font-bold leading-snug text-zinc-100">{channel.channel_name}</h2>
                {channel.category ? (
                  <p className="mt-1 truncate text-xs text-sky-300">{channel.category}</p>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
