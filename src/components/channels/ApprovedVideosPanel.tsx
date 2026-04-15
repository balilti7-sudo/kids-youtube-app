import { useState } from 'react'
import { Search, Plus } from 'lucide-react'
import type { WhitelistedVideo, YouTubeVideoResult } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { ApprovedVideoCard } from './ApprovedVideoCard'
import { VideoSearchModal } from './VideoSearchModal'

export function ApprovedVideosPanel({
  videos,
  onAddByUrl,
  onSearchVideos,
  searchResults,
  searchLoading,
  searchError,
  onAddFromSearch,
  onRemove,
  addingId,
}: {
  videos: WhitelistedVideo[]
  onAddByUrl: (value: string) => void
  onSearchVideos: (q: string) => void
  searchResults: YouTubeVideoResult[]
  searchLoading: boolean
  searchError: string | null
  onAddFromSearch: (v: YouTubeVideoResult) => void
  onRemove: (videoId: string) => void
  addingId: string | null
}) {
  const [urlInput, setUrlInput] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const handleAddByUrl = () => {
    onAddByUrl(urlInput)
    setUrlInput('')
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-base font-bold text-slate-900 dark:text-zinc-100">Approved Videos</h2>
      <div className="mb-3 flex gap-2">
        <Input
          dir="ltr"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="הדבקת לינק YouTube או מזהה סרטון"
          onKeyDown={(e) => e.key === 'Enter' && handleAddByUrl()}
        />
        <Button onClick={handleAddByUrl}>
          <Plus className="h-4 w-4" />
          הוסף
        </Button>
      </div>

      <Button variant="secondary" className="mb-3 w-full" onClick={() => setSearchOpen(true)}>
        <Search className="h-4 w-4" />
        חיפוש סרטון
      </Button>

      {videos.length === 0 ? (
        <EmptyState title="אין סרטונים מאושרים" description="הוסיפו לינק או חפשו סרטון כדי להתחיל." />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">{videos.length} סרטונים מאושרים</p>
          {videos.map((v) => (
            <ApprovedVideoCard key={v.id} variant="approved" video={v} onRemove={() => onRemove(v.id)} />
          ))}
        </div>
      )}

      <VideoSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={onSearchVideos}
        results={searchResults}
        loading={searchLoading}
        error={searchError}
        onAdd={onAddFromSearch}
        addingId={addingId}
      />
    </section>
  )
}
