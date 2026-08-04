import { useEffect, useMemo, useState } from 'react'
import { Search, Tv, X } from 'lucide-react'
import type { WhitelistedChannel } from '../../types'
import { ChannelCard } from './ChannelCard'
import { EmptyState } from '../ui/EmptyState'
import { PlaylistMultiSelectToolbar } from '../playlists/PlaylistMultiSelectToolbar'
import { RtlSearchInput } from '../search/RtlSearchInput'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useTranslation } from 'react-i18next'

export type WhitelistVideoHit = {
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  channel_id: string
  channel_name: string
}

type Props = {
  channels: WhitelistedChannel[]
  onRemoveRequest: (c: WhitelistedChannel) => void
  onPreviewRequest: (c: WhitelistedChannel, opts?: { videoId?: string; videoSearch?: string }) => void
  onOpenSearch?: () => void
  canMultiSelect?: boolean
  selectionMode?: boolean
  selectedIds?: Set<string>
  onEnterSelectionMode?: () => void
  onExitSelectionMode?: () => void
  onToggleSelect?: (channelId: string) => void
  onSelectAll?: (visibleChannelIds: string[]) => void
  onClearSelection?: () => void
  onBulkAddToPlaylist?: () => void
  bulkLoading?: boolean
  className?: string
}

function normalizeQuery(q: string) {
  return q.trim().toLowerCase()
}

function channelMatches(channel: WhitelistedChannel, q: string) {
  if (!q) return true
  const hay = [
    channel.channel_name,
    channel.category ?? '',
    channel.description ?? '',
    channel.youtube_channel_id,
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

export function WhitelistView({
  channels,
  onRemoveRequest,
  onPreviewRequest,
  onOpenSearch,
  canMultiSelect = false,
  selectionMode = false,
  selectedIds,
  onEnterSelectionMode,
  onExitSelectionMode,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onBulkAddToPlaylist,
  bulkLoading = false,
  className,
}: Props) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [videoHits, setVideoHits] = useState<WhitelistVideoHit[]>([])
  const [videoSearchLoading, setVideoSearchLoading] = useState(false)
  const normalized = normalizeQuery(query)

  const filteredChannels = useMemo(
    () => channels.filter((c) => channelMatches(c, normalized)),
    [channels, normalized]
  )

  const channelById = useMemo(() => {
    const map = new Map<string, WhitelistedChannel>()
    for (const c of channels) map.set(c.id, c)
    return map
  }, [channels])

  useEffect(() => {
    if (!normalized || channels.length === 0) {
      setVideoHits([])
      setVideoSearchLoading(false)
      return
    }

    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        setVideoSearchLoading(true)
        try {
          const ids = channels.map((c) => c.id)
          const { data, error } = await supabase
            .from('channel_videos_cache')
            .select('youtube_video_id, title, thumbnail_url, channel_id')
            .in('channel_id', ids)
            .ilike('title', `%${normalized}%`)
            .order('position', { ascending: true })
            .limit(24)
          if (cancelled) return
          if (error) {
            setVideoHits([])
            return
          }
          const hits: WhitelistVideoHit[] = []
          for (const row of data ?? []) {
            const r = row as {
              youtube_video_id: string
              title: string
              thumbnail_url: string | null
              channel_id: string
            }
            const ch = channelById.get(r.channel_id)
            if (!ch) continue
            hits.push({
              youtube_video_id: r.youtube_video_id,
              title: r.title,
              thumbnail_url: r.thumbnail_url,
              channel_id: r.channel_id,
              channel_name: ch.channel_name,
            })
          }
          setVideoHits(hits)
        } finally {
          if (!cancelled) setVideoSearchLoading(false)
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [normalized, channels, channelById])

  if (channels.length === 0) {
    return (
      <EmptyState
        icon={<Tv className="mx-auto h-10 w-10" />}
        title="אין ערוצים מאושרים עדיין"
        description="חפשו ערוץ למעלה והוסיפו אותו — רק אז הילד יוכל לצפות."
        action={
          onOpenSearch ? (
            <button
              type="button"
              onClick={onOpenSearch}
              className="mt-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-zinc-900"
            >
              חיפוש ערוץ עכשיו
            </button>
          ) : undefined
        }
      />
    )
  }

  const hasQuery = normalized.length > 0
  const showEmptyFilter =
    hasQuery && filteredChannels.length === 0 && videoHits.length === 0 && !videoSearchLoading

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="rounded-2xl border border-zinc-700/80 bg-zinc-950/70 p-2.5 shadow-inner ring-1 ring-zinc-800/80">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">
            {t('channels.whitelistSearchTitle')}
          </p>
          {hasQuery ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => setQuery('')}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t('common.clear')}
            </button>
          ) : null}
        </div>
        <RtlSearchInput
          id="whitelist-fast-search"
          value={query}
          onChange={setQuery}
          placeholder={t('channels.whitelistSearchPlaceholder')}
          aria-label={t('channels.whitelistSearchTitle')}
        />
        {hasQuery ? (
          <p className="mt-1.5 px-0.5 text-[11px] text-zinc-500">
            {t('channels.whitelistSearchHint', {
              channels: filteredChannels.length,
              videos: videoHits.length,
            })}
            {videoSearchLoading ? ` · ${t('common.loading')}` : ''}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">
          {hasQuery
            ? t('channels.whitelistFilteredCount', {
                filtered: filteredChannels.length,
                total: channels.length,
              })
            : `${channels.length} ערוצים מאושרים`}
          {bulkLoading ? <span className="ms-2 text-xs text-slate-500">טוען סרטונים…</span> : null}
        </p>
      </div>

      {canMultiSelect &&
      onEnterSelectionMode &&
      onExitSelectionMode &&
      onBulkAddToPlaylist ? (
        <PlaylistMultiSelectToolbar
          selectionMode={selectionMode}
          selectedCount={selectedIds?.size ?? 0}
          totalVisible={filteredChannels.length}
          itemNoun="ערוצים"
          enterLabel="בחירת ערוצים"
          addButtonLabel="הוסף סרטונים לפלייליסט"
          onEnterSelectionMode={onEnterSelectionMode}
          onExitSelectionMode={onExitSelectionMode}
          onSelectAllVisible={() => onSelectAll?.(filteredChannels.map((c) => c.id))}
          onClearSelection={onClearSelection}
          onAddToPlaylist={onBulkAddToPlaylist}
        />
      ) : null}

      {hasQuery && videoHits.length > 0 ? (
        <section
          aria-label={t('channels.whitelistVideoHits')}
          className="rounded-xl border border-zinc-700/70 bg-zinc-900/50 p-2"
        >
          <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-400">
            {t('channels.whitelistVideoHits')}
          </p>
          <ul className="flex flex-col gap-1">
            {videoHits.map((hit) => (
              <li key={`${hit.channel_id}-${hit.youtube_video_id}`}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start transition hover:bg-zinc-800/80"
                  onClick={() => {
                    const ch = channelById.get(hit.channel_id)
                    if (!ch) return
                    onPreviewRequest(ch, {
                      videoId: hit.youtube_video_id,
                      videoSearch: query.trim(),
                    })
                  }}
                >
                  {hit.thumbnail_url ? (
                    <img
                      src={hit.thumbnail_url}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-500">
                      <Search className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">{hit.title}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{hit.channel_name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showEmptyFilter ? (
        <p className="rounded-xl border border-dashed border-zinc-700 px-3 py-6 text-center text-sm text-zinc-500">
          {t('channels.whitelistSearchEmpty')}
        </p>
      ) : (
        filteredChannels.map((c) => (
          <ChannelCard
            key={c.id}
            variant="whitelist"
            channel={c}
            onRemove={() => onRemoveRequest(c)}
            onOpenChannel={() => onPreviewRequest(c)}
            selectionMode={selectionMode}
            selected={selectedIds?.has(c.id) ?? false}
            onToggleSelect={() => onToggleSelect?.(c.id)}
          />
        ))
      )}
    </div>
  )
}
