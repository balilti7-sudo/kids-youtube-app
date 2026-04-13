import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useChannels } from '../../hooks/useChannels'
import type { WhitelistedChannel } from '../../types'
import { WhitelistView } from './WhitelistView'
import { ChannelSearch } from './ChannelSearch'
import { RemoveChannelModal } from './RemoveChannelModal'
import { Button } from '../ui/Button'
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
  const [removeLoading, setRemoveLoading] = useState(false)

  const {
    whitelist,
    searchResults,
    searchLoading,
    searchError,
    loading: listLoading,
    search,
    loadWhitelist,
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
    setAddingId(c.channelId)
    const { error } = await addToWhitelist(c)
    setAddingId(null)
    if (error) toast.error(error.message)
    else {
      toast.success('הערוץ נוסף')
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

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pb-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50">ערוצים</h1>
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
      </header>

      {devLoading || listLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : devices.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-zinc-400">הוסיפו מכשיר כדי לנהל ערוצים.</p>
      ) : (
        <WhitelistView channels={whitelist} onRemoveRequest={setRemoveTarget} />
      )}

      <Button
        className="fixed bottom-24 left-4 right-4 z-30 mx-auto max-w-lg gap-2 shadow-lg"
        onClick={() => setSearchOpen(true)}
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
      />

      <RemoveChannelModal
        open={Boolean(removeTarget)}
        channel={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
        loading={removeLoading}
      />
    </div>
  )
}
