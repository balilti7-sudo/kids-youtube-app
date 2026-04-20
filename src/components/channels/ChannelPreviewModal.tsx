import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getChildCachedChannelVideos } from '../../lib/childDevice'
import { buildSafeEmbedUrl } from '../../lib/youtubeEmbed'
import type { WhitelistedChannel } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { LoadingSpinner } from '../ui/LoadingSpinner'

type PreviewRow = { videoId: string; title: string; thumbnail: string | null }

type PreviewMode = 'kid_rpc' | 'parent_db' | 'none'

export function ChannelPreviewModal({
  open,
  onClose,
  channel,
  previewMode,
  localAccessToken,
  onRefreshFromYouTube,
}: {
  open: boolean
  onClose: () => void
  channel: WhitelistedChannel | null
  previewMode: PreviewMode
  localAccessToken: string | null
  /** רענון כפוי של המטמון מהערוץ (YouTube API), ואז טעינה מחדש של הרשימה */
  onRefreshFromYouTube?: () => Promise<{ error: string | null }>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videos, setVideos] = useState<PreviewRow[]>([])
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [listReloadNonce, setListReloadNonce] = useState(0)
  const [ytRefreshing, setYtRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const playerAnchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || !channel) return
    void listReloadNonce
    let cancelled = false
    setLoading(true)
    setError(null)
    setVideos([])
    setActiveVideoId(null)
    setIframeLoaded(false)
    setQuery('')

    void (async () => {
      try {
        if (previewMode === 'kid_rpc') {
          if (!localAccessToken) throw new Error('חסר טוקן מכשיר לטעינת המטמון')
          const { data, error: rpcError } = await getChildCachedChannelVideos(
            localAccessToken,
            channel.youtube_channel_id
          )
          if (rpcError) throw rpcError
          if (cancelled) return
          const rows: PreviewRow[] = (data ?? []).map((v) => ({
            videoId: v.youtube_video_id,
            title: v.title,
            thumbnail: v.thumbnail_url,
          }))
          setVideos(rows)
          return
        }

        if (previewMode === 'parent_db') {
          const { data, error: qError } = await supabase
            .from('channel_videos_cache')
            .select('youtube_video_id, title, thumbnail_url, position')
            .eq('channel_id', channel.id)
            .order('position', { ascending: true })
          if (qError) throw new Error(qError.message)
          if (cancelled) return
          const rows: PreviewRow[] = (data ?? []).map((r) => {
            const row = r as { youtube_video_id: string; title: string; thumbnail_url: string | null }
            return {
              videoId: row.youtube_video_id,
              title: row.title,
              thumbnail: row.thumbnail_url,
            }
          })
          setVideos(rows)
          return
        }

        setError('אין דרך מורשית לטעון סרטונים במצב הנוכחי.')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'טעינת סרטונים נכשלה')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, channel, previewMode, localAccessToken, listReloadNonce])

  const active = videos.find((v) => v.videoId === activeVideoId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return videos
    return videos.filter((v) => v.title.toLowerCase().includes(q))
  }, [videos, query])

  const suggestions = useMemo(() => {
    if (!active) return []
    return videos.filter((v) => v.videoId !== active.videoId)
  }, [videos, active])

  const handlePickVideo = (videoId: string) => {
    setActiveVideoId(videoId)
    setIframeLoaded(false)
    requestAnimationFrame(() => {
      playerAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handleBackToGrid = () => {
    setActiveVideoId(null)
    setIframeLoaded(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={channel ? `תצוגת ערוץ — ${channel.channel_name}` : 'תצוגת ערוץ'}
      size="xl"
      bodyClassName="max-h-[82vh] overflow-y-auto pr-1"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-zinc-500">
            פרסומות בתוך נגן YouTube נקבעות על־ידם ולא ניתנות להסרה מתוך embed.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onRefreshFromYouTube ? (
              <Button
                type="button"
                variant="secondary"
                disabled={ytRefreshing || !channel}
                onClick={() => {
                  if (!onRefreshFromYouTube) return
                  void (async () => {
                    setYtRefreshing(true)
                    try {
                      const { error: refErr } = await onRefreshFromYouTube()
                      if (refErr) {
                        setError(refErr)
                        return
                      }
                      setListReloadNonce((n) => n + 1)
                    } finally {
                      setYtRefreshing(false)
                    }
                  })()
                }}
              >
                {ytRefreshing ? 'מעדכן מהערוץ…' : 'עדכן רשימה מהערוץ'}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              סגור
            </Button>
          </div>
        </div>
      }
    >
      <div ref={playerAnchorRef} />
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <LoadingSpinner className="h-8 w-8 border-2 border-brand-500 border-t-transparent" />
          <span className="text-sm text-slate-700 dark:text-zinc-200">טוען סרטונים מהמטמון…</span>
        </div>
      ) : error ? (
        <p className="text-sm text-danger-600">{error}</p>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-14 text-center">
          <p className="text-sm text-slate-700 dark:text-zinc-200">
            אין סרטונים במטמון לערוץ הזה. לחצו &quot;עדכן רשימה מהערוץ&quot; כדי למשוך את כל הסרטונים של הערוץ.
          </p>
        </div>
      ) : active ? (
        <div className="flex flex-col gap-4">
          <div>
            <button
              type="button"
              onClick={handleBackToGrid}
              className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
              חזרה לגלריית הערוץ
            </button>
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black pt-[56.25%] shadow-sm dark:border-zinc-700">
              <iframe
                title={active.title}
                src={buildSafeEmbedUrl(active.videoId)}
                key={active.videoId}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen={false}
                onLoad={() => setIframeLoaded(true)}
              />
            </div>
            {!iframeLoaded ? (
              <p className="mt-2 text-[11px] text-slate-500 dark:text-zinc-500">טוען נגן…</p>
            ) : null}
            <h3 className="mt-3 text-base font-bold text-slate-900 dark:text-zinc-100">{active.title}</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400">{channel?.channel_name}</p>
          </div>

          {suggestions.length > 0 ? (
            <div>
              <h4 className="mb-2 text-sm font-bold text-slate-800 dark:text-zinc-100">עוד סרטונים מהערוץ</h4>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {suggestions.map((v) => (
                  <VideoTile key={v.videoId} row={v} onPick={handlePickVideo} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="sticky top-0 z-10 bg-white/95 pb-2 backdrop-blur dark:bg-zinc-900/95">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`חיפוש בתוך סרטוני ${channel?.channel_name ?? 'הערוץ'}`}
                className="pr-9"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">
              {filtered.length} / {videos.length} סרטונים מהערוץ
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((v) => (
              <VideoTile key={v.videoId} row={v} onPick={handlePickVideo} />
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-600 dark:text-zinc-400">
              אין תוצאות לחיפוש «{query}» — נסו מילה אחרת.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  )
}

function VideoTile({ row, onPick }: { row: PreviewRow; onPick: (videoId: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(row.videoId)}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-right transition hover:border-brand-500 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-slate-100 dark:bg-zinc-800">
        {row.thumbnail ? (
          <img
            src={row.thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400 dark:text-zinc-500">
            וידאו
          </div>
        )}
      </div>
      <p className="line-clamp-2 min-h-[2.75rem] px-3 py-2 text-sm font-semibold text-slate-900 dark:text-zinc-100">
        {row.title}
      </p>
    </button>
  )
}
