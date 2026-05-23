import { useCallback, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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

type Props = {
  deviceId: string | null
  video: HiddenVideoPayload
  /** hide = block from kid view; unhide = restore */
  action: 'hide' | 'unhide'
  compact?: boolean
  className?: string
  localAccessToken?: string | null
  verifyPin: (pin: string) => Promise<ParentPinVerifyResult>
  onSuccess?: () => void
}

export function HideVideoButton({
  deviceId,
  video,
  action,
  compact,
  className,
  localAccessToken,
  verifyPin,
  onSuccess,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)

  const applyAction = useCallback(
    async (pin: string) => {
      setBusy(true)
      const hidden = action === 'hide'
      let err: Error | null = null

      if (localAccessToken) {
        const res = await setVideoHiddenLocalParent(localAccessToken, pin, video, hidden)
        err = res.error
      } else if (deviceId) {
        const res = await setVideoHiddenAuthenticated(deviceId, pin, video, hidden)
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
      toast.success(action === 'hide' ? 'הסרטון הוסתר מהילד' : 'הסרטון הוחזר לערוץ')
      onSuccess?.()
    },
    [action, deviceId, localAccessToken, onSuccess, video]
  )

  const label = action === 'hide' ? 'הסתר מהילד' : 'הצג שוב'

  return (
    <>
      <button
        type="button"
        disabled={busy || (!deviceId && !localAccessToken)}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border font-semibold transition',
          action === 'unhide'
            ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/50'
            : 'border-yt-border bg-yt-surface text-yt-text hover:bg-yt-surfaceHover',
          compact ? 'min-h-[40px] min-w-[40px] px-2 text-xs' : 'min-h-[44px] px-4 text-sm',
          className
        )}
        onClick={(e) => {
          e.stopPropagation()
          setPinOpen(true)
        }}
      >
        {busy ? (
          <LoadingSpinner className="h-4 w-4 border-2 border-current border-t-transparent" />
        ) : action === 'unhide' ? (
          <Eye className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
        ) : (
          <EyeOff className={cn('shrink-0', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden />
        )}
        {!compact ? <span>{label}</span> : null}
      </button>

      <ParentalPinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        verifyPin={verifyPin}
        onVerified={(pin) => void applyAction(pin)}
        title={action === 'hide' ? 'אימות הורה — הסתרת סרטון' : 'אימות הורה — הצגת סרטון'}
        description={
          action === 'hide'
            ? 'הזינו קוד הורה כדי להסתיר את הסרטון ממכשיר הילד. הסרטון ייעלם לחלוטין מהרשימה.'
            : 'הזינו קוד הורה כדי להחזיר את הסרטון לערוץ במכשיר הילד.'
        }
      />
    </>
  )
}
