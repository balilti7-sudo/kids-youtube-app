import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import {
  mapDeviceLinkErrorMessage,
  normalizeDeviceLinkCodeInput,
  parentLinkDeviceByCode,
} from '../../lib/deviceLinkPairing'

type Props = {
  open: boolean
  onClose: () => void
  onLinked: () => void | Promise<void>
  atDeviceLimit: boolean
}

export function LinkExistingDeviceModal({ open, onClose, onLinked, atDeviceLimit }: Props) {
  const [code, setCode] = useState('')
  const [linking, setLinking] = useState(false)

  const close = () => {
    if (linking) return
    setCode('')
    onClose()
  }

  const handleLink = async () => {
    const normalized = normalizeDeviceLinkCodeInput(code)
    if (normalized.length !== 6) {
      toast.error('הזינו קוד בן 6 ספרות')
      return
    }
    if (atDeviceLimit) {
      toast.error('הגעתם למגבלת הפרופילים בתוכנית הנוכחית')
      return
    }

    setLinking(true)
    const { data, error } = await parentLinkDeviceByCode(normalized)
    setLinking(false)

    if (error || !data) {
      toast.error(mapDeviceLinkErrorMessage(error))
      return
    }

    toast.success('המכשיר קושר לחשבון שלך', { description: data.deviceName })
    setCode('')
    await onLinked()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="קשר מכשיר קיים"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={close} disabled={linking}>
            ביטול
          </Button>
          <Button type="button" onClick={() => void handleLink()} disabled={linking || atDeviceLimit}>
            {linking ? <LoadingSpinner className="h-5 w-5 border-2 border-white border-t-transparent" /> : null}
            {linking ? 'מקשר…' : 'קשר מכשיר'}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-950/20 px-3 py-3">
        <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" aria-hidden />
        <p className="text-sm leading-relaxed text-zinc-300">
          במסך הילד: לשונית <strong>הורים</strong> → החזיקו 3 שניות על &quot;קוד קישור&quot; → הזינו כאן את
          הקוד בן 6 הספרות. הקוד תקף ל-5 דקות בלבד.
        </p>
      </div>

      <label className="mb-1 mt-4 block text-sm font-medium text-zinc-300">קוד קישור (6 ספרות)</label>
      <Input
        value={code}
        onChange={(e) => setCode(normalizeDeviceLinkCodeInput(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={6}
        dir="ltr"
        className="text-center font-mono text-lg tracking-[0.35em]"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && void handleLink()}
      />
    </Modal>
  )
}
