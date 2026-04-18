import { useEffect, useRef, useState } from 'react'
import { Clapperboard, KeyRound, Lock, Plus, RefreshCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel, YouTubeVideoResult } from '../../types'
import { extractYouTubeVideoId } from '../../lib/youtube'
import { WhitelistView } from './WhitelistView'
import { ApprovedVideosPanel } from './ApprovedVideosPanel'
import { ChannelSearch } from './ChannelSearch'
import { VideoSearchModal } from './VideoSearchModal'
import { RemoveChannelModal } from './RemoveChannelModal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { toast } from 'sonner'
import { Skeleton } from '../ui/Skeleton'
import { getResolvedParentPin, pinsMatch } from '../../lib/parentPin'

export function ChannelManager() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [videoSearchOpen, setVideoSearchOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [addingVideoId, setAddingVideoId] = useState<string | null>(null)
  const [addingChannelByUrl, setAddingChannelByUrl] = useState(false)
  const [channelUrlInput, setChannelUrlInput] = useState('')
  const [channelCategory, setChannelCategory] = useState('')
  const [removeLoading, setRemoveLoading] = useState(false)
  const [refreshingChannelId, setRefreshingChannelId] = useState<string | null>(null)
  const [manageLocked, setManageLocked] = useState(true)
  const [pinModalOpen, setPinModalOpen] = useState(false)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const selectedDevice = devices.find((d) => d.id === deviceId) ?? null
  const managementPin = getResolvedParentPin()

  /** אחרי אימות PIN באמצעות לחיצה על "הוסף" / חיפוש — להריץ פעולה שנחסמה כשהמסך היה נעול */
  const pendingAfterUnlockRef = useRef<'addChannelUrl' | 'openChannelSearch' | 'openVideoSearch' | null>(null)

  const {
    whitelist,
    approvedVideos,
    searchResults,
    videoSearchResults,
    searchLoading,
    videoSearchLoading,
    searchError,
    videoSearchError,
    loading: listLoading,
    search,
    searchVideos,
    loadWhitelist,
    loadApprovedVideos,
    addChannelByUrlOrId,
    refreshChannelVideosCache,
    addToWhitelist,
    removeFromWhitelist,
    addVideoByUrlOrId,
    addToApprovedVideos,
    removeFromApprovedVideos,
  } = useChannels(deviceId ?? undefined, user?.id ?? ownerUserId)

  useEffect(() => {
    if (!deviceId && devices[0]?.id) setDeviceId(devices[0].id)
  }, [devices, deviceId])

  useEffect(() => {
    loadWhitelist()
  }, [deviceId, loadWhitelist])

  useEffect(() => {
    loadApprovedVideos()
  }, [deviceId, loadApprovedVideos])

  const handleAdd = async (c: import('../../types').YouTubeChannelResult) => {
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingId(c.channelId)
    const { error } = await addToWhitelist(c, channelCategory.trim() || null)
    setAddingId(null)
    if (error) toast.error(error.message)
    else {
      toast.success(`הערוץ נוסף למכשיר ${selectedDevice.name}`)
      setSearchOpen(false)
    }
  }

  const confirmRemove = async () => {
    if (!removeTarget) return
    setRemoveLoading(true)
    const { error } = await removeFromWhitelist(removeTarget.id)
    setRemoveLoading(false)
    if (error) toast.error(error.message)
    else {
      toast.success('הוסר')
      setRemoveTarget(null)
    }
  }

  const handleAddChannelByUrl = async () => {
    const trimmed = channelUrlInput.trim()
    if (!trimmed) {
      toast.error('הדביקו לינק לערוץ או לסרטון YouTube')
      return
    }
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר להוספה')
      return
    }
    setAddingChannelByUrl(true)
    try {
      const looksLikeVideo = Boolean(extractYouTubeVideoId(trimmed))
      if (looksLikeVideo) {
        const { error } = await addVideoByUrlOrId(trimmed)
        if (error) {
          toast.error(error.message)
          return
        }
        setChannelUrlInput('')
        toast.success(`הסרטון אושר למכשיר ${selectedDevice.name} — יופיע אצל הילד`)
        void loadApprovedVideos()
        return
      }

      const { error } = await addChannelByUrlOrId(trimmed, channelCategory.trim() || null)
      if (error) {
        toast.error(error.message)
        return
      }
      setChannelUrlInput('')
      toast.success(`הערוץ נוסף למכשיר ${selectedDevice.name}`)
    } finally {
      setAddingChannelByUrl(false)
    }
  }

  const handleAddVideoByUrl = async (value: string) => {
    if (!selectedDevice) {
      toast.error('לא נבחר מכשיר')
      return
    }
    setAddingVideoId('url')
    const { error } = await addVideoByUrlOrId(value)
    setAddingVideoId(null)
    if (error) toast.error(error.message)
    else {
      toast.success('הסרטון אושר ויופיע אצל הילד תוך רגעים')
      void loadApprovedVideos()
    }
  }

  const handleAddVideoFromSearch = async (v: YouTubeVideoResult) => {
    setAddingVideoId(v.videoId)
    const { error } = await addToApprovedVideos(v)
    setAddingVideoId(null)
    if (error) toast.error(error.message)
    else {
      toast.success('הסרטון אושר ויופיע אצל הילד תוך רגעים')
      setVideoSearchOpen(false)
      void loadApprovedVideos()
    }
  }

  const handleRemoveApprovedVideo = async (whitelistedVideoId: string) => {
    const { error } = await removeFromApprovedVideos(whitelistedVideoId)
    if (error) toast.error(error.message)
    else {
      toast.success('הוסר מהרשימה')
      void loadApprovedVideos()
    }
  }

  const handleRefreshChannelVideos = async (channelId: string, ytChannelId: string, force = true) => {
    setRefreshingChannelId(channelId)
    const { error } = await refreshChannelVideosCache(channelId, ytChannelId, force)
    setRefreshingChannelId(null)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('סרטוני הערוץ עודכנו במטמון')
  }

  const runPendingAfterUnlock = () => {
    const p = pendingAfterUnlockRef.current
    pendingAfterUnlockRef.current = null
    if (p === 'addChannelUrl') void handleAddChannelByUrl()
    if (p === 'openChannelSearch') setSearchOpen(true)
    if (p === 'openVideoSearch') setVideoSearchOpen(true)
  }

  const handleUnlockManagement = () => {
    if (!managementPin) {
      setManageLocked(false)
      setPinModalOpen(false)
      setPinInput('')
      setPinError(null)
      toast.success('מסך ההוספה נפתח (ללא PIN מוגדר)')
      runPendingAfterUnlock()
      return
    }
    if (!pinsMatch(pinInput, managementPin)) {
      setPinError('PIN שגוי')
      return
    }
    setManageLocked(false)
    setPinModalOpen(false)
    setPinInput('')
    setPinError(null)
    toast.success('מסך ההוספה נפתח — אפשר להוסיף ערוצים וסרטונים')
    runPendingAfterUnlock()
  }

  const requestAddChannelByUrl = () => {
    if (manageLocked) {
      pendingAfterUnlockRef.current = 'addChannelUrl'
      setPinModalOpen(true)
      return
    }
    void handleAddChannelByUrl()
  }

  const requestOpenChannelSearch = () => {
    if (manageLocked) {
      pendingAfterUnlockRef.current = 'openChannelSearch'
      setPinModalOpen(true)
      return
    }
    setSearchOpen(true)
  }

  const requestOpenVideoSearch = () => {
    if (manageLocked) {
      pendingAfterUnlockRef.current = 'openVideoSearch'
      setPinModalOpen(true)
      return
    }
    setVideoSearchOpen(true)
  }

  useEffect(() => {
    if (whitelist.length === 0 || refreshingChannelId) return
    const stale = whitelist.find((c) => {
      if (!c.last_videos_refresh_at) return true
      return Date.now() - new Date(c.last_videos_refresh_at).getTime() > 24 * 60 * 60 * 1000
    })
    if (!stale) return
    void handleRefreshChannelVideos(stale.id, stale.youtube_channel_id, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whitelist])

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pb-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ערוצים</h1>
        {manageLocked ? (
          <div
            className="rounded-2xl border-2 border-amber-500/85 bg-gradient-to-br from-amber-50 to-orange-50 p-4 shadow-sm dark:border-amber-500/55 dark:from-amber-950/50 dark:to-zinc-900/80"
            role="region"
            aria-label="אימות הורה נדרש"
          >
            <p className="text-base font-extrabold leading-snug text-amber-950 dark:text-amber-100">
              לפני שמוסיפים תוכן — צעד הכרחי להורה
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-950/90 dark:text-amber-100/90">
              מסך ההוספה נעול כדי שהילד לא ישנה את הרשימות. כדי להשלים את החיבור והתוכן למכשיר של הילד, יש לאמת שאתם ההורה באמצעות הקוד (PIN).
            </p>
            <Button
              type="button"
              className="mt-4 w-full gap-2 py-3.5 text-base font-bold shadow-md ring-2 ring-brand-500/30"
              onClick={() => setPinModalOpen(true)}
            >
              <KeyRound className="h-5 w-5 shrink-0" aria-hidden />
              הזינו PIN והמשיכו להוספת ערוצים וסרטונים
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/50 bg-emerald-50/90 px-3 py-2.5 dark:border-emerald-700/50 dark:bg-emerald-950/35">
            <p className="min-w-0 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              ניהול פתוח — אפשר להוסיף או להסיר תוכן
            </p>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0 !px-3 !py-2 text-xs font-semibold"
              onClick={() => setManageLocked(true)}
            >
              <Lock className="h-4 w-4" />
              נעל את מסך ההוספה
            </Button>
          </div>
        )}
        {selectedDevice ? (
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            המכשיר הפעיל כעת: <span className="font-semibold text-slate-700 dark:text-zinc-200">{selectedDevice.name}</span>
          </p>
        ) : null}
        {devices.length > 1 ? (
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={deviceId ?? ''}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
        <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs text-slate-500 dark:text-zinc-400">
            הדביקו כאן לינק: <strong className="text-slate-700 dark:text-zinc-300">לסרטון</strong> (youtu.be / watch?v=) — יאושר{' '}
            <strong className="text-slate-700 dark:text-zinc-300">רק הסרטון</strong>; לינק לערוץ — יתווסף הערוץ כולו.
          </p>
          <Input
            placeholder="קטגוריה (למשל: Songs / Stories / Education)"
            value={channelCategory}
            onChange={(e) => setChannelCategory(e.target.value)}
            className="mb-2"
          />
          <div className="flex gap-2">
            <Input
              dir="ltr"
              placeholder="https://www.youtube.com/channel/... או https://youtu.be/..."
              value={channelUrlInput}
              onChange={(e) => setChannelUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void requestAddChannelByUrl()}
            />
            <Button onClick={() => void requestAddChannelByUrl()} disabled={addingChannelByUrl}>
              {addingChannelByUrl ? '...' : 'הוסף'}
            </Button>
          </div>
        </div>
      </header>

      {devLoading || listLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : devices.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-zinc-400">הוסיפו מכשיר כדי לנהל ערוצים.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <WhitelistView channels={whitelist} onRemoveRequest={setRemoveTarget} manageLocked={manageLocked} />
          <div className={manageLocked ? 'pointer-events-none opacity-45' : ''}>
            <ApprovedVideosPanel videos={approvedVideos} onAddByUrl={handleAddVideoByUrl} onRemove={handleRemoveApprovedVideo} />
          </div>
          {whitelist.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-zinc-300">רענון סרטוני ערוץ (Cache)</p>
              <div className="grid gap-2">
                {whitelist.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 p-2 dark:border-zinc-800">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-zinc-100">{c.channel_name}</p>
                      <p className="text-xs text-slate-500 dark:text-zinc-500">
                        רענון אחרון: {c.last_videos_refresh_at ? new Date(c.last_videos_refresh_at).toLocaleString() : 'עדיין לא רוענן'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 !px-3 !py-2 text-xs"
                      onClick={() => void handleRefreshChannelVideos(c.id, c.youtube_channel_id)}
                      disabled={refreshingChannelId === c.id}
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      {refreshingChannelId === c.id ? 'מרענן...' : 'רענן'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="fixed bottom-24 left-4 right-4 z-30 mx-auto flex max-w-lg gap-2 shadow-lg">
        <Button
          type="button"
          className="min-h-[48px] flex-1 gap-2 px-2 text-sm font-bold shadow-md sm:text-base"
          onClick={() => requestOpenChannelSearch()}
        >
          <Plus className="h-5 w-5 shrink-0" />
          חיפוש ערוץ
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-[48px] flex-1 gap-2 border border-slate-300 px-2 text-sm font-bold shadow-md dark:border-zinc-600 sm:text-base"
          onClick={() => requestOpenVideoSearch()}
        >
          <Clapperboard className="h-5 w-5 shrink-0" />
          חיפוש סרטון
        </Button>
      </div>

      <ChannelSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={search}
        results={searchResults}
        loading={searchLoading}
        error={searchError}
        onAdd={handleAdd}
        addingId={addingId}
        deviceLabel={selectedDevice?.name}
        manageLocked={manageLocked}
      />

      <VideoSearchModal
        open={videoSearchOpen}
        onClose={() => setVideoSearchOpen(false)}
        onSearch={searchVideos}
        results={videoSearchResults}
        loading={videoSearchLoading}
        error={videoSearchError}
        onAdd={handleAddVideoFromSearch}
        addingId={addingVideoId}
      />

      <RemoveChannelModal
        open={Boolean(removeTarget)}
        channel={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        loading={removeLoading}
      />

      <Modal
        open={pinModalOpen}
        onClose={() => {
          setPinModalOpen(false)
          setPinInput('')
          setPinError(null)
          pendingAfterUnlockRef.current = null
        }}
        title="אימות הורה"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPinModalOpen(false)}>
              ביטול
            </Button>
            <Button onClick={handleUnlockManagement}>המשך</Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
          הזינו את קוד ההורה (4 ספרות). כך מוודאים שרק אתם מוסיפים או מסירים תוכן עבור המכשיר של הילד.
        </p>
        <p className="mb-3 rounded-lg border border-brand-200/80 bg-brand-50/90 px-3 py-2 text-xs leading-relaxed text-brand-900 dark:border-brand-800/60 dark:bg-brand-950/40 dark:text-brand-100/95">
          פתחתם מלחיצה על &quot;הוסף&quot;, &quot;חיפוש ערוץ&quot; או &quot;חיפוש סרטון&quot;? אחרי קוד נכון — הפעולה תמשיך אוטומטית.
        </p>
        <Input
          type="password"
          placeholder="4 ספרות"
          value={pinInput}
          onChange={(e) => {
            setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))
            if (pinError) setPinError(null)
          }}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleUnlockManagement()}
        />
        {pinError ? <p className="mt-2 text-sm text-danger-600">{pinError}</p> : null}
      </Modal>
    </div>
  )
}
