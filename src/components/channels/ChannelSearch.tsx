import { useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { ChannelCard } from './ChannelCard'
import type { YouTubeChannelResult } from '../../types'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ErrorState } from '../ui/ErrorState'

export function ChannelSearch({
  open,
  onClose,
  onSearch,
  results,
  loading,
  error,
  onAdd,
  addingId,
  addedIds,
  deviceLabel,
}: {
  open: boolean
  onClose: () => void
  onSearch: (q: string) => void
  results: YouTubeChannelResult[]
  loading: boolean
  error: string | null
  onAdd: (c: YouTubeChannelResult) => void
  addingId: string | null
  addedIds?: Set<string>
  deviceLabel?: string
}) {
  const [q, setQ] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deviceLabel ? `חיפוש ערוץ עבור ${deviceLabel}` : 'חיפוש ערוץ'}
      size="lg"
      panelClassName="max-h-[92dvh] border border-zinc-700/70 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-0 text-zinc-100 ring-zinc-700/80 sm:rounded-[2rem]"
      headerClassName="mb-0 border-b border-zinc-800/90 px-5 py-4 sm:px-6"
      bodyClassName="premium-scrollbar max-h-[min(72dvh,44rem)] overflow-y-auto px-5 py-5 sm:px-6"
      footerClassName="mt-0 border-t border-zinc-800/90 bg-zinc-950/80 px-5 py-4 sm:px-6"
      footer={
        <Button
          variant="secondary"
          className="min-w-28 border-zinc-700 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800"
          onClick={onClose}
        >
          סגור
        </Button>
      }
    >
      <div className="sticky top-0 z-10 -mx-1 mb-5 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl shadow-black/25 backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" aria-hidden />
            <input
              dir="ltr"
              placeholder="Channel name, @handle, or YouTube URL"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch(q)}
              className="h-12 w-full rounded-2xl border border-zinc-700 bg-zinc-900/90 pe-4 ps-12 text-sm font-medium text-zinc-50 outline-none transition placeholder:text-zinc-500 focus:border-sky-400/70 focus:ring-4 focus:ring-sky-500/15"
            />
          </div>
          <Button
            type="button"
            className="h-12 min-w-28 rounded-2xl bg-zinc-100 px-5 font-bold text-zinc-950 shadow-lg shadow-black/20 hover:bg-white disabled:opacity-60"
            onClick={() => onSearch(q)}
            disabled={loading}
          >
            {loading ? <LoadingSpinner className="h-5 w-5 border-2" /> : <Search className="h-5 w-5" />}
            חפש
          </Button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">חפשו ערוץ ואז הוסיפו אותו לפרופיל הנבחר.</p>
      </div>

      {error ? <ErrorState message={error} onRetry={() => onSearch(q)} /> : null}

      {!loading && !error && results.length === 0 && q.length > 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 py-8 text-center text-sm text-zinc-500">
          לא נמצאו תוצאות
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {results.map((c) => (
          <ChannelCard
            key={c.channelId}
            variant="search"
            channel={c}
            onAdd={() => onAdd(c)}
            adding={addingId === c.channelId}
            added={Boolean(addedIds?.has(c.channelId))}
          />
        ))}
      </div>
    </Modal>
  )
}
