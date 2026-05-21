import { useCallback, useEffect, useState } from 'react'
import { ListMusic, Plus } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import type { PlaylistVideoPayload } from '../../lib/playlists'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import { usePlaylists } from '../../hooks/usePlaylists'
import { cn } from '../../lib/utils'

type Props = {
  open: boolean
  onClose: () => void
  mode: PlaylistMode
  userId: string | null
  childAccessToken: string | null
  video: PlaylistVideoPayload
  onSuccess?: () => void
}

export function AddToPlaylistModal({
  open,
  onClose,
  mode,
  userId,
  childAccessToken,
  video,
  onSuccess,
}: Props) {
  const api = usePlaylists({ mode, userId, childAccessToken })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadingMembership, setLoadingMembership] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMembership = useCallback(async () => {
    if (!open) return
    setLoadingMembership(true)
    const { data } = await api.getPlaylistIdsForVideo(video.youtube_video_id)
    setSelectedIds(new Set(data))
    setLoadingMembership(false)
  }, [open, api, video.youtube_video_id])

  useEffect(() => {
    if (open) {
      setError(null)
      setNewName('')
      void api.refresh()
      void loadMembership()
    }
  }, [open, api, loadMembership])

  const togglePlaylist = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setError(null)
    const { data, error: createErr } = await api.createPlaylist(name)
    setCreating(false)
    if (createErr) {
      setError(createErr.message)
      return
    }
    if (data?.id) {
      setSelectedIds((prev) => new Set(prev).add(data.id))
      setNewName('')
      await api.refresh()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const { data: initial } = await api.getPlaylistIdsForVideo(video.youtube_video_id)
    const initialSet = new Set(initial)
    const toAdd = [...selectedIds].filter((id) => !initialSet.has(id))
    const toRemove = [...initialSet].filter((id) => !selectedIds.has(id))

    for (const pid of toAdd) {
      const { error: addErr } = await api.addVideo(pid, video)
      if (addErr) {
        setSaving(false)
        setError(addErr.message)
        return
      }
    }
    for (const pid of toRemove) {
      const { error: remErr } = await api.removeVideo(pid, video.youtube_video_id)
      if (remErr) {
        setSaving(false)
        setError(remErr.message)
        return
      }
    }

    setSaving(false)
    onSuccess?.()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="הוסף לפלייליסט"
      bodyClassName="max-h-[70vh] overflow-y-auto"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || loadingMembership}>
            {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {saving ? 'שומר…' : 'שמור'}
          </Button>
        </div>
      }
    >
      <p className="mb-3 line-clamp-2 text-sm text-slate-600 dark:text-zinc-400">{video.title}</p>

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="שם פלייליסט חדש"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1"
        />
        <Button type="button" variant="secondary" onClick={() => void handleCreate()} disabled={creating || !newName.trim()}>
          {creating ? <LoadingSpinner className="h-4 w-4" /> : <Plus className="h-4 w-4" aria-hidden />}
          חדש
        </Button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {api.loading || loadingMembership ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <LoadingSpinner className="h-8 w-8 border-2 border-brand-500 border-t-transparent" />
          <span className="text-sm text-slate-600">טוען פלייליסטים…</span>
        </div>
      ) : api.playlists.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          אין עדיין פלייליסטים. צרו אחד למעלה ולחצו שמור.
        </p>
      ) : (
        <ul className="space-y-2">
          {api.playlists.map((pl) => {
            const checked = selectedIds.has(pl.id)
            return (
              <li key={pl.id}>
                <button
                  type="button"
                  onClick={() => togglePlaylist(pl.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border-2 px-3 py-3 text-right transition',
                    checked
                      ? 'border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-brand-950/40'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900'
                  )}
                >
                  <ListMusic className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-900 dark:text-zinc-100">{pl.name}</span>
                    <span className="text-xs text-slate-500">{pl.video_count} סרטונים</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                      checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'
                    )}
                    aria-hidden
                  >
                    {checked ? '✓' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
