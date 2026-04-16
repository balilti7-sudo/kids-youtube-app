import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { WhitelistedVideo } from '../../types'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { EmptyState } from '../ui/EmptyState'
import { ApprovedVideoCard } from './ApprovedVideoCard'

export function ApprovedVideosPanel({
  videos,
  onAddByUrl,
  onRemove,
}: {
  videos: WhitelistedVideo[]
  onAddByUrl: (value: string) => void
  onRemove: (videoId: string) => void
}) {
  const [urlInput, setUrlInput] = useState('')

  const handleAddByUrl = () => {
    onAddByUrl(urlInput)
    setUrlInput('')
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-base font-bold text-slate-900 dark:text-zinc-100">סרטונים מאושרים</h2>
      <p className="mb-2 text-xs text-slate-500 dark:text-zinc-500">
        חיפוש לפי שם סרטון זמין בשורת הכפתורים התחתונה (יחד עם חיפוש ערוץ).
      </p>
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

      {videos.length === 0 ? (
        <EmptyState title="אין סרטונים מאושרים" description="הוסיפו לינק או השתמשו בחיפוש סרטון למטה." />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-slate-700 dark:text-zinc-300">{videos.length} סרטונים מאושרים</p>
          {videos.map((v) => (
            <ApprovedVideoCard key={v.id} variant="approved" video={v} onRemove={() => onRemove(v.id)} />
          ))}
        </div>
      )}
    </section>
  )
}
