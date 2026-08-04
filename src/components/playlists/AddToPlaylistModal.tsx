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
  addVideoToPlaylistViaRpc,
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
  /** Single video (legacy) or many videos for bulk add. Prefer `videos` when both set. */
  video?: PlaylistVideoPayload
  videos?: PlaylistVideoPayload[]
  onSuccess?: () => void
}

function dedupeVideos(list: PlaylistVideoPayload[]): PlaylistVideoPayload[] {
  const map = new Map<string, PlaylistVideoPayload>()
  for (const v of list) {
    const id = v.youtube_video_id?.trim()
    if (!id) continue
    map.set(id, { ...v, youtube_video_id: id })
  }
  return [...map.values()]
}

export function AddToPlaylistModal({
  open,
  onClose,
  mode,
  userId,
  childAccessToken,
  video,
  videos,
  onSuccess,
}: Props) {
  const resolvedVideos = useMemo(() => {
    if (videos && videos.length > 0) return dedupeVideos(videos)
    if (video) return dedupeVideos([video])
    return []
  }, [video, videos])

  const isBulk = resolvedVideos.length > 1
  const primaryVideo = resolvedVideos[0] ?? null

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
  const membershipVideoId = !isBulk && primaryVideo ? primaryVideo.youtube_video_id : null

  /** Load playlists (+ single-video membership) once per modal open */
  useEffect(() => {
    if (!open || !canLoad || !primaryVideo) return

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
        const listPromise =
          mode === 'parent' && userId
            ? listPlaylistsForUser(userId)
            : childAccessToken
              ? listPlaylistsForChild(childAccessToken)
              : Promise.resolve({ data: [] as UserPlaylist[], error: null })

        const memberPromise =
          membershipVideoId && mode === 'parent' && userId
            ? playlistIdsContainingVideo(userId, membershipVideoId)
            : membershipVideoId && childAccessToken
              ? playlistIdsContainingVideoForChild(childAccessToken, membershipVideoId)
              : Promise.resolve({ data: [] as string[], error: null })

        const [listResult, memberResult] = await Promise.all([listPromise, memberPromise])

        if (cancelled) return

        if (listResult.error) {
          setError(listResult.error.message)
          return
        }

        const ids = isBulk ? new Set<string>() : new Set(memberResult.data ?? [])
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
  }, [
    open,
    canLoad,
    mode,
    userId,
    childAccessToken,
    primaryVideo?.youtube_video_id,
    membershipVideoId,
    isBulk,
  ])

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
    if (resolvedVideos.length === 0) {
      setError('לא נבחרו סרטונים')
      return
    }

    if (isBulk) {
      const playlistIds = [...selectedIds]
      if (playlistIds.length === 0) {
        toast.info('בחרו לפחות פלייליסט אחד')
        return
      }

      setSaving(true)
      setError(null)
      let added = 0
      let failed = 0

      for (const pid of playlistIds) {
        for (const v of resolvedVideos) {
          const res =
            mode === 'parent'
              ? await addVideoToPlaylistViaRpc(pid, v)
              : childAccessToken
                ? await addVideoToPlaylistForChild(childAccessToken, pid, v)
                : { error: new Error('לא מחובר') }
          if (res.error) failed += 1
          else added += 1
        }
      }

      setSaving(false)
      if (failed > 0 && added === 0) {
        setError('הוספה לפלייליסט נכשלה')
        return
      }
      toast.success(
        failed > 0
          ? `נוספו ${added} סרטונים (${failed} נכשלו)`
          : `נוספו ${resolvedVideos.length} סרטונים לפלייליסט`
      )
      onSuccess?.()
      onClose()
      return
    }

    const single = primaryVideo!
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
          ? await addVideoToPlaylistViaRpc(pid, single)
          : childAccessToken
            ? await addVideoToPlaylistForChild(childAccessToken, pid, single)
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
          ? await removeVideoFromPlaylist(pid, single.youtube_video_id)
          : childAccessToken
            ? await removeVideoFromPlaylistForChild(childAccessToken, pid, single.youtube_video_id)
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

  const titleText = isBulk ? 'הוספה מרובה לפלייליסט' : 'הוסף לפלייליסט'
  const summaryText = isBulk
    ? `${resolvedVideos.length} סרטונים נבחרו — בחרו לאלו פלייליסטים להוסיף אותם.`
    : primaryVideo?.title ?? ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titleText}
      bodyClassName="max-h-[70vh] overflow-y-auto"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            ביטול
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || resolvedVideos.length === 0}
          >
            {saving ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {saving ? 'שומר…' : isBulk ? `הוסף ${resolvedVideos.length} סרטונים` : 'שמור'}
          </Button>
        </div>
      }
    >
      <p className={cn('mb-3 text-sm text-yt-textMuted', !isBulk && 'line-clamp-2')}>{summaryText}</p>

      {isBulk && resolvedVideos.length > 0 ? (
        <ul className="mb-3 max-h-28 space-y-1 overflow-y-auto rounded-xl border border-yt-border bg-yt-surface/60 px-2 py-2 text-xs text-yt-textMuted">
          {resolvedVideos.slice(0, 8).map((v) => (
            <li key={v.youtube_video_id} className="line-clamp-1">
              • {v.title}
            </li>
          ))}
          {resolvedVideos.length > 8 ? (
            <li className="font-medium text-yt-text">…ועוד {resolvedVideos.length - 8}</li>
          ) : null}
        </ul>
      ) : null}

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
