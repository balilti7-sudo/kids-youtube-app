import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { searchYouTubeVideos } from '../../lib/youtube'
import type { YouTubeVideoResult } from '../../types'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { RtlSearchInput } from '../search/RtlSearchInput'
import { YoutubeVideoCard } from '../youtube/YoutubeVideoCard'
import { AddToPlaylistButton } from '../playlists/AddToPlaylistButton'

export function ParentSingleVideoSearchSection() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const userId = ownerUserId ?? user?.id ?? null

  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [results, setResults] = useState<YouTubeVideoResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim()
    setSubmittedQuery(q)
    setResults([])
    setError(null)

    if (!q) {
      return
    }

    setLoading(true)
    const { data, error: searchErr } = await searchYouTubeVideos(q)
    setLoading(false)

    if (searchErr) {
      setError(searchErr.message)
      setResults([])
      return
    }
    setResults(data ?? [])
  }, [])

  if (!userId) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
        <p className="text-sm text-slate-600 dark:text-zinc-400">התחברו כדי לחפש ולהוסיף סרטונים לפלייליסטים.</p>
      </section>
    )
  }

  return (
    <section
      className="rounded-2xl border border-yt-border bg-yt-surface/80 p-4 shadow-sm sm:p-5"
      aria-label="חיפוש והוספת סרטונים"
    >
      <header className="mb-4 text-right">
        <h2 className="text-base font-bold text-yt-text sm:text-lg">חיפוש והוספת סרטונים</h2>
        <p className="mt-1 text-xs text-yt-textMuted sm:text-sm">
          חפשו לפי מילים או שם סרטון, ואז הוסיפו לפלייליסט של הילד.
        </p>
      </header>

      <RtlSearchInput
        id="parent-single-video-search"
        value={query}
        onChange={setQuery}
        onSubmit={runSearch}
        placeholder="חפשו סרטון ב-YouTube…"
        aria-label="חיפוש סרטונים ב-YouTube"
      />

      <div className="mt-4" aria-live="polite">
        {!submittedQuery ? (
          <p className="text-sm text-yt-textMuted">הקלידו מילות חיפוש ולחצו Enter או על כפתור החיפוש.</p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-yt-textMuted">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            מחפש ב-YouTube…
          </div>
        ) : error ? (
          <p className="text-sm text-yt-red">{error}</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-yt-textMuted">
            לא נמצאו סרטונים עבור &quot;{submittedQuery}&quot;
          </p>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((video) => (
              <article key={video.videoId} className="flex flex-col">
                <YoutubeVideoCard
                  layout="grid"
                  title={video.title}
                  thumbnail={video.thumbnail}
                  channelName={video.channelTitle}
                  actionSlot={
                    <AddToPlaylistButton
                      mode="parent"
                      userId={userId}
                      childAccessToken={null}
                      video={{
                        youtube_video_id: video.videoId,
                        title: video.title,
                        thumbnail_url: video.thumbnail,
                        channel_name: video.channelTitle || null,
                      }}
                    />
                  }
                />
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
