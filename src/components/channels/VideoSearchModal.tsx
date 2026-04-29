import { useState } from 'react'
import { Search } from 'lucide-react'
import type { YouTubeVideoResult } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ErrorState } from '../ui/ErrorState'
import { ApprovedVideoCard } from './ApprovedVideoCard'

export function VideoSearchModal({
  open,
  onClose,
  onSearch,
  results,
  loading,
  error,
  onAdd,
  addingId,
}: {
  open: boolean
  onClose: () => void
  onSearch: (q: string) => void
  results: YouTubeVideoResult[]
  loading: boolean
  error: string | null
  onAdd: (v: YouTubeVideoResult) => void
  addingId: string | null
}) {
  const [q, setQ] = useState('')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="חיפוש סרטון"
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
            placeholder="שם סרטון..."
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
        {import.meta.env.DEV
          ? (console.log('ACTIVE VIDEO LIST RENDER', { fileName: 'src/components/channels/VideoSearchModal.tsx' }), null)
          : null}
        {results.map((v) => (
          <ApprovedVideoCard
            key={v.videoId}
            variant="search"
            video={v}
            onAdd={() => onAdd(v)}
            adding={addingId === v.videoId}
          />
        ))}
      </div>
    </Modal>
  )
}
