import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDeviceOwnerId } from '../../hooks/useDeviceOwnerId'
import { useDevices } from '../../hooks/useDevices'
import { useDeviceStore } from '../../stores/deviceStore'
import { Button } from '../ui/Button'

function tailId(id: string | null | undefined): string {
  if (!id || id.length < 4) return '—'
  return id.slice(-4)
}

export function ParentAppFooter() {
  const navigate = useNavigate()
  const { user, signOutClearEverything } = useAuth()
  const { ownerUserId } = useDeviceOwnerId()
  useDevices(ownerUserId)
  const devices = useDeviceStore((s) => s.devices)

  const primaryDeviceId = devices[0]?.id ?? null
  const debugLabel = primaryDeviceId
    ? `מזהה מכשיר (דיבוג · מכשיר ראשון ברשימה): …${tailId(primaryDeviceId)}`
    : `מזהה מכשיר (דיבוג): אין מכשירים עדיין · משתמש …${tailId(user?.id ?? null)}`

  const handleClearAll = async () => {
    await signOutClearEverything()
    navigate('/auth', { replace: true })
  }

  return (
    <footer className="mt-6 border-t border-slate-200 pt-4 dark:border-zinc-800">
      <p className="text-center text-[10px] leading-relaxed text-slate-500 dark:text-zinc-500" dir="ltr">
        {debugLabel}
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full gap-2 text-xs"
        onClick={() => void handleClearAll()}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        נקה נתונים מקומיים והתנתק
      </Button>
    </footer>
  )
}
