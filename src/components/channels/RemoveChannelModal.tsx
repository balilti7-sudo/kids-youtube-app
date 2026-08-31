import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { WhitelistedChannel } from '../../types'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('channels.removeTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={loading}>
            {loading ? t('common.removing') : t('common.remove')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-zinc-400">
        {t('channels.removeConfirm', { name: channel?.channel_name ?? '' })}
      </p>
    </Modal>
  )
}
