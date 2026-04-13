import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { WhitelistedChannel } from '../../types'

export function RemoveChannelModal({
  open,
  channel,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean
  channel: WhitelistedChannel | null
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="הסרת ערוץ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ביטול
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? 'מסיר...' : 'הסר'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-zinc-400">
        להסיר את <span className="font-semibold">{channel?.channel_name}</span> מהרשימה?
      </p>
    </Modal>
  )
}
