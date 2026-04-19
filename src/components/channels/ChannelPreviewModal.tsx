import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getChildCachedChannelVideos } from '../../lib/childDevice'
import { CHANNEL_VIDEOS_CACHE_MAX_FETCH } from '../../lib/youtube'
import { buildSafeEmbedUrl } from '../../lib/youtubeEmbed'
import type { WhitelistedChannel } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
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

  useEffect(() => {
    if (!open || !channel) return
    void listReloadNonce
    let cancelled = false
    setLoading(true)
    setError(null)
    setVideos([])
    setActiveVideoId(null)
    setIframeLoaded(false)

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
          setActiveVideoId(rows[0]?.videoId ?? null)
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
          setActiveVideoId(rows[0]?.videoId ?? null)
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
  }, [open, channel, previewMode, localAccessToken])

  const active = videos.find((v) => v.videoId === activeVideoId) ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={channel ? `תצוגת ערוץ — ${channel.channel_name}` : 'תצוגת ערוץ'}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
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
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-slate-600 dark:text-zinc-400">
        הרשימה מגיעה מהמטמון של SafeTube (עד {CHANNEL_VIDEOS_CACHE_MAX_FETCH} סרטונים אחרונים לאחר &quot;רענן&quot; או
        &quot;עדכן רשימה מהערוץ&quot;). אין כאן דף הבית, Shorts או המלצות של YouTube. פרסומות בתוך הנגן נקבעות על ידי
        YouTube ולא ניתן להסיר אותן לחלוטין מתוך embed.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-10">
          <LoadingSpinner className="h-8 w-8 border-2 border-brand-500 border-t-transparent" />
          <span className="text-sm text-slate-700 dark:text-zinc-200">טוען סרטונים מהמטמון…</span>
        </div>
      ) : error ? (
        <p className="text-sm text-danger-600">{error}</p>
      ) : videos.length === 0 ? (
        <p className="text-sm text-slate-700 dark:text-zinc-200">
          אין סרטונים במטמון לערוץ הזה. במסך ניהול הערוצים לחצו &quot;רענן&quot; ליד הערוץ, ואז פתחו שוב.
        </p>
      ) : (
        <div className="grid max-h-[70vh] gap-3 sm:grid-cols-[1fr,1.1fr]">
          <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-zinc-700 dark:bg-zinc-900/60">
            <ul className="flex flex-col gap-1">
              {videos.map((v) => {
                const sel = v.videoId === activeVideoId
                return (
                  <li key={v.videoId}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveVideoId(v.videoId)
                        setIframeLoaded(false)
                      }}
                      className={`flex w-full gap-2 rounded-lg border p-2 text-right transition ${
                        sel
                          ? 'border-brand-500 bg-white shadow-sm dark:bg-zinc-900'
                          : 'border-transparent hover:border-slate-200 dark:hover:border-zinc-700'
                      }`}
                    >
                      {v.thumbnail ? (
                        <img src={v.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded object-cover" loading="lazy" />
                      ) : (
                        <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] text-slate-500 dark:bg-zinc-800">
                          וידאו
                        </div>
                      )}
                      <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-slate-900 dark:text-zinc-100">
                        {v.title}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="min-w-0">
            {active ? (
              <>
                <div className="relative overflow-hidden rounded-xl border border-slate-200 pt-[56.25%] dark:border-zinc-700">
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
                <p className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900 dark:text-zinc-100">{active.title}</p>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  )
}
