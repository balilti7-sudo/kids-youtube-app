import { useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
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
  deviceLabel,
  manageLocked,
}: {
  open: boolean
  onClose: () => void
  onSearch: (q: string) => void
  results: YouTubeChannelResult[]
  loading: boolean
  error: string | null
  onAdd: (c: YouTubeChannelResult) => void
  addingId: string | null
  deviceLabel?: string
  manageLocked?: boolean
}) {
  const [q, setQ] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={deviceLabel ? `חיפוש ערוץ עבור ${deviceLabel}` : 'חיפוש ערוץ'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          סגור
        </Button>
      }
    >
      <div className="sticky top-0 z-10 -mx-1 mb-3 bg-white pb-2 dark:bg-zinc-900">
        <div className="flex gap-2">
          <Input
            dir="ltr"
            placeholder="שם ערוץ..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch(q)}
          />
          <Button type="button" onClick={() => onSearch(q)} disabled={loading}>
            {loading ? <LoadingSpinner className="h-5 w-5 border-2" /> : <Search className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={() => onSearch(q)} /> : null}

      {!loading && !error && results.length === 0 && q.length > 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-zinc-500">לא נמצאו תוצאות</p>
      ) : null}

      <div className="flex flex-col gap-2">
        {results.map((c) => (
          <ChannelCard
            key={c.channelId}
            variant="search"
            channel={c}
            onAdd={() => onAdd(c)}
            adding={addingId === c.channelId}
            manageLocked={manageLocked}
          />
        ))}
      </div>
    </Modal>
  )
}
