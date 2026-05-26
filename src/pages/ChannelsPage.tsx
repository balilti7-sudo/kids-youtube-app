import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, PlayCircle, Tv } from 'lucide-react'
import { useChannels } from '../hooks/useChannels'
import { useDeviceOwnerId } from '../hooks/useDeviceOwnerId'
import { useDevices } from '../hooks/useDevices'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Button } from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../lib/activeDeviceSelection'

type ChannelVideoRow = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
}

export function ChannelsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devicesLoading } = useDevices(ownerUserId)
  const requestedDeviceId = searchParams.get('device') ?? getSavedActiveChildProfileId()
  const requestedChannelId = searchParams.get('channel')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [videos, setVideos] = useState<ChannelVideoRow[]>([])
  const [videosLoading, setVideosLoading] = useState(false)
  const [videosError, setVideosError] = useState<string | null>(null)

  useEffect(() => {
    if (devices.length === 0) return
    if (requestedDeviceId && devices.some((d) => d.id === requestedDeviceId)) {
      setDeviceId(requestedDeviceId)
      saveActiveChildProfileId(requestedDeviceId)
      return
    }
    setDeviceId((current) => {
      const next = current && devices.some((d) => d.id === current) ? current : devices[0].id
      if (next) saveActiveChildProfileId(next)
      return next
    })
  }, [devices, requestedDeviceId])

  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const { whitelist, loading } = useChannels(deviceId ?? undefined, ownerUserId)

  const visibleChannels = useMemo(() => whitelist.filter((c) => c.youtube_channel_id), [whitelist])
  const selectedChannel = useMemo(
    () =>
      visibleChannels.find(
        (channel) => channel.youtube_channel_id === requestedChannelId || channel.id === requestedChannelId
      ) ?? null,
    [visibleChannels, requestedChannelId]
  )

  useEffect(() => {
    if (!selectedChannel) {
      setVideos([])
      setVideosError(null)
      setVideosLoading(false)
      return
    }

    let cancelled = false
    setVideosLoading(true)
    setVideosError(null)
    setVideos([])

    void (async () => {
      const { data, error } = await supabase
        .from('channel_videos_cache')
        .select('youtube_video_id, title, thumbnail_url, position')
        .eq('channel_id', selectedChannel.id)
        .order('position', { ascending: true })

      if (cancelled) return
      setVideosLoading(false)
      if (error) {
        setVideosError(error.message)
        return
      }
      setVideos((data ?? []) as ChannelVideoRow[])
    })()

    return () => {
      cancelled = true
    }
  }, [selectedChannel])

  const openChannel = (youtubeChannelId: string) => {
    if (deviceId) saveActiveChildProfileId(deviceId)
    const next = new URLSearchParams(searchParams)
    if (deviceId) next.set('device', deviceId)
    next.set('channel', youtubeChannelId)
    navigate({ pathname: '/channels', search: `?${next.toString()}` })
  }

  const backToChannels = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('channel')
    navigate({ pathname: '/channels', search: next.toString() ? `?${next.toString()}` : '' })
  }

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
      ) : selectedChannel ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-3 shadow-xl shadow-black/10 sm:p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={backToChannels}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-200 transition hover:bg-zinc-800"
                aria-label="חזרה לערוצים"
              >
                <ArrowRight className="h-5 w-5" aria-hidden />
              </button>
              {selectedChannel.channel_thumbnail ? (
                <img
                  src={selectedChannel.channel_thumbnail}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <div className="min-w-0">
                <h2 className="truncate text-lg font-black text-zinc-50">{selectedChannel.channel_name}</h2>
                <p className="text-sm text-zinc-500">רשימת הסרטונים בערוץ</p>
              </div>
            </div>
          </div>

          {videosLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-3 text-zinc-300">
              <LoadingSpinner className="h-7 w-7 border-2 border-sky-400 border-t-transparent" />
              טוען סרטונים…
            </div>
          ) : videosError ? (
            <p className="rounded-2xl border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {videosError}
            </p>
          ) : videos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-4 py-10 text-center text-sm text-zinc-500">
              אין סרטונים זמינים בערוץ הזה כרגע.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((video) => (
                <article key={video.youtube_video_id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70">
                  <div className="aspect-video bg-zinc-950">
                    {video.thumbnail_url ? (
                      <img
                        src={video.thumbnail_url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-600">
                        <PlayCircle className="h-10 w-10" aria-hidden />
                      </div>
                    )}
                  </div>
                  <h3 className="line-clamp-2 p-3 text-sm font-bold leading-snug text-zinc-100">{video.title}</h3>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section
          aria-label="ערוצים מאושרים"
          className="mx-auto grid w-full max-w-[1040px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {visibleChannels.map((channel) => (
            <article
              key={channel.id}
              role="button"
              tabIndex={0}
              onClick={() => openChannel(channel.youtube_channel_id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openChannel(channel.youtube_channel_id)
                }
              }}
              className="group w-full max-w-[220px] cursor-pointer justify-self-center overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              <div className="h-28 bg-zinc-900 sm:h-32">
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
                    <Tv className="h-10 w-10" aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex min-h-[108px] flex-col p-3 text-right">
                <h2 className="line-clamp-2 text-sm font-bold leading-snug text-zinc-100">{channel.channel_name}</h2>
                {channel.category ? (
                  <p className="mt-1 truncate text-xs text-sky-300">{channel.category}</p>
                ) : null}
                <Button
                  type="button"
                  className="mt-auto min-h-[38px] w-full justify-center rounded-xl bg-zinc-800 px-3 text-xs font-black text-zinc-50 shadow-sm shadow-black/20 ring-1 ring-white/10 hover:bg-zinc-700"
                  onClick={(event) => {
                    event.stopPropagation()
                    openChannel(channel.youtube_channel_id)
                  }}
                >
                  כנס לערוץ
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}
