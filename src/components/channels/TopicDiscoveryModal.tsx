import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, Tv } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { ChannelCard } from './ChannelCard'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ErrorState } from '../ui/ErrorState'
import { VoiceMicButton } from '../search/VoiceMicButton'
import { cn } from '../../lib/utils'
import { searchYouTubeChannels } from '../../lib/youtube'
import type { YouTubeChannelResult } from '../../types'

type Props = {
  open: boolean
  onClose: () => void
  onAddChannel: (channel: YouTubeChannelResult) => void
  /** Bulk whitelist — preferred when multiple channels are selected. */
  onAddChannels?: (channels: YouTubeChannelResult[]) => void
  addingId: string | null
  addedIds: Set<string>
  /** Channels already on the device whitelist (UC ids). */
  whitelistedChannelIds?: Set<string>
  deviceLabel?: string
}

export function TopicDiscoveryModal({
  open,
  onClose,
  onAddChannel,
  onAddChannels,
  addingId,
  addedIds,
  whitelistedChannelIds,
  deviceLabel,
}: Props) {
  const [q, setQ] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<YouTubeChannelResult[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const searchSeqRef = useRef(0)

  const reset = useCallback(() => {
    searchSeqRef.current += 1
    setQ('')
    setHasSearched(false)
    setLoadingChannels(false)
    setError(null)
    setChannels([])
    setSelectedIds(new Set())
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const isAdded = useCallback(
    (channelId: string) =>
      addedIds.has(channelId) || Boolean(whitelistedChannelIds?.has(channelId)),
    [addedIds, whitelistedChannelIds]
  )

  const runSearch = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    const seq = ++searchSeqRef.current
    const isCurrent = () => searchSeqRef.current === seq
    setHasSearched(true)
    setLoadingChannels(true)
    setError(null)
    setSelectedIds(new Set())

    void searchYouTubeChannels(trimmed)
      .then((res) => {
        if (!isCurrent()) return
        setChannels(res.data ?? [])
        if (res.error) setError(res.error.message)
      })
      .catch((e: unknown) => {
        if (!isCurrent()) return
        setChannels([])
        setError(e instanceof Error ? e.message : 'החיפוש נכשל')
      })
      .finally(() => {
        if (isCurrent()) setLoadingChannels(false)
      })
  }, [])

  const selectableChannels = useMemo(
    () => channels.filter((c) => !isAdded(c.channelId)),
    [channels, isAdded]
  )

  const toggleSelect = (channelId: string) => {
    if (isAdded(channelId)) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelectedIds(new Set(selectableChannels.map((c) => c.channelId)))
  }

  const clearSelection = () => setSelectedIds(new Set())

  const addSelected = () => {
    const toAdd = channels.filter((c) => selectedIds.has(c.channelId) && !isAdded(c.channelId))
    if (toAdd.length === 0) return
    if (onAddChannels) onAddChannels(toAdd)
    else for (const c of toAdd) onAddChannel(c)
    clearSelection()
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const selectedCount = selectedIds.size
  const loading = loadingChannels
  const empty =
    hasSearched && !loadingChannels && !error && channels.length === 0

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={deviceLabel ? `הוספת ערוצים — ${deviceLabel}` : 'הוספת ערוצים'}
      size="lg"
      panelClassName="max-h-[92svh] border border-zinc-700/70 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-0 text-zinc-100 ring-zinc-700/80 sm:rounded-[2rem]"
      headerClassName="mb-0 border-b border-zinc-800/90 px-5 py-4 sm:px-6"
      toolbarClassName="mb-0 border-b border-zinc-800/90 px-5 py-3 sm:px-6"
      bodyClassName="premium-scrollbar max-h-[min(56svh,36rem)] overflow-y-auto px-5 py-5 sm:px-6"
      footerClassName="mt-0 border-t border-zinc-800/90 bg-zinc-950/80 px-5 py-4 sm:px-6"
      toolbar={
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl shadow-black/25">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500"
                aria-hidden
              />
              <input
                dir="auto"
                data-autofocus="true"
                placeholder="שם ערוץ או נושא — למשל בישול, מדע, מלאכת יד…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runSearch(q)
                  }
                }}
                className="h-12 w-full rounded-2xl border border-zinc-700 bg-zinc-900/90 pe-4 ps-12 text-sm font-medium text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-sky-400/70 focus:ring-4 focus:ring-sky-500/15"
                aria-label="חיפוש ערוץ"
              />
            </div>
            <VoiceMicButton
              onResult={(spoken) => {
                setQ(spoken)
                void runSearch(spoken)
              }}
              className="h-12 w-12 shrink-0 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
            />
            <Button
              type="button"
              className="h-12 min-w-28 rounded-2xl bg-zinc-100 px-5 font-bold text-zinc-950 shadow-lg shadow-black/20 hover:bg-white disabled:opacity-60"
              onClick={() => void runSearch(q)}
              disabled={loading || !q.trim()}
            >
              {loading ? <LoadingSpinner className="h-5 w-5 border-2" /> : <Search className="h-5 w-5" />}
              חפש
            </Button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            חיפוש ערוצים שלמים בלבד — לא סרטונים בודדים. אפשר גם לדבר במקום להקליד.
          </p>
        </div>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {selectableChannels.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <button
                type="button"
                className="rounded-lg px-2 py-1 font-semibold text-sky-300 hover:bg-sky-500/10"
                onClick={selectAllVisible}
              >
                בחר הכול
              </button>
              {selectedCount > 0 ? (
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 font-semibold text-zinc-400 hover:bg-zinc-800"
                  onClick={clearSelection}
                >
                  נקה בחירה
                </button>
              ) : null}
            </div>
          ) : (
            <span />
          )}
          <Button
            variant="secondary"
            className="min-w-28 border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800"
            onClick={handleClose}
          >
            סגור
          </Button>
        </div>
      }
    >
      {error ? <ErrorState message={error} onRetry={() => runSearch(q)} /> : null}

      {loadingChannels ? (
        <div className="flex min-h-[8rem] items-center justify-center gap-3 py-8 text-sm text-zinc-400">
          <LoadingSpinner className="h-8 w-8 border-2" />
          מחפש ערוצים…
        </div>
      ) : null}

      {empty ? (
        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 py-8 text-center text-sm text-zinc-500">
          לא נמצאו תוצאות לנושא הזה
        </p>
      ) : null}

      {!loadingChannels && channels.length > 0 ? (
        <section className="mb-6" aria-label="ערוצים">
          <div className="mb-3 flex items-center gap-2 px-0.5">
            <Tv className="h-4 w-4 text-sky-300" aria-hidden />
            <h3 className="text-sm font-bold text-zinc-200">ערוצים ({channels.length})</h3>
          </div>
          <div className="flex flex-col gap-2.5">
            {channels.map((c) => {
              const added = isAdded(c.channelId)
              const selected = selectedIds.has(c.channelId)
              return (
                <div key={c.channelId} className="relative">
                  {!added ? (
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={selected ? 'הסר מהבחירה' : 'בחר ערוץ'}
                      onClick={() => toggleSelect(c.channelId)}
                      className={cn(
                        'absolute start-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition',
                        selected
                          ? 'border-brand-400 bg-brand-600 text-white'
                          : 'border-zinc-600 bg-zinc-950/90 text-zinc-300 hover:border-zinc-400'
                      )}
                    >
                      {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
                    </button>
                  ) : null}
                  <div className={cn(!added && 'ps-9')}>
                    <ChannelCard
                      variant="search"
                      channel={c}
                      onAdd={() => onAddChannel(c)}
                      adding={addingId === c.channelId}
                      added={added}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {selectedCount > 0 ? (
        <div className="sticky bottom-0 z-20 -mx-1 mt-4 border-t border-zinc-800 bg-zinc-950/95 px-1 pt-3 backdrop-blur">
          <Button
            type="button"
            className="h-12 w-full rounded-2xl bg-sky-500 text-base font-bold text-white shadow-lg shadow-sky-950/40 hover:bg-sky-400"
            onClick={addSelected}
          >
            הוסף {selectedCount} ערוצים נבחרים
          </Button>
        </div>
      ) : null}
    </Modal>
  )
}
