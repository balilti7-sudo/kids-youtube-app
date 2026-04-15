import { useEffect, useState } from 'react'
import { Lock, LockOpen, Plus, RefreshCcw } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel } from '../../types'
import { WhitelistView } from './WhitelistView'
import { ChannelSearch } from './ChannelSearch'
import { RemoveChannelModal } from './RemoveChannelModal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { toast } from 'sonner'
import { Skeleton } from '../ui/Skeleton'

export function ChannelManager() {
  const { user } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  const { devices, loading: devLoading } = useDevices(ownerUserId)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WhitelistedChannel | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
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
  const managementPin = import.meta.env.VITE_PARENT_MANAGEMENT_PIN?.trim() || import.meta.env.VITE_PARENT_UNLOCK_PIN?.trim() || ''

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    search,
    loadWhitelist,
    addChannelByUrlOrId,
    refreshChannelVideosCache,
    addToWhitelist,
    removeFromWhitelist,
  } = useChannels(deviceId ?? undefined, user?.id ?? ownerUserId)

  useEffect(() => {
    if (!deviceId && devices[0]?.id) setDeviceId(devices[0].id)
  }, [devices, deviceId])

  useEffect(() => {
    loadWhitelist()
  }, [deviceId, loadWhitelist])

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
    const { error } = await addChannelByUrlOrId(trimmed, channelCategory.trim() || null)
    setAddingChannelByUrl(false)
    if (error) {
      toast.error(error.message)
      return
    }
    setChannelUrlInput('')
    toast.success(`הערוץ נוסף למכשיר ${selectedDevice.name}`)
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

  const handleUnlockManagement = () => {
    if (!managementPin) {
      setManageLocked(false)
      toast.success('ניהול ערוצים נפתח (ללא PIN מוגדר)')
      return
    }
    if (pinInput !== managementPin) {
      setPinError('PIN שגוי')
      return
    }
    setManageLocked(false)
    setPinModalOpen(false)
    setPinInput('')
    setPinError(null)
    toast.success('ניהול ערוצים נפתח')
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
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ערוצים</h1>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            {manageLocked ? 'מצב מוגן לילדים: נעול' : 'ניהול ערוצים פתוח'}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="!px-3 !py-1.5 text-xs"
            onClick={() => {
              if (manageLocked) setPinModalOpen(true)
              else setManageLocked(true)
            }}
          >
            {manageLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {manageLocked ? 'פתח ניהול' : 'נעל ניהול'}
          </Button>
        </div>
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
          <p className="mb-2 text-xs text-slate-500 dark:text-zinc-400">הוספה מהירה לפי לינק ערוץ/סרטון (חוסך מכסת חיפוש)</p>
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
              onKeyDown={(e) => e.key === 'Enter' && !manageLocked && void handleAddChannelByUrl()}
              disabled={manageLocked}
            />
            <Button onClick={() => void handleAddChannelByUrl()} disabled={addingChannelByUrl || manageLocked}>
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

      <Button
        className="fixed bottom-24 left-4 right-4 z-30 mx-auto max-w-lg gap-2 shadow-lg"
        onClick={() => setSearchOpen(true)}
        disabled={manageLocked}
      >
        <Plus className="h-5 w-5" />
        חיפוש ערוץ
      </Button>

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
        }}
        title="PIN הורה לניהול ערוצים"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPinModalOpen(false)}>
              ביטול
            </Button>
            <Button onClick={handleUnlockManagement}>פתח</Button>
          </>
        }
      >
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
