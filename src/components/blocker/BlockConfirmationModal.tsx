import { useEffect, useState } from 'react'
import type { Device } from '../../types'
import { Modal } from '../ui/Modal'
import { BlockToggle } from './BlockToggle'
import { Button } from '../ui/Button'
import { toast } from 'sonner'

export function BlockConfirmationModal({
  device,
  open,
  onClose,
}: {
  device: Device | null
  open: boolean
  onClose: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!open) setConfirmOpen(false)
  }, [open])

  if (!device) return null

  const needsConfirm = device.is_blocked

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={device.name}
      footer={
        needsConfirm && !confirmOpen ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              ביטול
            </Button>
            <Button onClick={() => setConfirmOpen(true)}>אישור פתיחת YouTube</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            סגור
          </Button>
        )
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {needsConfirm && !confirmOpen ? (
          <p className="text-center text-sm text-slate-600 dark:text-zinc-400">
            פתיחת YouTube מסירה את החסימה למכשיר זה. האם להמשיך?
          </p>
        ) : (
          <>
            <BlockToggle
              deviceId={device.id}
              isBlocked={device.is_blocked}
              onUpdated={() => {
                toast.success('עודכן')
                setConfirmOpen(false)
                onClose()
              }}
            />
            <p className="text-center text-xs text-slate-500 dark:text-zinc-500">לחיצה מחליפה בין חסום לפתוח</p>
          </>
        )}
      </div>
    </Modal>
  )
}
