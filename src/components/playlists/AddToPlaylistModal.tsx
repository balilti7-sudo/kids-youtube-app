import { useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import type { PlaylistMode } from '../../hooks/usePlaylists'
import type { PlaylistVideoPayload, UserPlaylist } from '../../lib/playlists'
import {
  addVideoToPlaylist,
  addVideoToPlaylistForChild,
  createPlaylistForChild,
  createPlaylistForUser,
  listPlaylistsForChild,
  listPlaylistsForUser,
  playlistIdsContainingVideo,
  playlistIdsContainingVideoForChild,
  removeVideoFromPlaylist,
  removeVideoFromPlaylistForChild,
} from '../../lib/playlists'
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
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const initialIdsRef = useRef<Set<string>>(new Set())
  const [filterQuery, setFilterQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canLoad = mode === 'parent' ? Boolean(userId) : Boolean(childAccessToken)

  /** Load playlists + membership exactly once per modal open */
  useEffect(() => {
    if (!open || !canLoad) return

    let cancelled = false
    setError(null)
    setFilterQuery('')
    setNewName('')
    setLoading(true)
    setPlaylists([])
    setSelectedIds(new Set())
    initialIdsRef.current = new Set()

    void (async () => {
      try {
        const [listResult, memberResult] = await Promise.all([
          mode === 'parent' && userId
            ? listPlaylistsForUser(userId)
            : childAccessToken
              ? listPlaylistsForChild(childAccessToken)
              : Promise.resolve({ data: [], error: null }),
          mode === 'parent' && userId
            ? playlistIdsContainingVideo(userId, video.youtube_video_id)
            : childAccessToken
              ? playlistIdsContainingVideoForChild(childAccessToken, video.youtube_video_id)
              : Promise.resolve({ data: [], error: null }),
        ])

        if (cancelled) return

        if (listResult.error) {
          setError(listResult.error.message)
          return
        }

        const ids = new Set(memberResult.data ?? [])
        setPlaylists(listResult.data)
        setSelectedIds(ids)
        initialIdsRef.current = ids
      } catch {
        if (!cancelled) setError('טעינת פלייליסטים נכשלה')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, canLoad, mode, userId, childAccessToken, video.youtube_video_id])

  const filteredPlaylists = useMemo(() => {
    const q = filterQuery.trim().toLowerCase()
    if (!q) return playlists
    return playlists.filter((pl) => pl.name.toLowerCase().includes(q))
  }, [playlists, filterQuery])

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

    let created: UserPlaylist | null = null
    let createErr: Error | null = null

    if (mode === 'parent' && userId) {
      const res = await createPlaylistForUser(userId, name)
      created = res.data
      createErr = res.error
    } else if (mode === 'kid' && childAccessToken) {
      const res = await createPlaylistForChild(childAccessToken, name)
      if (res.error) createErr = res.error
      else if (res.data) {
        created = { id: res.data, name, video_count: 0, updated_at: '' }
      }
    } else {
      createErr = new Error('לא מחובר')
    }

    setCreating(false)
    if (createErr) {
      setError(createErr.message)
      return
    }
    if (created) {
      setPlaylists((prev) => [created!, ...prev.filter((p) => p.id !== created!.id)])
      setSelectedIds((prev) => new Set(prev).add(created!.id))
      setNewName('')
      setFilterQuery('')
      toast.success(`הפלייליסט "${created.name}" נוצר`)
    }
  }

  const handleSave = async () => {
    const initialSet = initialIdsRef.current
    const toAdd = [...selectedIds].filter((id) => !initialSet.has(id))
    const toRemove = [...initialSet].filter((id) => !selectedIds.has(id))

    if (toAdd.length === 0 && toRemove.length === 0) {
      toast.info('לא בוצעו שינויים')
      onClose()
      return
    }

    setSaving(true)
    setError(null)

    for (const pid of toAdd) {
      const res =
        mode === 'parent'
          ? await addVideoToPlaylist(pid, video)
          : childAccessToken
            ? await addVideoToPlaylistForChild(childAccessToken, pid, video)
            : { error: new Error('לא מחובר') }
      if (res.error) {
        setSaving(false)
        setError(res.error.message)
        return
      }
    }

    for (const pid of toRemove) {
      const res =
        mode === 'parent'
          ? await removeVideoFromPlaylist(pid, video.youtube_video_id)
          : childAccessToken
            ? await removeVideoFromPlaylistForChild(childAccessToken, pid, video.youtube_video_id)
            : { error: new Error('לא מחובר') }
      if (res.error) {
        setSaving(false)
        setError(res.error.message)
        return
      }
    }

    setSaving(false)
    toast.success(toAdd.length > 0 && toRemove.length === 0 ? 'נוסף לפלייליסט' : 'הפלייליסט עודכן')
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
          <Button type="button" onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {saving ? 'שומר…' : 'שמור'}
          </Button>
        </div>
      }
    >
      <p className="mb-3 line-clamp-2 text-sm text-yt-textMuted">{video.title}</p>

      <div className="mb-3 flex gap-2">
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

      {!loading && playlists.length > 0 ? (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            placeholder="חיפוש פלייליסט…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="pr-9"
          />
        </div>
      ) : null}

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <LoadingSpinner className="h-8 w-8 border-2 border-brand-500 border-t-transparent" />
          <span className="text-sm text-slate-600">טוען פלייליסטים…</span>
        </div>
      ) : playlists.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          אין עדיין פלייליסטים. צרו אחד למעלה ולחצו שמור.
        </p>
      ) : filteredPlaylists.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">אין פלייליסטים שמתאימים לחיפוש.</p>
      ) : (
        <ul className="space-y-2">
          {filteredPlaylists.map((pl) => {
            const checked = selectedIds.has(pl.id)
            return (
              <li key={pl.id}>
                <button
                  type="button"
                  onClick={() => togglePlaylist(pl.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-right transition',
                    checked
                      ? 'border-yt-textMuted/40 bg-yt-surfaceHover'
                      : 'border-yt-border bg-yt-surface hover:bg-yt-surfaceHover'
                  )}
                >
                  <ListMusic className="h-5 w-5 shrink-0 text-brand-600" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-yt-text">{pl.name}</span>
                    <span className="text-xs text-yt-textMuted">{pl.video_count} סרטונים</span>
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
