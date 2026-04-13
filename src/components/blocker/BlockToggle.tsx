import { useState } from 'react'
import { useDeviceStore } from '../../stores/deviceStore'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { cn } from '../../lib/utils'

export function BlockToggle({
  deviceId,
  isBlocked,
  onUpdated,
}: {
  deviceId: string
  isBlocked: boolean
  onUpdated?: () => void
}) {
  const toggleBlock = useDeviceStore((s) => s.toggleBlock)
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    const { error } = await toggleBlock(deviceId, !isBlocked)
    setLoading(false)
    if (!error) onUpdated?.()
  }

  const open = !isBlocked

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        'relative flex h-40 w-40 items-center justify-center rounded-full text-lg font-extrabold text-white shadow-lg transition-transform duration-200 active:scale-95',
        loading && 'opacity-70',
        open ? 'bg-brand-600 ring-4 ring-brand-200' : 'bg-danger-600 ring-4 ring-red-100'
      )}
    >
      {loading ? (
        <LoadingSpinner className="h-10 w-10 border-4 border-white border-t-transparent" />
      ) : open ? (
        'YouTube פתוח'
      ) : (
        'YouTube חסום'
      )}
    </button>
  )
}
