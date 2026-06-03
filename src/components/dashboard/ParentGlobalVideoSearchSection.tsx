import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Loader2, Search, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { getSavedActiveChildProfileId, saveActiveChildProfileId } from '../../lib/activeDeviceSelection'
import { searchYouTubeVideos } from '../../lib/youtube'
import { useChannelStore } from '../../stores/channelStore'
import type { Device, YouTubeVideoResult } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'

type Props = {
  devices: Device[]
  className?: string
}

/**
 * Parent dashboard — search YouTube and approve individual videos per child profile
 * (independent of the channel manager view).
 */
export function ParentGlobalVideoSearchSection({ devices, className }: Props) {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const userId = user?.id ?? ownerUserId ?? ''

  const addVideoToDevice = useChannelStore((s) => s.addVideoToDevice)
  const fetchApprovedVideosForDevice = useChannelStore((s) => s.fetchApprovedVideosForDevice)
  const approvedVideos = useChannelStore((s) => s.approvedVideos)

  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState<string | null>(null)
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null)

  useEffect(() => {
    if (devices.length === 0) {
      setDeviceId(null)
      return
    }
    const saved = getSavedActiveChildProfileId()
    const initial =
      saved && devices.some((d) => d.id === saved)
        ? saved
        : devices[0]!.id
    setDeviceId(initial)
  }, [devices])

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === deviceId) ?? null,
    [devices, deviceId]
  )

  useEffect(() => {
    if (!deviceId) return
    void fetchApprovedVideosForDevice(deviceId)
  }, [deviceId, fetchApprovedVideosForDevice])

  const approvedYoutubeIds = useMemo(
    () => new Set(approvedVideos.map((v) => v.youtube_video_id)),
    [approvedVideos]
  )

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    setQuery(q)
    setLoading(true)
    setError(null)
    setResults([])
    const { data, error: searchError } = await searchYouTubeVideos(q)
    setLoading(false)
    if (searchError) {
      setError(searchError.message)
      return
    }
    setResults(data ?? [])
  }, [])

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault()
      void runSearch(input)
    },
    [input, runSearch]
  )

  const handleApprove = useCallback(
    async (video: YouTubeVideoResult) => {
      if (!deviceId) {
        toast.error('בחרו פרופיל ילד')
        return
      }
      if (!userId) {
        toast.error('לא מחובר')
        return
      }
      if (approvedYoutubeIds.has(video.videoId)) {
        toast.message('הסרטון כבר ברשימה המאושרת')
        return
      }

      setAddingVideoId(video.videoId)
      const { error: addError } = await addVideoToDevice({
        deviceId,
        userId,
        yt: video,
      })
      setAddingVideoId(null)

      if (addError) {
        toast.error('לא ניתן לאשר את הסרטון', { description: addError.message })
        return
      }

      toast.success('הסרטון נוסף לרשימה המאושרת')
      void fetchApprovedVideosForDevice(deviceId)
    },
    [deviceId, userId, approvedYoutubeIds, addVideoToDevice, fetchApprovedVideosForDevice]
  )

  const handleDeviceChange = (nextId: string) => {
    setDeviceId(nextId)
    saveActiveChildProfileId(nextId)
    setResults([])
    setQuery(null)
    setError(null)
    setInput('')
  }

  if (devices.length === 0) {
    return null
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-zinc-700/60 bg-zinc-900/80 p-4 shadow-inner ring-1 ring-zinc-800/80 sm:p-5',
        className
      )}
      aria-labelledby="parent-global-video-search-title"
    >
      <div className="mb-3 flex items-start gap-2">
        <span
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25"
          aria-hidden
        >
          <Video className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 text-right">
          <h2 id="parent-global-video-search-title" className="text-base font-bold text-zinc-50 sm:text-lg">
            חיפוש סרטונים
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 sm:text-sm">
            חפשו ב-YouTube והוסיפו סרטונים בודדים לרשימה המאושרת — בלי לפתוח ניהול ערוצים.
          </p>
        </div>
      </div>

      {devices.length > 1 ? (
        <div className="mb-3">
          <label htmlFor="parent-video-search-device" className="mb-1 block text-xs font-medium text-zinc-400">
            פרופיל ילד
          </label>
          <select
            id="parent-video-search-device"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
            value={deviceId ?? ''}
            onChange={(e) => handleDeviceChange(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      ) : selectedDevice ? (
        <p className="mb-3 text-xs text-zinc-500">
          פרופיל: <span className="font-semibold text-zinc-300">{selectedDevice.name}</span>
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <input
            type="search"
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="חפשו סרטון ב-YouTube…"
            aria-label="Search for videos"
            className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 py-2 pe-3 ps-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
          />
        </div>
        <Button
          type="submit"
          className="h-11 shrink-0 justify-center gap-2 rounded-xl !px-5"
          disabled={loading || !input.trim()}
        >
          {loading ? (
            <LoadingSpinner className="h-4 w-4 border-2 border-white border-t-transparent" />
          ) : (
            <Search className="h-4 w-4" aria-hidden />
          )}
          חפש
        </Button>
      </form>

      {query || loading ? (
        <div
          className="mt-3 rounded-xl border border-zinc-800/90 bg-zinc-950/50 p-3"
          aria-live="polite"
          aria-label="תוצאות חיפוש"
        >
          {query ? (
            <p className="mb-2 text-xs font-medium text-zinc-400">
              תוצאות עבור: <span className="text-zinc-200">&quot;{query}&quot;</span>
            </p>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              מחפש ב-YouTube…
            </div>
          ) : error ? (
            <p className="py-2 text-sm text-red-300">{error}</p>
          ) : results.length === 0 && query ? (
            <p className="py-2 text-sm text-zinc-500">לא נמצאו סרטונים.</p>
          ) : (
            <ul className="premium-scrollbar max-h-80 space-y-2 overflow-y-auto">
              {results.map((video) => {
                const alreadyApproved = approvedYoutubeIds.has(video.videoId)
                const isAdding = addingVideoId === video.videoId
                return (
                  <li
                    key={video.videoId}
                    className="flex gap-2.5 rounded-xl border border-zinc-800/90 bg-zinc-900/80 p-2.5 ring-1 ring-zinc-800/50"
                  >
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt=""
                        className="h-14 w-24 shrink-0 rounded-lg bg-zinc-800 object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-14 w-24 shrink-0 rounded-lg bg-zinc-800" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1 text-right">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">
                        {video.title}
                      </p>
                      {video.channelTitle ? (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{video.channelTitle}</p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant={alreadyApproved ? 'secondary' : 'primary'}
                      className="h-9 shrink-0 self-center !px-3 !py-1.5 text-xs font-bold"
                      disabled={alreadyApproved || isAdding}
                      onClick={() => void handleApprove(video)}
                    >
                      {isAdding ? (
                        <LoadingSpinner className="h-3.5 w-3.5 border-2 border-current border-t-transparent" />
                      ) : alreadyApproved ? (
                        <>
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          מאושר
                        </>
                      ) : (
                        'אשר והוסף'
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
