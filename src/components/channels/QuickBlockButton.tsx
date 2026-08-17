import { useCallback, useState } from 'react'
import { ShieldBan } from 'lucide-react'
import { cn } from '../../lib/utils'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ParentalPinModal } from '../parental/ParentalPinModal'
import type { ParentPinVerifyResult } from '../../lib/verifyParentManagementPin'
import {
  setVideoHiddenAuthenticated,
  setVideoHiddenLocalParent,
  type HiddenVideoPayload,
} from '../../lib/hiddenVideos'
import { toast } from 'sonner'

export type QuickBlockButtonProps = {
  video: HiddenVideoPayload
  deviceId?: string | null
  localAccessToken?: string | null
  cachedPin?: string | null
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
  onSuccess?: () => void
  className?: string
}

export function QuickBlockButton({
  video,
  deviceId,
  localAccessToken,
  cachedPin,
  verifyPin,
  onSuccess,
  className,
}: QuickBlockButtonProps) {
  const [busy, setBusy] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const blockVideo = useCallback(
    async (pin: string) => {
      setBusy(true)
      let err: Error | null = null

      if (localAccessToken) {
        const res = await setVideoHiddenLocalParent(localAccessToken, pin, video, true)
        err = res.error
      } else if (deviceId) {
        const res = await setVideoHiddenAuthenticated(deviceId, pin, video, true)
        err = res.error
      } else {
        err = new Error('לא נבחר מכשיר')
      }

      setBusy(false)
      setPinOpen(false)
      if (err) {
        toast.error(err.message)
        return
      }
      toast.success('הסרטון נחסם מהילד')
      onSuccess?.()
    },
    [deviceId, localAccessToken, onSuccess, video]
  )

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (busy) return
    const pin = cachedPin?.replace(/\D/g, '').trim()
    if (pin && pin.length >= 4) {
      void blockVideo(pin)
      return
    }
    setPinOpen(true)
  }

  return (
    <>
      <button
        type="button"
        disabled={busy || (!deviceId && !localAccessToken)}
        aria-label="חסימה מהירה — הסתר מהילד"
        title="חסימה מהירה"
        onClick={handleClick}
        className={cn(
          'inline-flex items-center justify-center rounded-full border border-black/20 bg-black/70 text-white shadow-lg backdrop-blur-sm',
          'transition duration-200 hover:scale-110 hover:border-red-400/80 hover:bg-red-600/90 hover:shadow-red-900/30',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60',
          'h-8 w-8 sm:h-9 sm:w-9',
          className
        )}
      >
        {busy ? (
          <LoadingSpinner className="h-4 w-4 border-2 border-white border-t-transparent" />
        ) : (
          <ShieldBan className="h-4 w-4 sm:h-[18px] sm:w-[18px]" strokeWidth={2.25} aria-hidden />
        )}
      </button>

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        verifyPin={verifyPin}
        onVerified={(pin) => void blockVideo(pin)}
        title="אימות הורה — חסימה מהירה"
        description="הזינו קוד הורה כדי לחסום את הסרטון ממכשיר הילד מבלי לפתוח אותו."
      />
    </>
  )
}
